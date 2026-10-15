import { createPrivateKey, createPublicKey, generateKeyPairSync } from 'node:crypto'
import { chmod, lstat, mkdir, mkdtemp, open, readdir, readFile, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { packageDigest, packagePayloadDigest, canonicalArchivePaths } from './digest.ts'
import { readManifest } from './manifest.ts'
import { invokeRuntime, runtimeInvocation } from './runtime.ts'
import { validateThirdPartyTools } from './schema.ts'
import { compareSemanticVersions } from './semver.ts'
import { fingerprintPublicKey, signEd25519, verifySignatureSet, readSignatureSet } from './signatures.ts'
import {
  API_VERSION,
  DEVELOPMENT_HOST_VERSION,
  HOST_CAPABILITIES,
  LEGACY_API_VERSION,
  MAX_MANIFEST_BYTES,
  MAX_PACKAGE_ARCHIVE_BYTES,
  PUBLISHER_KEY_SCHEMA,
  SIGNATURE_FILE,
  SIGNATURE_SCHEMA,
  type Manifest,
  type PackageRecord,
  type PluginOptions,
} from './types.ts'
import { isObject, readStrictJsonFile, rejectUnknownKeys, trim } from './util.ts'
import { createDeterministicZip, extractPluginArchive } from './zip.ts'

export type PublisherKeyDescriptor = {
  publisher: string
  key_id: string
  path: string
}

export type PackageInspection = {
  manifest: Manifest
  digest: string
  signers?: string[]
  archive_size?: number
  file_count: number
  compatible: boolean
  host_version: string
}

export type PluginAuthorOptions = {
  hostVersion?: string
  nodeExecutable?: string
  typeScriptWorker?: string
  invokeLua?: PluginOptions['invokeLua']
}

export type PluginTemplateOptions = {
  runtime: string
  id: string
  name: string
  publisher: string
  keyId: string
  out?: string
}

type PublisherKeyFile = {
  schema: string
  publisher: string
  keyId: string
  publicKey: string
  privateKey: string
}

const PUBLISHER_KEY_KEYS = new Set(['schema', 'publisher', 'keyId', 'publicKey', 'privateKey'])
const PLUGIN_ID = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/
const KEY_ID = /^[a-f0-9]{64}$/
const ED25519_PRIVATE_SIZE = 64

function prettyJSON(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

async function writeExclusiveAuthorJSON(path: string, value: unknown): Promise<void> {
  const payload = Buffer.from(prettyJSON(value))
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const handle = await open(path, 'wx', 0o600)
  let complete = false
  try {
    await handle.writeFile(payload)
    await handle.sync()
    await handle.close()
    await chmod(path, 0o600)
    complete = true
  } catch (error) {
    await handle.close().catch(() => {})
    throw error
  } finally {
    if (!complete) await unlink(path).catch(() => {})
  }
}

function publicKeyFromPrivate(privateRaw: Buffer): Buffer {
  const seed = privateRaw.subarray(0, 32)
  const pkcs8 = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed])
  const key = createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' })
  const spki = createPublicKey(key).export({ type: 'spki', format: 'der' }) as Buffer
  return spki.subarray(-32)
}

