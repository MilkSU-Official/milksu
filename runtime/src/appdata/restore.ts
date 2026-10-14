import { createHash } from 'node:crypto'
import { chmod, copyFile, lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { BACKUP_DATABASES, managedBackupPath, rejectSymlinkParents, validateArchiveName, validateBackup, type BackupValidation } from './backup.ts'
import { secureRoot, writeJSONAtomically } from './fs.ts'
import { CURRENT_DATA_LAYOUT_VERSION, DATA_LAYOUT_FILE, DATA_LAYOUT_SCHEMA, ensureDataLayout, type DataLayout } from './layout.ts'
import { readZipFile } from './zip.ts'

const RESTORE_DIRECTORY_NAME = join('backups', 'restore')
const PENDING_RESTORE_NAME = 'pending.zip'
const RESTORE_TRANSACTION_NAME = 'transaction.json'
const RESTORE_RESULT_NAME = 'last-result.json'
const RESTORE_TRANSACTION_SCHEMA = 'milksu-restore-transaction/v1'
const RESTORE_RESULT_SCHEMA = 'milksu-restore-result/v1'
const MAX_BACKUP_ARCHIVE_BYTES = 2 * 1024 * 1024 * 1024
const MAX_DATA_LAYOUT_BYTES = 16 * 1024

function restoreManagedPaths(): string[] {
  const values = [
    DATA_LAYOUT_FILE,
    join('config', 'settings.json'),
    join('data', 'stores', 'conversations'),
    join('data', 'agent', 'home', 'attachments'),
    join('data', 'agent', 'home', 'pi', 'sessions'),
    join('data', 'domain', 'research', 'artifacts'),
  ]
  for (const databasePath of BACKUP_DATABASES) {
    values.push(databasePath, `${databasePath}-wal`, `${databasePath}-shm`, `${databasePath}-journal`)
  }
  return values
}

export type BackupRestoreStage = {
  createdAt: string
  fileCount: number
  bytes: number
  requiresRestart: boolean
  cancelled?: boolean
}

export type BackupRestoreResult = {
  schema: string
  applied: boolean
  appliedAt?: string
  createdAt?: string
  fileCount?: number
  bytes?: number
  rollbackPath?: string
  recoveredInterruptedRestore?: boolean
}

type RestoreTransactionPath = {
  path: string
  hadTarget: boolean
  touched?: boolean
}

type RestoreTransaction = {
  schema: string
  phase: string
  stageDirectory: string
  rollbackDirectory: string
  validation: BackupValidation
  paths: RestoreTransactionPath[]
}

export async function stageBackupRestore(root: string, source: string): Promise<BackupRestoreStage> {
  root = await secureRoot(root)
  source = await secureRestoreSource(root, source)
  const validation = await validateBackup(source)
  await validateBackupDataLayout(source)
  const restoreDirectory = await ensureRestoreDirectory(root)
  const pendingPath = join(restoreDirectory, PENDING_RESTORE_NAME)
  const temporary = join(restoreDirectory, `.pending-${process.pid}-${Date.now()}.zip`)
  await copyFile(source, temporary)
  await chmod(temporary, 0o600)
  await rename(temporary, pendingPath)
  await chmod(pendingPath, 0o600)
  return {
    createdAt: validation.createdAt,
    fileCount: validation.fileCount,
    bytes: validation.bytes,
    requiresRestart: true,
  }
}

export async function applyPendingRestore(root: string): Promise<BackupRestoreResult> {
  await mkdir(root, { recursive: true, mode: 0o700 })
  root = await secureRoot(root)
  const recovered = await recoverInterruptedRestore(root)
  const restoreDirectory = await ensureRestoreDirectory(root)
  const pendingPath = join(restoreDirectory, PENDING_RESTORE_NAME)
  let info
  try {
    info = await lstat(pendingPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { schema: RESTORE_RESULT_SCHEMA, applied: false, recoveredInterruptedRestore: recovered }
    }
    throw error
  }
  if (info.isSymbolicLink() || !info.isFile()) {
    throw new Error('pending restore must be a regular file')
  }
  const validation = await validateBackup(pendingPath)
  await validateBackupDataLayout(pendingPath)
  const stageDirectory = await mkdtemp(join(root, 'backups', '.milksu-restore-stage-'))
  await chmod(stageDirectory, 0o700)
  try {
    await extractBackupData(pendingPath, stageDirectory)
    const rollbackDirectory = await mkdtemp(join(root, 'backups', '.milksu-restore-rollback-'))
    await chmod(rollbackDirectory, 0o700)
    const transaction: RestoreTransaction = {
      schema: RESTORE_TRANSACTION_SCHEMA,
      phase: 'applying',
      stageDirectory,
      rollbackDirectory,
      validation,
      paths: [],
    }
    for (const relativePath of restoreManagedPaths()) {
      const target = join(root, relativePath)
      let hadTarget = false
      try {
        await lstat(target)
        hadTarget = true
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw new Error(`inspect restore target ${JSON.stringify(relativePath)}: ${error instanceof Error ? error.message : error}`)
        }
      }
      transaction.paths.push({ path: relativePath.replaceAll(sep, '/'), hadTarget })
    }
    await writeRestoreTransaction(root, transaction)
    try {
      for (let index = 0; index < transaction.paths.length; index += 1) {
        const relativePath = transaction.paths[index]!.path.replaceAll('/', sep)
        await rejectSymlinkParents(root, relativePath)
        transaction.paths[index]!.touched = true
        await writeRestoreTransaction(root, transaction)
        await applyRestorePath(root, stageDirectory, rollbackDirectory, relativePath)
      }
      await ensureDataLayout(root)
      transaction.phase = 'committed'
      await writeRestoreTransaction(root, transaction)
      const result = await finalizeCommittedRestore(root, transaction)
      result.recoveredInterruptedRestore = recovered
      return result
    } catch (error) {
      await rollbackRestoreTransaction(root, transaction)
      throw error
    }
  } finally {
    await rm(stageDirectory, { recursive: true, force: true })
  }
}

