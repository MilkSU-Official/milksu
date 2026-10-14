import { randomBytes } from 'node:crypto'
import { lstat, mkdir, readFile, rename, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import {
  API_VERSION,
  INSTALLED_INDEX_SCHEMA,
  MAX_PACKAGE_ARCHIVE_BYTES,
  MAX_PACKAGE_METADATA_BYTES,
  MAX_PLUGIN_STORAGE_BYTES,
  PUBLISHER_TRUST_SCHEMA,
  STORAGE_SNAPSHOT_SCHEMA,
  type Manifest,
  type Permission,
  type PluginOptions,
  type StagedPackageReview,
} from './types.ts'
import { packagePayloadDigest, validDigest } from './digest.ts'
import { readManifest } from './manifest.ts'
import { compareSemanticVersions, parseSemanticVersion } from './semver.ts'
import { validateSameMajorCompatibility, validateThirdPartyTools } from './schema.ts'
import {
  decodeTrustStore,
  readSignatureSet,
  trustedProof,
  type PackageSignatureSet,
  type PublisherTrustStore,
  verifyInstalledDirectory,
  verifySignatureSet,
} from './signatures.ts'
import { clonePersistedState, type PersistedState } from './state.ts'
import { extractPluginArchive } from './zip.ts'
import { atomicWriteJson, isObject, readStrictJsonFile, rejectUnknownKeys, secureJoin, trim, validSlashPath } from './util.ts'

export type InstalledVersion = {
  id: string
  version: string
  publisherKeyId: string
  directory: string
  digest: string
  storageSnapshot?: string
}

export type InstalledPlugin = {
  active: InstalledVersion
  previous?: InstalledVersion
}

export type InstalledIndex = {
  schema: string
  plugins: Record<string, InstalledPlugin>
}

export type StagedPackage = {
  directory: string
  manifest: Manifest
  signatures: PackageSignatureSet
  review: StagedPackageReview
}

const INDEX_KEYS = new Set(['schema', 'plugins'])
const VERSION_KEYS = new Set(['id', 'version', 'publisherKeyId', 'directory', 'digest', 'storageSnapshot'])
const INSTALLED_KEYS = new Set(['active', 'previous'])

export function defaultInstalledIndex(): InstalledIndex {
  return { schema: INSTALLED_INDEX_SCHEMA, plugins: {} }
}

export function defaultTrustStore(): PublisherTrustStore {
  return { schema: PUBLISHER_TRUST_SCHEMA, publishers: {} }
}

export function installedIndexPath(options: PluginOptions): string {
  return join(options.dataDirectory, 'services', 'plugins', 'installed.json')
}

export function trustStorePath(options: PluginOptions): string {
  return join(options.dataDirectory, 'services', 'plugins', 'publishers.json')
}

export function stagingDirectory(options: PluginOptions): string {
  return join(options.dataDirectory, 'services', 'plugins', 'staging')
}

export async function readInstalledIndex(path: string): Promise<InstalledIndex> {
  try {
    const parsed = await readStrictJsonFile(path, MAX_PACKAGE_METADATA_BYTES)
    if (!isObject(parsed)) return defaultInstalledIndex()
    rejectUnknownKeys(parsed, INDEX_KEYS, 'installed plugin index')
    if (String(parsed.schema ?? '') !== INSTALLED_INDEX_SCHEMA) {
      throw new Error(`unsupported installed plugin index schema "${String(parsed.schema ?? '')}"`)
    }
    const plugins: Record<string, InstalledPlugin> = {}
    if (isObject(parsed.plugins)) {
      for (const [id, raw] of Object.entries(parsed.plugins)) {
        if (!isObject(raw)) continue
        rejectUnknownKeys(raw, INSTALLED_KEYS, 'installed plugin')
        plugins[id] = {
          active: decodeVersion(raw.active),
          previous: raw.previous ? decodeVersion(raw.previous) : undefined,
        }
      }
    }
    return { schema: INSTALLED_INDEX_SCHEMA, plugins }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return defaultInstalledIndex()
    throw new Error(`read installed plugin index: ${error instanceof Error ? error.message : error}`)
  }
}

function decodeVersion(raw: unknown): InstalledVersion {
  if (!isObject(raw)) throw new Error('installed plugin version is invalid')
  rejectUnknownKeys(raw, VERSION_KEYS, 'installed version')
  return {
    id: String(raw.id ?? ''),
    version: String(raw.version ?? ''),
    publisherKeyId: String(raw.publisherKeyId ?? ''),
    directory: String(raw.directory ?? ''),
    digest: String(raw.digest ?? ''),
    storageSnapshot: raw.storageSnapshot ? String(raw.storageSnapshot) : undefined,
  }
}

export async function readTrustStoreFile(path: string): Promise<PublisherTrustStore> {
  try {
    const parsed = await readStrictJsonFile(path, MAX_PACKAGE_METADATA_BYTES)
    const store = decodeTrustStore(parsed)
    if (store.schema !== PUBLISHER_TRUST_SCHEMA) {
      throw new Error(`unsupported publisher trust schema "${store.schema}"`)
    }
    return store
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return defaultTrustStore()
    throw new Error(`read publisher trust store: ${error instanceof Error ? error.message : error}`)
  }
}

export function resolveInstalledDirectory(options: PluginOptions, relativePath: string): string {
  if (!validSlashPath(relativePath)) throw new Error('installed plugin path is invalid')
  const root = resolve(options.installedDirectory)
  return secureJoin(root, relativePath)
}

export function resolveStorageSnapshot(options: PluginOptions, relativePath: string): string {
  if (!validSlashPath(relativePath)) throw new Error('plugin storage snapshot path is invalid')
  const root = resolve(join(options.dataDirectory, 'services', 'plugins', 'rollback'))
  return secureJoin(root, relativePath)
}

export async function writeStorageSnapshot(
  options: PluginOptions,
  id: string,
  version: InstalledVersion,
  state: PersistedState,
): Promise<string> {
  const values = state.storage[id] ?? {}
  const encoded = JSON.stringify(values)
  if (Object.keys(values).length > 64 || Buffer.byteLength(encoded) > MAX_PLUGIN_STORAGE_BYTES) {
    throw new Error('plugin storage cannot be snapshotted within its quota')
  }
  let storageVersion = state.storage_versions[id] ?? 0
  if (storageVersion === 0) {
    try {
      const directory = resolveInstalledDirectory(options, version.directory)
      const manifest = await readManifest(directory)
      storageVersion = manifest.storageVersion ?? 1
    } catch {
      storageVersion = 1
    }
  }
  const relativePath = `${id}/${version.version}-${version.digest.slice(0, 16)}.json`
  const path = resolveStorageSnapshot(options, relativePath)
  await atomicWriteJson(path, { schema: STORAGE_SNAPSHOT_SCHEMA, version: storageVersion, values })
  return relativePath
}

export async function readStorageSnapshot(options: PluginOptions, relativePath: string): Promise<{ version: number; values: Record<string, unknown> }> {
  const path = resolveStorageSnapshot(options, relativePath)
  const parsed = await readStrictJsonFile(path, MAX_PACKAGE_METADATA_BYTES)
  if (!isObject(parsed) || String(parsed.schema ?? '') !== STORAGE_SNAPSHOT_SCHEMA || !parsed.version) {
    throw new Error('plugin storage snapshot is invalid')
  }
  const values = isObject(parsed.values) ? parsed.values : {}
  mergeStorageWrites(values, {})
  return { version: Number(parsed.version), values }
}

export function mergeStorageWrites(current: Record<string, unknown> | undefined, writes: Record<string, unknown>): Record<string, unknown> {
  const values: Record<string, unknown> = { ...(current ?? {}) }
  for (const [key, raw] of Object.entries(writes)) {
    if (raw === null) {
      delete values[key]
      continue
    }
    values[key] = raw
  }
  if (Object.keys(values).length > 64) throw new Error('plugin storage exceeds its 64-key quota')
  const encoded = JSON.stringify(values)
  if (Buffer.byteLength(encoded) > MAX_PLUGIN_STORAGE_BYTES) {
    throw new Error('plugin storage exceeds its 256 KiB quota')
  }
  return values
}

export function permissionsExpanded(current: Permission[], next: Permission[]): boolean {
  const seen = new Set(current)
  return next.some((permission) => !seen.has(permission))
}

export function hasStorageMigration(manifest: Manifest, from: number, to: number): boolean {
  return (manifest.storageMigrations ?? []).some((migration) => migration.from === from && migration.to === to)
}

export async function inspectArchive(path: string): Promise<Buffer> {
  const info = await lstat(path)
  if (info.isSymbolicLink() || !info.isFile() || info.size > MAX_PACKAGE_ARCHIVE_BYTES) {
    throw new Error(`plugin package must be a regular .milksu-plugin file no larger than ${MAX_PACKAGE_ARCHIVE_BYTES >> 20} MiB`)
  }
  return readFile(path)
}

export async function extractToStaging(options: PluginOptions, archivePath: string): Promise<{ token: string; directory: string }> {
  const archive = await inspectArchive(archivePath)
  const token = randomBytes(16).toString('hex')
  const directory = join(stagingDirectory(options), token)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  try {
    await extractPluginArchive(archive, directory)
  } catch (error) {
    await rm(directory, { recursive: true, force: true })
    throw error
  }
  return { token, directory }
}

export async function reviewStagedDirectory(
  options: PluginOptions,
  directory: string,
  token: string,
  currentOfficialIds: Set<string>,
  currentInstalled: InstalledIndex,
  trust: PublisherTrustStore,
  hostVersion: string,
  validateHost: (manifest: Manifest) => void,
  currentStorageVersion: (id: string) => number,
  hasStoredData: (id: string) => boolean,
): Promise<{ manifest: Manifest; signatures: PackageSignatureSet; review: StagedPackageReview }> {
  const manifest = await readManifest(directory)
  if (manifest.apiVersion !== API_VERSION) {
    throw new Error('third-party installation accepts only milksu.plugin/v1 packages')
  }
  validateThirdPartyTools(manifest)
  validateHost(manifest)
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
  const primaryTrusted = trustedProof(trust, manifest.publisher.name, primary)
  let rotationTrusted = false
  for (const [keyID, proof] of proofs) {
    if (keyID !== manifest.publisher.keyId && trustedProof(trust, manifest.publisher.name, proof)) {
      rotationTrusted = true
    }
  }
  const review: StagedPackageReview = {
    token,
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    publisher: manifest.publisher,
    fingerprint: manifest.publisher.keyId,
    permissions: [...manifest.permissions],
    surfaces: [...(manifest.contributes?.slots ?? [])],
    tools: [...(manifest.contributes?.tools ?? [])],
    host_min_version: manifest.host?.minVersion ?? '',
    required_capabilities: [...(manifest.host?.requiredCapabilities ?? [])],
    trusted: primaryTrusted || rotationTrusted,
    key_rotation: !primaryTrusted && rotationTrusted,
    upgrade: false,
    permission_expansion: false,
    major_version_change: false,
    storage_migration: false,
    storage_reset_required: false,
    digest,
  }
  const current = currentInstalled.plugins[manifest.id]
  if (current) {
    review.upgrade = true
    review.current_version = current.active.version
    const comparison = compareSemanticVersions(manifest.version, current.active.version)
    if (comparison <= 0) throw new Error('plugin upgrade version must increase strictly')
    if (current.active.publisherKeyId !== manifest.publisher.keyId) {
      if (!proofs.has(current.active.publisherKeyId) || !rotationTrusted) {
        throw new Error('publisher key change requires valid signatures from both the old and new keys')
      }
      review.key_rotation = true
    }
    const currentDirectory = resolveInstalledDirectory(options, current.active.directory)
    const verified = await verifyInstalledDirectory(currentDirectory, trust)
    if (verified.manifest.id !== manifest.id || verified.manifest.version !== current.active.version || verified.digest.toLowerCase() !== current.active.digest.toLowerCase()) {
      throw new Error('current plugin version failed signature or integrity verification')
    }
    review.permission_expansion = permissionsExpanded(verified.manifest.permissions, manifest.permissions)
    let storageVersion = verified.manifest.storageVersion ?? 0
    const persisted = currentStorageVersion(manifest.id)
    if (persisted) storageVersion = persisted
    if ((manifest.storageVersion ?? 0) < storageVersion) {
      throw new Error('plugin upgrade cannot decrease storageVersion')
    }
    if ((manifest.storageVersion ?? 0) > storageVersion && hasStoredData(manifest.id)) {
      review.storage_migration = hasStorageMigration(manifest, storageVersion, manifest.storageVersion ?? 0)
      review.storage_reset_required = !review.storage_migration
    }
    review.major_version_change = parseSemanticVersion(verified.manifest.version).major !== parseSemanticVersion(manifest.version).major
    if (!review.major_version_change) validateSameMajorCompatibility(verified.manifest, manifest)
  } else if (currentOfficialIds.has(manifest.id)) {
    throw new Error('third-party package cannot replace an official plugin')
  }
  void validDigest
  void hostVersion
  return { manifest, signatures, review }
}

export async function moveStagedToInstalled(options: PluginOptions, stagedDirectory: string, relativePath: string): Promise<string> {
  const destination = resolveInstalledDirectory(options, relativePath)
  try {
    await lstat(destination)
    throw new Error('this signed plugin version is already installed')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && !(error instanceof Error && error.message === 'this signed plugin version is already installed')) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    if (error instanceof Error && error.message === 'this signed plugin version is already installed') throw error
  }
  await mkdir(join(destination, '..'), { recursive: true, mode: 0o700 })
  await rename(stagedDirectory, destination)
  return destination
}

export { verifyInstalledDirectory, verifySignatureSet, trustedProof }