export async function generatePublisherKey(publisher: string, outputPath: string): Promise<PublisherKeyDescriptor> {
  const name = trim(publisher)
  if (!name || name.length > 96) {
    throw new Error('publisher name must contain 1-96 characters')
  }
  try {
    await lstat(outputPath)
    throw new Error('publisher key destination already exists')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const pair = generateKeyPairSync('ed25519')
  const publicDer = pair.publicKey.export({ type: 'spki', format: 'der' }) as Buffer
  const privateDer = pair.privateKey.export({ type: 'pkcs8', format: 'der' }) as Buffer
  const publicRaw = publicDer.subarray(-32)
  const seed = privateDer.subarray(-32)
  const privateRaw = Buffer.concat([seed, publicRaw])
  const keyId = fingerprintPublicKey(publicRaw)
  const value: PublisherKeyFile = {
    schema: PUBLISHER_KEY_SCHEMA,
    publisher: name,
    keyId,
    publicKey: publicRaw.toString('base64'),
    privateKey: privateRaw.toString('base64'),
  }
  await writeExclusiveAuthorJSON(outputPath, value)
  return { publisher: name, key_id: keyId, path: resolve(outputPath) }
}

async function readPublisherKey(path: string): Promise<{ file: PublisherKeyFile; privateKey: Buffer }> {
  const parsed = await readStrictJsonFile(path, MAX_MANIFEST_BYTES)
  if (!isObject(parsed)) throw new Error('publisher key file is invalid')
  rejectUnknownKeys(parsed, PUBLISHER_KEY_KEYS, 'publisher key')
  const file: PublisherKeyFile = {
    schema: String(parsed.schema ?? ''),
    publisher: String(parsed.publisher ?? ''),
    keyId: String(parsed.keyId ?? ''),
    publicKey: String(parsed.publicKey ?? ''),
    privateKey: String(parsed.privateKey ?? ''),
  }
  if (file.schema !== PUBLISHER_KEY_SCHEMA || !trim(file.publisher)) {
    throw new Error('publisher key file is invalid')
  }
  const privateKey = Buffer.from(file.privateKey, 'base64')
  if (privateKey.length !== ED25519_PRIVATE_SIZE) {
    throw new Error('publisher private key is invalid')
  }
  const publicKey = publicKeyFromPrivate(privateKey)
  if (file.keyId !== fingerprintPublicKey(publicKey) || file.publicKey !== publicKey.toString('base64')) {
    throw new Error('publisher key file fingerprint is invalid')
  }
  return { file, privateKey }
}

function buildSignatureSet(publisher: string, digest: string, privateKeys: Buffer[]) {
  const signatures = privateKeys.map((privateKey) => {
    if (privateKey.length !== ED25519_PRIVATE_SIZE) throw new Error('Ed25519 private key is invalid')
    const publicKey = publicKeyFromPrivate(privateKey)
    const message = Buffer.from(`milksu.plugin-package/v1\n${digest.toLowerCase()}`)
    return {
      keyId: fingerprintPublicKey(publicKey),
      publicKey: publicKey.toString('base64'),
      signature: signEd25519(privateKey, message).toString('base64'),
    }
  })
  return { schema: SIGNATURE_SCHEMA, digest, publisher, signatures }
}

async function copyPackageTree(source: string, destination: string): Promise<void> {
  const root = resolve(source)
  const stack = [root]
  while (stack.length) {
    const current = stack.pop()!
    const entries = await readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      const path = join(current, entry.name)
      const info = await lstat(path)
      if (info.isSymbolicLink()) throw new Error(`plugin source contains symlink: ${path}`)
      const rel = relative(root, path)
      const target = join(destination, rel)
      if (info.isDirectory()) {
        await mkdir(target, { recursive: true, mode: 0o700 })
        stack.push(path)
        continue
      }
      if (!info.isFile()) throw new Error(`plugin source contains non-regular file: ${path}`)
      await mkdir(dirname(target), { recursive: true, mode: 0o700 })
      const payload = await readFile(path)
      const handle = await open(target, 'wx', 0o600)
      try {
        await handle.writeFile(payload)
        await handle.close()
      } catch (error) {
        await handle.close().catch(() => {})
        throw error
      }
    }
  }
}

async function loadInvokeLua(): Promise<NonNullable<PluginOptions['invokeLua']>> {
  try {
    const mod = await import('./lua.ts')
    return mod.invokeLua
  } catch {
    return async () => {
      throw new Error('Lua plugin runtime is unavailable')
    }
  }
}

function validateHostCompatibility(manifest: Manifest, hostVersion: string): void {
  if (manifest.apiVersion === LEGACY_API_VERSION) return
  const current = trim(hostVersion) || '0.0.0'
  const comparison = compareSemanticVersions(current, manifest.host?.minVersion ?? '0.0.0')
  if (comparison < 0) {
    throw new Error(`plugin requires MilkSU ${manifest.host?.minVersion} or newer (current ${current})`)
  }
  const available = new Set<string>(HOST_CAPABILITIES)
  for (const capability of manifest.host?.requiredCapabilities ?? []) {
    if (!available.has(capability)) throw new Error(`plugin requires unavailable host capability "${capability}"`)
  }
}