async function recoverInterruptedRestore(root: string): Promise<boolean> {
  try {
    const transaction = await readRestoreTransaction(root)
    if (transaction.phase === 'committed') {
      await finalizeCommittedRestore(root, transaction)
      return true
    }
    if (transaction.phase !== 'applying') {
      throw new Error(`unsupported restore transaction phase ${JSON.stringify(transaction.phase)}`)
    }
    await rollbackRestoreTransaction(root, transaction)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

async function applyRestorePath(root: string, stageDirectory: string, rollbackDirectory: string, relativePath: string): Promise<void> {
  if (!managedRestorePath(relativePath)) {
    throw new Error(`unsupported restore path ${JSON.stringify(relativePath)}`)
  }
  await rejectSymlinkParents(root, relativePath)
  const target = join(root, relativePath)
  const rollback = join(rollbackDirectory, relativePath)
  try {
    await lstat(target)
    await mkdir(dirname(rollback), { recursive: true, mode: 0o700 })
    await rename(target, rollback)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new Error(`inspect current data ${JSON.stringify(relativePath)}: ${error instanceof Error ? error.message : error}`)
    }
  }
  const source = join(stageDirectory, 'data', relativePath)
  try {
    await lstat(source)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw new Error(`inspect restored data ${JSON.stringify(relativePath)}: ${error instanceof Error ? error.message : error}`)
  }
  await mkdir(dirname(target), { recursive: true, mode: 0o700 })
  await rename(source, target)
}

async function rollbackRestoreTransaction(root: string, transaction: RestoreTransaction): Promise<void> {
  const rollbackDirectory = validateRestoreWorkDirectory(root, transaction.rollbackDirectory, '.milksu-restore-rollback-')
  for (let index = transaction.paths.length - 1; index >= 0; index -= 1) {
    const item = transaction.paths[index]!
    if (!item.touched) continue
    const relativePath = item.path.replaceAll('/', sep)
    if (!managedRestorePath(relativePath)) {
      throw new Error(`unsupported rollback path ${JSON.stringify(relativePath)}`)
    }
    await rejectSymlinkParents(root, relativePath)
    const target = join(root, relativePath)
    const rollback = join(rollbackDirectory, relativePath)
    try {
      await lstat(rollback)
      await rm(target, { recursive: true, force: true })
      await mkdir(dirname(target), { recursive: true, mode: 0o700 })
      await rename(rollback, target)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new Error(`inspect rollback data ${JSON.stringify(relativePath)}: ${error instanceof Error ? error.message : error}`)
      }
      if (!item.hadTarget) await rm(target, { recursive: true, force: true })
    }
  }
  await rm(transaction.stageDirectory, { recursive: true, force: true })
  await rm(rollbackDirectory, { recursive: true, force: true })
  try {
    await rm(join(root, RESTORE_DIRECTORY_NAME, RESTORE_TRANSACTION_NAME), { force: true })
  } catch (error) {
    throw new Error(`clear restore transaction: ${error instanceof Error ? error.message : error}`)
  }
}

