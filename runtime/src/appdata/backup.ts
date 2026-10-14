import { createHash } from 'node:crypto'
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { inspectDatabaseCompatibilityAsync, type DatabaseCompatibilityStatus } from './compatibility.ts'
import { secureRoot } from './fs.ts'
import { DATA_LAYOUT_FILE } from './layout.ts'
import { writeZipFile, readZipFile, type ZipFileEntry } from './zip.ts'

export const BACKUP_SCHEMA = 'milksu-backup/v1'
const MAX_BACKUP_FILE_COUNT = 20_000
const MAX_BACKUP_ARCHIVE_BYTES = 2 * 1024 * 1024 * 1024

export const BACKUP_ROOTS = [
  DATA_LAYOUT_FILE,
  join('data', 'stores', 'conversations'),
  join('data', 'agent', 'home', 'attachments'),
  join('data', 'agent', 'home', 'pi', 'sessions'),
  join('data', 'domain', 'research', 'artifacts'),
]

export const BACKUP_DATABASES = [
  join('data', 'runtime', 'events.sqlite3'),
  join('data', 'stores', 'usage', 'model-usage.sqlite3'),
  join('data', 'domain', 'research', 'research.sqlite3'),
]

const SENSITIVE_BACKUP_PATHS = [
  join('config', 'credentials.db'),
  join('workspaces', 'browser', 'bridge-pairing.json'),
  join('data', 'agent', 'home', 'pi', 'auth.json'),
]

export type DataStatus = {
  directory: string
  fileCount: number
  bytes: number
  lastModifiedAt?: string
  databases?: DatabaseCompatibilityStatus[]
}

export type BackupFile = {
  path: string
  bytes: number
  sha256: string
}

export type BackupManifest = {
  schema: string
  createdAt: string
  platform: string
  credentialsIncluded: boolean
  files: BackupFile[]
  excluded: string[]
}

export type BackupExport = {
  path: string
  createdAt: string
  fileCount: number
  bytes: number
  credentialsIncluded: boolean
  cancelled?: boolean
}

export type BackupValidation = {
  valid: boolean
  schema: string
  createdAt: string
  fileCount: number
  bytes: number
  credentialsIncluded: boolean
}

export async function inspectData(root: string): Promise<DataStatus> {
  root = await secureRoot(root)
  const status: DataStatus = { directory: root, fileCount: 0, bytes: 0 }
  await walkRegularFiles(root, async (path, size, mtime) => {
    status.fileCount += 1
    status.bytes += size
    const stamp = mtime.toISOString()
    if (!status.lastModifiedAt || stamp > status.lastModifiedAt) status.lastModifiedAt = stamp
    void path
  })
  return status
}

