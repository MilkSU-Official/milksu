import { createHash, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto'
import { SIGNATURE_FILE, SIGNATURE_SCHEMA, MAX_MANIFEST_BYTES, type Manifest } from './types.ts'
import { validDigest } from './digest.ts'
import { packagePayloadDigest } from './digest.ts'
import { readManifest } from './manifest.ts'
import { validateThirdPartyTools } from './schema.ts'
import { API_VERSION } from './types.ts'
import { isObject, readStrictJsonFile, rejectUnknownKeys, securePackageFile, trim } from './util.ts'

export type PackageSignatureProof = {
  keyId: string
  publicKey: string
  signature: string
}

export type PackageSignatureSet = {
  schema: string
  digest: string
  publisher: string
  signatures: PackageSignatureProof[]
}

export type TrustedPublisher = {
  name: string
  keyId: string
  publicKey: string
  trustedAt: string
}

export type PublisherTrustStore = {
  schema: string
  publishers: Record<string, TrustedPublisher>
}

const SIGNATURE_KEYS = new Set(['schema', 'digest', 'publisher', 'signatures'])
const PROOF_KEYS = new Set(['keyId', 'publicKey', 'signature'])
const TRUST_KEYS = new Set(['schema', 'publishers'])
const PUBLISHER_KEYS = new Set(['name', 'keyId', 'publicKey', 'trustedAt'])

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')

function ed25519Verify(publicKeyRaw: Buffer, message: Buffer, signature: Buffer): boolean {
  const key = createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, publicKeyRaw]), format: 'der', type: 'spki' })
  return verify(null, message, key, signature)
}

export function fingerprintPublicKey(publicKeyRaw: Buffer): string {
  return createHash('sha256').update(publicKeyRaw).digest('hex')
}

export async function readSignatureSet(directory: string): Promise<PackageSignatureSet> {
  const path = await securePackageFile(directory, SIGNATURE_FILE, MAX_MANIFEST_BYTES)
  const parsed = await readStrictJsonFile(path, MAX_MANIFEST_BYTES)
  if (!isObject(parsed)) throw new Error('package signature: metadata is invalid')
  rejectUnknownKeys(parsed, SIGNATURE_KEYS, 'package signature')
  const signatures = Array.isArray(parsed.signatures) ? parsed.signatures : []
  for (const proof of signatures) {
    if (!isObject(proof)) throw new Error('package signature metadata is invalid')
    rejectUnknownKeys(proof, PROOF_KEYS, 'package signature')
  }
  const set: PackageSignatureSet = {
    schema: String(parsed.schema ?? ''),
    digest: String(parsed.digest ?? ''),
    publisher: String(parsed.publisher ?? ''),
    signatures: signatures.map((proof) => {
      const value = proof as Record<string, unknown>
      return {
        keyId: String(value.keyId ?? ''),
        publicKey: String(value.publicKey ?? ''),
        signature: String(value.signature ?? ''),
      }
    }),
  }
  if (set.schema !== SIGNATURE_SCHEMA || !validDigest(set.digest) || !trim(set.publisher) || set.signatures.length === 0 || set.signatures.length > 2) {
    throw new Error('package signature metadata is invalid')
  }
  return set
}

export function verifySignatureSet(set: PackageSignatureSet, digest: string): Map<string, PackageSignatureProof> {
  if (set.digest.toLowerCase() !== digest.toLowerCase()) {
    throw new Error('signed package digest does not match its contents')
  }
  const message = Buffer.from(`milksu.plugin-package/v1\n${digest.toLowerCase()}`)
  const valid = new Map<string, PackageSignatureProof>()
  for (const proof of set.signatures) {
    const publicKey = Buffer.from(proof.publicKey, 'base64')
    if (publicKey.length !== 32) throw new Error('publisher public key is invalid')
    const keyID = fingerprintPublicKey(publicKey)
    if (proof.keyId !== keyID) throw new Error('publisher key fingerprint does not match its public key')
    const signature = Buffer.from(proof.signature, 'base64')
    if (signature.length !== 64 || !ed25519Verify(publicKey, message, signature)) {
      throw new Error('plugin package signature is invalid')
    }
    if (valid.has(keyID)) throw new Error('plugin package contains a duplicate signature')
    valid.set(keyID, proof)
  }
  return valid
}

export async function verifyInstalledDirectory(directory: string, trust: PublisherTrustStore): Promise<{
  manifest: Manifest
  digest: string
  signatures: PackageSignatureSet
}> {
  const manifest = await readManifest(directory)
  if (manifest.apiVersion !== API_VERSION) throw new Error('third-party packages must use milksu.plugin/v1')
  validateThirdPartyTools(manifest)
  const digest = await packagePayloadDigest(directory)
  const signatures = await readSignatureSet(directory)
  if (signatures.publisher !== manifest.publisher?.name) {
    throw new Error('signature publisher does not match the manifest')
  }
  const proofs = verifySignatureSet(signatures, digest)
  const primary = proofs.get(manifest.publisher?.keyId ?? '')
  if (!primary || !manifest.publisher?.keyId) {
    throw new Error('manifest publisher key is not a valid package signer')
  }
  const trusted = trust.publishers[manifest.publisher.keyId]
  if (!trusted || trusted.publicKey !== primary.publicKey || trusted.name !== manifest.publisher.name) {
    throw new Error('plugin publisher is not trusted')
  }
  return { manifest, digest, signatures }
}

export function trustedProof(store: PublisherTrustStore, publisher: string, proof: PackageSignatureProof): boolean {
  const trusted = store.publishers[proof.keyId]
  return Boolean(trusted && trusted.name === publisher && trusted.publicKey === proof.publicKey)
}

export function decodeTrustStore(value: unknown): PublisherTrustStore {
  if (!isObject(value)) return { schema: 'milksu.plugin-publishers/v1', publishers: {} }
  rejectUnknownKeys(value, TRUST_KEYS, 'publisher trust')
  const publishers: Record<string, TrustedPublisher> = {}
  if (isObject(value.publishers)) {
    for (const [key, raw] of Object.entries(value.publishers)) {
      if (!isObject(raw)) continue
      rejectUnknownKeys(raw, PUBLISHER_KEYS, 'publisher')
      publishers[key] = {
        name: String(raw.name ?? ''),
        keyId: String(raw.keyId ?? ''),
        publicKey: String(raw.publicKey ?? ''),
        trustedAt: String(raw.trustedAt ?? ''),
      }
    }
  }
  return { schema: String(value.schema ?? ''), publishers }
}

export function signEd25519(privateKeyRaw: Buffer, message: Buffer): Buffer {
  const seed = privateKeyRaw.subarray(0, 32)
  const pkcs8 = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed])
  const key = createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' })
  return sign(null, message, key)
}