async function finalizeCommittedRestore(root: string, transaction: RestoreTransaction): Promise<BackupRestoreResult> {
  const rollbackDirectory = validateRestoreWorkDirectory(root, transaction.rollbackDirectory, '.milksu-restore-rollback-')
  const restoreDirectory = await ensureRestoreDirectory(root)
  const pendingPath = join(restoreDirectory, PENDING_RESTORE_NAME)
  try {
    await lstat(pendingPath)
    await rename(pendingPath, join(rollbackDirectory, 'applied-backup.zip'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new Error(`inspect applied backup: ${error instanceof Error ? error.message : error}`)
    }
  }
  const stamp = new Date().toISOString().replace(/[-:]/gu, '').replace(/\.\d{3}Z$/u, 'Z')
  const rollbackPath = join(restoreDirectory, `rollback-${stamp}`)
  try {
    await lstat(rollbackDirectory)
    await rename(rollbackDirectory, rollbackPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new Error(`inspect restore rollback snapshot: ${error instanceof Error ? error.message : error}`)
    }
  }
  await rm(join(restoreDirectory, RESTORE_TRANSACTION_NAME), { force: true })
  const result: BackupRestoreResult = {
    schema: RESTORE_RESULT_SCHEMA,
    applied: true,
    appliedAt: new Date().toISOString(),
    createdAt: transaction.validation.createdAt,
    fileCount: transaction.validation.fileCount,
    bytes: transaction.validation.bytes,
    rollbackPath,
  }
  await writeJSONAtomically(join(restoreDirectory, RESTORE_RESULT_NAME), result)
  await rm(transaction.stageDirectory, { recursive: true, force: true })
  return result
}

async function validateBackupDataLayout(path: string): Promise<void> {
  const archive = await readZipFile(path)
  for (const item of archive) {
    if (item.name.replaceAll('\\', '/') !== `data/${DATA_LAYOUT_FILE}`) continue
    if (item.data.length > MAX_DATA_LAYOUT_BYTES) {
      throw new Error(`backup ${DATA_LAYOUT_FILE} is too large`)
    }
    const layout = JSON.parse(item.data.toString('utf8')) as DataLayout
    if (layout.schema !== DATA_LAYOUT_SCHEMA) {
      throw new Error(`unsupported backup data layout schema ${JSON.stringify(layout.schema)}`)
    }
    if (layout.version < 0 || layout.version > CURRENT_DATA_LAYOUT_VERSION) {
      throw new Error(`backup data layout version ${layout.version} is not supported by this MilkSU build`)
    }
    return
  }
  throw new Error(`backup is missing ${DATA_LAYOUT_FILE}`)
}

async function extractBackupData(path: string, destination: string): Promise<void> {
  const archive = await readZipFile(path)
  const expected = new Map<string, { path: string; bytes: number; sha256: string }>()
  for (const item of archive) {
    if (item.name.replaceAll('\\', '/') !== 'manifest.json') continue
    const manifest = JSON.parse(item.data.toString('utf8')) as { files: Array<{ path: string; bytes: number; sha256: string }> }
    for (const file of manifest.files) expected.set(file.path.replaceAll('\\', '/'), file)
    break
  }
  for (const item of archive) {
    const name = validateArchiveName(item.name)
    if (name === 'manifest.json') continue
    const relativePath = name.slice('data/'.length).replaceAll('/', sep)
    if (!managedBackupPath(relativePath)) {
      throw new Error(`backup contains unsupported restore path ${JSON.stringify(relativePath)}`)
    }
    const slash = relativePath.replaceAll(sep, '/')
    const expectedFile = expected.get(slash)
    if (!expectedFile) throw new Error(`backup manifest is missing restored file ${JSON.stringify(relativePath)}`)
    const target = join(destination, 'data', relativePath)
    await mkdir(dirname(target), { recursive: true, mode: 0o700 })
    const digest = createHash('sha256').update(item.data).digest('hex')
    if (digest !== expectedFile.sha256) {
      throw new Error(`restored file checksum mismatch for ${JSON.stringify(relativePath)}`)
    }
    await writeFile(target, item.data, { flag: 'wx', mode: 0o600 })
    expected.delete(slash)
  }
  if (expected.size !== 0) throw new Error('backup did not extract every manifest file')
}

function managedRestorePath(path: string): boolean {
  const clean = resolve('/', path).slice(1)
  return restoreManagedPaths().some((allowed) => clean === allowed)
}

async function ensureRestoreDirectory(root: string): Promise<string> {
  const path = join(root, RESTORE_DIRECTORY_NAME)
  try {
    const info = await lstat(path)
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new Error('restore state path must be a directory')
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new Error(`inspect restore state directory: ${error instanceof Error ? error.message : error}`)
    }
    await mkdir(path, { recursive: true, mode: 0o700 })
  }
  await chmod(path, 0o700)
  return path
}