export async function exportBackup(root: string, destination: string): Promise<BackupExport> {
  root = await secureRoot(root)
  destination = await secureDestination(root, destination)
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 })

  const snapshots = await snapshotDatabases(root)
  try {
    const seen = new Set<string>()
    const entries: ZipFileEntry[] = []
    const manifest: BackupManifest = {
      schema: BACKUP_SCHEMA,
      createdAt: new Date().toISOString().replace(/\.\d{3}Z$/u, 'Z'),
      platform: `${process.platform}/${process.arch}`,
      credentialsIncluded: false,
      files: [],
      excluded: [
        'API Key 与 Arena Token',
        '浏览器配对令牌',
        'PI 认证文件',
        '临时缓存与工作区沙箱',
      ],
    }
    await addSanitizedSettings(root, seen, manifest, entries)
    for (const relativeRoot of BACKUP_ROOTS) {
      await addBackupRoot(root, relativeRoot, seen, manifest, entries)
    }
    for (const [relativePath, snapshotPath] of Object.entries(snapshots.files)) {
      await addBackupFile(snapshotPath, relativePath, seen, manifest, entries)
    }
    manifest.files.sort((left, right) => left.path.localeCompare(right.path))
    const manifestData = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`)
    entries.push({ name: 'manifest.json', data: manifestData, mode: 0o600 })

    const temporary = join(dirname(destination), `.milksu-backup-${process.pid}-${Date.now()}.zip`)
    await writeZipFile(temporary, entries)
    await chmod(temporary, 0o600)
    await rename(temporary, destination)
    await chmod(destination, 0o600)
    const info = await stat(destination)
    return {
      path: destination,
      createdAt: manifest.createdAt,
      fileCount: manifest.files.length,
      bytes: info.size,
      credentialsIncluded: false,
    }
  } finally {
    await rm(snapshots.directory, { recursive: true, force: true })
  }
}

export async function validateBackup(path: string): Promise<BackupValidation> {
  path = resolve(String(path ?? '').trim())
  if (!path || path === '.' || !isAbsolute(path)) {
    throw new Error('backup path must be absolute')
  }
  const archive = await readZipFile(path)
  if (archive.length > MAX_BACKUP_FILE_COUNT + 1) {
    throw new Error('backup contains too many files')
  }
  const archiveFiles = new Map<string, ZipFileEntry>()
  let total = 0
  let manifest: BackupManifest | undefined
  for (const item of archive) {
    const name = validateArchiveName(item.name)
    if (archiveFiles.has(name)) throw new Error(`backup contains duplicate path ${JSON.stringify(name)}`)
    archiveFiles.set(name, item)
    total += item.data.length
    if (total > MAX_BACKUP_ARCHIVE_BYTES) throw new Error('backup expands beyond the supported size')
    if (name === 'manifest.json') {
      manifest = JSON.parse(item.data.toString('utf8')) as BackupManifest
    }
  }
  if (!manifest || manifest.schema !== BACKUP_SCHEMA) {
    throw new Error(`unsupported backup schema ${JSON.stringify(manifest?.schema ?? '')}`)
  }
  if (manifest.credentialsIncluded) throw new Error('backup unexpectedly contains credentials')
  if (manifest.files.length > MAX_BACKUP_FILE_COUNT) throw new Error('backup manifest contains too many files')

  let bytes = 0
  for (const expected of manifest.files) {
    const name = validateArchiveName(`data/${expected.path}`)
    if (sensitiveBackupPath(expected.path)) {
      throw new Error(`backup contains sensitive path ${JSON.stringify(expected.path)}`)
    }
    const item = archiveFiles.get(name)
    if (!item) throw new Error(`backup is missing ${JSON.stringify(expected.path)}`)
    if (item.data.length !== expected.bytes) {
      throw new Error(`backup size mismatch for ${JSON.stringify(expected.path)}`)
    }
    const digest = createHash('sha256').update(item.data).digest('hex')
    if (digest !== expected.sha256) {
      throw new Error(`backup checksum mismatch for ${JSON.stringify(expected.path)}`)
    }
    archiveFiles.delete(name)
    bytes += expected.bytes
  }
  archiveFiles.delete('manifest.json')
  if (archiveFiles.size !== 0) throw new Error('backup contains files absent from the manifest')
  return {
    valid: true,
    schema: manifest.schema,
    createdAt: manifest.createdAt,
    fileCount: manifest.files.length,
    bytes,
    credentialsIncluded: false,
  }
}

export function validateArchiveName(name: string): string {
  name = String(name ?? '').trim().replaceAll('\\', '/')
  if (!name || name.startsWith('/') || name.includes('\\')) {
    throw new Error(`invalid backup archive path ${JSON.stringify(name)}`)
  }
  const clean = name.split('/').filter((part) => part && part !== '.').join('/')
  if (!clean || clean === '..' || clean.startsWith('../') || clean !== name || name.split('/').includes('..')) {
    throw new Error(`invalid backup archive path ${JSON.stringify(name)}`)
  }
  if (clean !== 'manifest.json' && !clean.startsWith('data/')) {
    throw new Error(`unexpected backup archive path ${JSON.stringify(name)}`)
  }
  return clean
}

export function managedBackupPath(path: string): boolean {
  path = resolve('/', path.replaceAll('/', sep)).slice(1)
  if (path === DATA_LAYOUT_FILE || path === join('config', 'settings.json')) return true
  for (const databasePath of BACKUP_DATABASES) {
    if (path === databasePath) return true
  }
  for (const root of [
    join('data', 'stores', 'conversations'),
    join('data', 'agent', 'home', 'attachments'),
    join('data', 'agent', 'home', 'pi', 'sessions'),
    join('data', 'domain', 'research', 'artifacts'),
  ]) {
    if (path.startsWith(root + sep)) return true
  }
  return false
}

export function sensitiveBackupPath(path: string): boolean {
  const native = resolve('/', String(path).replaceAll('/', sep)).slice(1)
  return SENSITIVE_BACKUP_PATHS.includes(native)
}

export async function secureDestination(root: string, destination: string): Promise<string> {
  destination = resolve(String(destination ?? '').trim())
  if (!destination || destination === '.' || !isAbsolute(destination)) {
    throw new Error('backup destination must be absolute')
  }
  const relativePath = relative(root, destination)
  if (relativePath === '' || (relativePath !== '..' && !relativePath.startsWith(`..${sep}`))) {
    const backups = 'backups'
    if (relativePath === backups || relativePath.startsWith(backups + sep)) return destination
    throw new Error('backup destination must be outside the MilkSU data directory')
  }
  return destination
}

type DatabaseSnapshots = {
  directory: string
  files: Record<string, string>
}

async function snapshotDatabases(root: string): Promise<DatabaseSnapshots> {
  const directory = await mkdtemp(join(tmpdir(), 'milksu-backup-snapshots-'))
  const files: Record<string, string> = {}
  try {
    for (const [index, relativePath] of BACKUP_DATABASES.entries()) {
      await rejectSymlinkParents(root, relativePath)
      const source = join(root, relativePath)
      let info
      try {
        info = await lstat(source)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
        throw new Error(`inspect database ${JSON.stringify(relativePath)}: ${error instanceof Error ? error.message : error}`)
      }
      if (info.isSymbolicLink() || !info.isFile()) {
        throw new Error(`database ${JSON.stringify(relativePath)} must be a regular file`)
      }
      const destination = join(directory, `${String(index).padStart(2, '0')}.sqlite3`)
      const db = new DatabaseSync(source, { timeout: 5000 })
      try {
        db.exec(`VACUUM INTO '${destination.replaceAll("'", "''")}'`)
      } finally {
        db.close()
      }
      files[relativePath] = destination
    }
  } catch (error) {
    await rm(directory, { recursive: true, force: true })
    throw error
  }
  return { directory, files }
}