export async function packPlugin(sourceDirectory: string, outputPath: string, keyPaths: string[]): Promise<PackageInspection> {
  if (keyPaths.length === 0 || keyPaths.length > 2) {
    throw new Error('pack requires one key, or old and new keys for rotation')
  }
  if (extname(outputPath).toLowerCase() !== '.milksu-plugin') {
    throw new Error('package output must end in .milksu-plugin')
  }
  try {
    await lstat(outputPath)
    throw new Error('package output already exists')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const temporary = await mkdtemp(join(tmpdir(), 'milksu-plugin-pack-'))
  try {
    await copyPackageTree(sourceDirectory, temporary)
    await unlink(join(temporary, SIGNATURE_FILE)).catch((error) => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    })
    const manifest = await readManifest(temporary)
    if (manifest.apiVersion !== API_VERSION) {
      throw new Error('signed third-party packages must use milksu.plugin/v1')
    }
    validateThirdPartyTools(manifest)
    const privateKeys: Buffer[] = []
    const keyIDs = new Set<string>()
    for (const keyPath of keyPaths) {
      const { file, privateKey } = await readPublisherKey(keyPath)
      if (file.publisher !== manifest.publisher?.name) {
        throw new Error('publisher key name does not match plugin manifest')
      }
      if (keyIDs.has(file.keyId)) {
        throw new Error('publisher key rotation requires two distinct keys')
      }
      keyIDs.add(file.keyId)
      privateKeys.push(privateKey)
    }
    const primary = publicKeyFromPrivate(privateKeys[privateKeys.length - 1]!)
    if (manifest.publisher?.keyId !== fingerprintPublicKey(primary)) {
      throw new Error('manifest publisher keyId must match the final/new signing key')
    }
    const digest = await packagePayloadDigest(temporary)
    const set = buildSignatureSet(manifest.publisher.name, digest, privateKeys)
    await writeFile(join(temporary, SIGNATURE_FILE), prettyJSON(set), { mode: 0o600 })
    await createDeterministicZip(temporary, outputPath)
    try {
      return await verifyPluginPackage(outputPath, manifest.host?.minVersion ?? '')
    } catch (error) {
      await unlink(outputPath).catch(() => {})
      throw error
    }
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

export async function verifyPluginPackage(archivePath: string, hostVersion: string): Promise<PackageInspection> {
  const info = await lstat(archivePath)
  if (info.isSymbolicLink() || !info.isFile() || info.size > MAX_PACKAGE_ARCHIVE_BYTES) {
    throw new Error('plugin archive is not a bounded regular file')
  }
  const temporary = await mkdtemp(join(tmpdir(), 'milksu-plugin-verify-'))
  try {
    await extractPluginArchive(await readFile(archivePath), temporary)
    const manifest = await readManifest(temporary)
    if (manifest.apiVersion !== API_VERSION) {
      throw new Error('third-party package must use milksu.plugin/v1')
    }
    validateThirdPartyTools(manifest)
    const digest = await packagePayloadDigest(temporary)
    const set = await readSignatureSet(temporary)
    const proofs = verifySignatureSet(set, digest)
    if (!manifest.publisher?.keyId || !proofs.has(manifest.publisher.keyId)) {
      throw new Error('manifest publisher key did not sign the package')
    }
    const paths = await canonicalArchivePaths(temporary)
    const signers = [...proofs.keys()].sort()
    let compatible = true
    if (trim(hostVersion)) {
      compatible = compareSemanticVersions(hostVersion, manifest.host?.minVersion ?? '0.0.0') >= 0
    }
    return {
      manifest,
      digest,
      signers,
      archive_size: info.size,
      file_count: paths.length,
      compatible,
      host_version: hostVersion,
    }
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

export async function testPluginSource(sourceDirectory: string, options: PluginAuthorOptions = {}): Promise<PackageInspection> {
  const manifest = await readManifest(sourceDirectory)
  if (manifest.apiVersion !== API_VERSION) {
    throw new Error('public plugin source must use milksu.plugin/v1')
  }
  validateThirdPartyTools(manifest)
  const hostVersion = trim(options.hostVersion) || DEVELOPMENT_HOST_VERSION
  validateHostCompatibility(manifest, hostVersion)
  const digest = await packageDigest(sourceDirectory)
  const record: PackageRecord = {
    manifest,
    directory: sourceDirectory,
    digest,
    source: 'development',
    theme: { default: {}, light: {}, dark: {} },
    errorText: '',
    canRollback: false,
  }
  const runtimeOptions: PluginOptions = {
    officialDirectory: '',
    installedDirectory: '',
    dataDirectory: '',
    hostVersion,
    nodeExecutable: options.nodeExecutable,
    typeScriptWorker: options.typeScriptWorker,
    invokeLua: options.invokeLua ?? await loadInvokeLua(),
  }
  await invokeRuntime(runtimeOptions, record, runtimeInvocation(record, 'health_check', '', {}, hostVersion, {}))
  const paths = await canonicalArchivePaths(sourceDirectory)
  return { manifest, digest, file_count: paths.length, compatible: true, host_version: hostVersion }
}

function luaSkinTemplate(id: string, name: string, publisher: string, keyId: string, hostVersion: string): Record<string, string> {
  const manifest = {
    id,
    name,
    version: '1.0.0',
    apiVersion: API_VERSION,
    publisher: { name: publisher, keyId },
    host: { minVersion: hostVersion, requiredCapabilities: ['runtime.lua.v1', 'theme.surfaces.v1', 'theme.assets.v1'] },
    storageVersion: 1,
    runtime: { kind: 'lua', entry: 'main.lua' },
    theme: { source: 'theme.json' },
    permissions: ['ui.background', 'ui.theme'],
    contributes: { slots: ['app.background'] },
  }
  return {
    'plugin.json': prettyJSON(manifest),
    'main.lua': 'plugin = {}\nfunction plugin.initialize(_context) return "null" end\nfunction plugin.dispose() return "null" end\n',
    'theme.json': '{\n  "default": {},\n  "light": {},\n  "dark": {}\n}\n',
  }
}

function typeScriptToolTemplate(id: string, name: string, publisher: string, keyId: string, hostVersion: string): Record<string, string> {
  const empty = { type: 'object', properties: {}, additionalProperties: false }
  const manifest = {
    id,
    name,
    version: '1.0.0',
    apiVersion: API_VERSION,
    publisher: { name: publisher, keyId },
    host: { minVersion: hostVersion, requiredCapabilities: ['runtime.typescript.v1', 'agent.read-tools.v1'] },
    storageVersion: 1,
    runtime: { kind: 'typescript', entry: 'main.mjs' },
    permissions: ['agent.tools'],
    contributes: {
      tools: [{
        name: 'inspect',
        description: 'Return a bounded local inspection result.',
        inputSchema: empty,
        outputSchema: empty,
        effect: 'read',
        external: 'none',
      }],
    },
  }
  return {
    'plugin.json': prettyJSON(manifest),
    'main.mjs': "export default {\n  initialize(context) { if (context.apiVersion !== 'milksu.plugin/v1') throw new Error('unsupported API') },\n  async call_tool(name) { if (name !== 'inspect') throw new Error('unknown tool'); return {} },\n  dispose() {},\n}\n",
  }
}

export async function createPluginTemplate(options: PluginTemplateOptions): Promise<{ id: string; runtime: string; path: string }> {
  const id = trim(options.id)
  const name = trim(options.name)
  const publisher = trim(options.publisher)
  const keyId = trim(options.keyId)
  if (!PLUGIN_ID.test(id) || !KEY_ID.test(keyId)) {
    throw new Error('create requires a valid --id and 64-character lowercase --key-id')
  }
  if (!name || !publisher) {
    throw new Error('create requires --name and --publisher')
  }
  const runtimeKind = trim(options.runtime) || 'lua'
  const output = trim(options.out) || join('plugins', 'dev', id)
  try {
    await lstat(output)
    throw new Error('template output already exists')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  await mkdir(dirname(output), { recursive: true, mode: 0o700 })
  await mkdir(output, { mode: 0o700 })
  try {
    let files: Record<string, string>
    switch (runtimeKind) {
      case 'lua':
        files = luaSkinTemplate(id, name, publisher, keyId, DEVELOPMENT_HOST_VERSION)
        break
      case 'typescript':
      case 'ts':
        files = typeScriptToolTemplate(id, name, publisher, keyId, DEVELOPMENT_HOST_VERSION)
        break
      default:
        throw new Error('--runtime must be lua or typescript')
    }
    for (const [relative, contents] of Object.entries(files)) {
      const path = join(output, ...relative.split('/'))
      await mkdir(dirname(path), { recursive: true, mode: 0o700 })
      await writeFile(path, contents, { mode: 0o600 })
    }
  } catch (error) {
    await rm(output, { recursive: true, force: true })
    throw error
  }
  return { id, runtime: runtimeKind, path: resolve(output) }
}