async function secureRestoreSource(root: string, source: string): Promise<string> {
  source = resolve(String(source ?? '').trim())
  if (!source || source === '.' || !isAbsolute(source)) {
    throw new Error('restore source must be an absolute path')
  }
  const relativePath = relative(root, source)
  if (relativePath === '' || (relativePath !== '..' && !relativePath.startsWith(`..${sep}`))) {
    throw new Error('restore source must be outside the MilkSU data directory')
  }
  const info = await lstat(source)
  if (info.isSymbolicLink() || !info.isFile()) {
    throw new Error('restore source must be a regular file')
  }
  if (info.size > MAX_BACKUP_ARCHIVE_BYTES) {
    throw new Error('restore source exceeds the supported size')
  }
  return source
}

async function writeRestoreTransaction(root: string, transaction: RestoreTransaction): Promise<void> {
  const restoreDirectory = await ensureRestoreDirectory(root)
  await writeJSONAtomically(join(restoreDirectory, RESTORE_TRANSACTION_NAME), transaction)
}

async function readRestoreTransaction(root: string): Promise<RestoreTransaction> {
  const path = join(root, RESTORE_DIRECTORY_NAME, RESTORE_TRANSACTION_NAME)
  const info = await lstat(path)
  if (info.isSymbolicLink() || !info.isFile() || info.size > 1024 * 1024) {
    throw new Error('restore transaction is invalid')
  }
  const transaction = JSON.parse(await readFile(path, 'utf8')) as RestoreTransaction
  if (transaction.schema !== RESTORE_TRANSACTION_SCHEMA) {
    throw new Error(`unsupported restore transaction schema ${JSON.stringify(transaction.schema)}`)
  }
  if (transaction.paths.length !== restoreManagedPaths().length) {
    throw new Error('restore transaction path set is incomplete')
  }
  validateRestoreWorkDirectory(root, transaction.rollbackDirectory, '.milksu-restore-rollback-')
  if (transaction.phase !== 'committed') {
    validateRestoreWorkDirectory(root, transaction.stageDirectory, '.milksu-restore-stage-')
  }
  return transaction
}

function validateRestoreWorkDirectory(root: string, path: string, prefix: string): string {
  path = resolve(path)
  const parent = join(root, 'backups')
  if (dirname(path) !== parent || !basename(path).startsWith(prefix)) {
    throw new Error('restore work directory is outside the expected location')
  }
  return path
}