async function addBackupRoot(
  root: string,
  relativeRoot: string,
  seen: Set<string>,
  manifest: BackupManifest,
  entries: ZipFileEntry[],
): Promise<void> {
  await rejectSymlinkParents(root, relativeRoot)
  const source = join(root, relativeRoot)
  let info
  try {
    info = await lstat(source)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw new Error(`inspect backup source ${JSON.stringify(relativeRoot)}: ${error instanceof Error ? error.message : error}`)
  }
  if (info.isSymbolicLink()) return
  if (info.isFile()) {
    await addBackupFile(source, relativeRoot, seen, manifest, entries)
    return
  }
  if (!info.isDirectory()) return
  await walkRegularFiles(source, async (path) => {
    const relativePath = relative(root, path)
    await addBackupFile(path, relativePath, seen, manifest, entries)
  })
}

async function addBackupFile(
  source: string,
  relativePath: string,
  seen: Set<string>,
  manifest: BackupManifest,
  entries: ZipFileEntry[],
): Promise<void> {
  relativePath = relativePath.replaceAll('\\', '/')
  const native = relativePath.replaceAll('/', sep)
  if (sensitiveBackupPath(native)) return
  if (seen.has(native)) throw new Error(`duplicate backup path ${JSON.stringify(native)}`)
  seen.add(native)
  const data = await readFile(source)
  entries.push({ name: `data/${relativePath.replaceAll(sep, '/')}`, data, mode: 0o600 })
  manifest.files.push({
    path: relativePath.replaceAll(sep, '/'),
    bytes: data.length,
    sha256: createHash('sha256').update(data).digest('hex'),
  })
}

async function addSanitizedSettings(
  root: string,
  seen: Set<string>,
  manifest: BackupManifest,
  entries: ZipFileEntry[],
): Promise<void> {
  const relativePath = join('config', 'settings.json')
  const path = join(root, relativePath)
  let info
  try {
    info = await lstat(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw new Error(`inspect settings for backup: ${error instanceof Error ? error.message : error}`)
  }
  if (info.isSymbolicLink()) return
  if (!info.isFile()) throw new Error('settings for backup must be a regular file')
  const data = await readFile(path)
  if (data.length > 4 * 1024 * 1024) throw new Error('settings file is unexpectedly large')
  const value = JSON.parse(data.toString('utf8')) as unknown
  removeSensitiveJSONFields(value)
  const sanitized = Buffer.from(`${JSON.stringify(value, null, 2)}\n`)
  const slashPath = relativePath.replaceAll(sep, '/')
  if (seen.has(relativePath)) throw new Error(`duplicate backup path ${JSON.stringify(relativePath)}`)
  seen.add(relativePath)
  entries.push({ name: `data/${slashPath}`, data: sanitized, mode: 0o600 })
  manifest.files.push({
    path: slashPath,
    bytes: sanitized.length,
    sha256: createHash('sha256').update(sanitized).digest('hex'),
  })
}

function removeSensitiveJSONFields(value: unknown): void {
  if (Array.isArray(value)) {
    for (const child of value) removeSensitiveJSONFields(child)
    return
  }
  if (!value || typeof value !== 'object') return
  const record = value as Record<string, unknown>
  for (const key of Object.keys(record)) {
    switch (key.toLowerCase().trim()) {
      case 'api_key':
      case 'key':
      case 'token':
      case 'secret':
      case 'password':
        delete record[key]
        break
      default:
        removeSensitiveJSONFields(record[key])
    }
  }
}

export async function rejectSymlinkParents(root: string, relativePath: string): Promise<void> {
  let current = root
  const parts = relativePath.split(sep).filter(Boolean)
  for (const part of parts.slice(0, -1)) {
    current = join(current, part)
    let info
    try {
      info = await lstat(current)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw new Error(`inspect restore parent ${JSON.stringify(relativePath)}: ${error instanceof Error ? error.message : error}`)
    }
    if (info.isSymbolicLink()) {
      throw new Error(`restore parent for ${JSON.stringify(relativePath)} must not be a symlink`)
    }
    if (!info.isDirectory()) {
      throw new Error(`restore parent for ${JSON.stringify(relativePath)} must be a directory`)
    }
  }
}

async function walkRegularFiles(
  root: string,
  visit: (path: string, size: number, mtime: Date) => Promise<void>,
): Promise<void> {
  const stack = [root]
  while (stack.length) {
    const current = stack.pop()!
    let entries
    try {
      entries = await readdir(current, { withFileTypes: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw error
    }
    for (const entry of entries) {
      const path = join(current, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        stack.push(path)
        continue
      }
      if (!entry.isFile()) continue
      const info = await stat(path)
      await visit(path, info.size, info.mtime)
    }
  }
}

export async function inspectLocalDataStatus(root: string, descriptors: Parameters<typeof inspectDatabaseCompatibilityAsync>[1]): Promise<DataStatus> {
  const status = await inspectData(root)
  status.databases = await inspectDatabaseCompatibilityAsync(root, descriptors)
  return status
}
