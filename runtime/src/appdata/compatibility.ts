import { existsSync, lstatSync } from 'node:fs'
import { lstat } from 'node:fs/promises'
import { basename, isAbsolute, join, sep } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { sanitizeDiagnosticText } from './diagnostics-text.ts'
import { secureRoot } from './fs.ts'

export const DATABASE_STATE_COMPATIBLE = 'compatible'
export const DATABASE_STATE_MISSING = 'missing'
export const DATABASE_STATE_NEWER = 'newer'
export const DATABASE_STATE_CORRUPT = 'corrupt'
export const DATABASE_STATE_REMAINING = 'remaining'

export type DatabaseDescriptor = {
  logicalName: string
  relativePath: string
  supported: number
}

export type DatabaseCompatibilityStatus = {
  logicalName: string
  relativePath: string
  current?: number
  supported?: number
  state: string
  error?: string
}

export function inspectDatabaseCompatibility(
  root: string,
  descriptors: DatabaseDescriptor[],
): DatabaseCompatibilityStatus[] {
  let validatedRoot = ''
  let rootError = ''
  try {
    // secureRoot is async; compatibility inspection is used after boot when the root exists.
  } catch {
    // filled below
  }
  const result: DatabaseCompatibilityStatus[] = []
  for (const descriptor of descriptors) {
    if (basename(descriptor.relativePath).toLowerCase() === 'credentials.db') continue
    if (descriptor.supported < 0) {
      result.push({
        logicalName: descriptor.logicalName,
        relativePath: descriptor.relativePath.replaceAll('\\', '/'),
        state: DATABASE_STATE_CORRUPT,
        error: sanitizeDatabaseError('invalid database descriptor: negative supported version', root),
      })
      continue
    }
    if (!safeDescriptorPath(descriptor.relativePath)) {
      result.push({
        logicalName: descriptor.logicalName,
        relativePath: descriptor.relativePath.replaceAll('\\', '/'),
        state: DATABASE_STATE_CORRUPT,
        error: sanitizeDatabaseError('unsafe database path', root),
        supported: supportedDatabaseVersion(descriptor.supported),
      })
      continue
    }
    if (descriptor.supported === 0) {
      result.push({
        logicalName: descriptor.logicalName,
        relativePath: descriptor.relativePath.replaceAll('\\', '/'),
        state: DATABASE_STATE_REMAINING,
      })
      continue
    }
    if (rootError) {
      result.push({
        logicalName: descriptor.logicalName,
        relativePath: descriptor.relativePath.replaceAll('\\', '/'),
        state: DATABASE_STATE_CORRUPT,
        error: rootError,
        supported: supportedDatabaseVersion(descriptor.supported),
      })
      continue
    }
    result.push(inspectOne(validatedRoot || root, descriptor))
  }
  return result
}

export async function inspectDatabaseCompatibilityAsync(
  root: string,
  descriptors: DatabaseDescriptor[],
): Promise<DatabaseCompatibilityStatus[]> {
  let validatedRoot = ''
  let rootError = ''
  try {
    validatedRoot = await secureRoot(root)
  } catch (error) {
    rootError = sanitizeDatabaseError(error instanceof Error ? error.message : String(error), root)
  }
  const result: DatabaseCompatibilityStatus[] = []
  for (const descriptor of descriptors) {
    if (basename(descriptor.relativePath).toLowerCase() === 'credentials.db') continue
    if (descriptor.supported < 0) {
      result.push({
        logicalName: descriptor.logicalName,
        relativePath: descriptor.relativePath.replaceAll('\\', '/'),
        state: DATABASE_STATE_CORRUPT,
        error: sanitizeDatabaseError('invalid database descriptor: negative supported version', root),
      })
      continue
    }
    if (!safeDescriptorPath(descriptor.relativePath)) {
      result.push({
        logicalName: descriptor.logicalName,
        relativePath: descriptor.relativePath.replaceAll('\\', '/'),
        state: DATABASE_STATE_CORRUPT,
        error: sanitizeDatabaseError('unsafe database path', root),
        supported: supportedDatabaseVersion(descriptor.supported),
      })
      continue
    }
    if (descriptor.supported === 0) {
      result.push({
        logicalName: descriptor.logicalName,
        relativePath: descriptor.relativePath.replaceAll('\\', '/'),
        state: DATABASE_STATE_REMAINING,
      })
      continue
    }
    if (rootError) {
      result.push({
        logicalName: descriptor.logicalName,
        relativePath: descriptor.relativePath.replaceAll('\\', '/'),
        state: DATABASE_STATE_CORRUPT,
        error: rootError,
        supported: supportedDatabaseVersion(descriptor.supported),
      })
      continue
    }
    result.push(await inspectOneAsync(validatedRoot, descriptor))
  }
  return result
}

function inspectOne(root: string, descriptor: DatabaseDescriptor): DatabaseCompatibilityStatus {
  const status: DatabaseCompatibilityStatus = {
    logicalName: descriptor.logicalName,
    relativePath: descriptor.relativePath.replaceAll('\\', '/'),
    supported: supportedDatabaseVersion(descriptor.supported),
    state: DATABASE_STATE_MISSING,
  }
  try {
    const { path, missing } = resolveDatabaseFileSync(root, descriptor.relativePath)
    if (missing) return status
    const current = readMigrationHistory(path)
    status.current = current
    status.state = current > descriptor.supported ? DATABASE_STATE_NEWER : DATABASE_STATE_COMPATIBLE
  } catch (error) {
    status.state = DATABASE_STATE_CORRUPT
    status.error = sanitizeDatabaseError(error instanceof Error ? error.message : String(error), root)
  }
  return status
}

async function inspectOneAsync(root: string, descriptor: DatabaseDescriptor): Promise<DatabaseCompatibilityStatus> {
  const status: DatabaseCompatibilityStatus = {
    logicalName: descriptor.logicalName,
    relativePath: descriptor.relativePath.replaceAll('\\', '/'),
    supported: supportedDatabaseVersion(descriptor.supported),
    state: DATABASE_STATE_MISSING,
  }
  try {
    const { path, missing } = await resolveDatabaseFile(root, descriptor.relativePath)
    if (missing) return status
    const current = readMigrationHistory(path)
    status.current = current
    status.state = current > descriptor.supported ? DATABASE_STATE_NEWER : DATABASE_STATE_COMPATIBLE
  } catch (error) {
    status.state = DATABASE_STATE_CORRUPT
    status.error = sanitizeDatabaseError(error instanceof Error ? error.message : String(error), root)
  }
  return status
}

function resolveDatabaseFileSync(root: string, relativePath: string): { path: string; missing: boolean } {
  const components = relativePath.split('/')
  let accumulated = root
  const walk = [root, ...components.map((component) => {
    accumulated = join(accumulated, component)
    return accumulated
  })]
  accumulated = root
  for (let index = 0; index < walk.length; index += 1) {
    const candidate = walk[index]!
    if (!existsSync(candidate)) return { path: '', missing: true }
    const info = lstatSync(candidate)
    if (info.isSymbolicLink()) throw new Error('database path contains a symbolic link')
    if (index === walk.length - 1) {
      if (!info.isFile()) throw new Error('database path is not a regular file')
      break
    }
    if (!info.isDirectory()) throw new Error('database path contains a non-directory component')
  }
  return { path: walk[walk.length - 1]!, missing: false }
}

async function resolveDatabaseFile(root: string, relativePath: string): Promise<{ path: string; missing: boolean }> {
  const components = relativePath.split('/')
  const walk: string[] = [root]
  let accumulated = root
  for (const component of components) {
    accumulated = join(accumulated, component)
    walk.push(accumulated)
  }
  for (let index = 0; index < walk.length; index += 1) {
    const candidate = walk[index]!
    let info
    try {
      info = await lstat(candidate)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { path: '', missing: true }
      throw error
    }
    if (info.isSymbolicLink()) throw new Error('database path contains a symbolic link')
    if (index === walk.length - 1) {
      if (!info.isFile()) throw new Error('database path is not a regular file')
      break
    }
    if (!info.isDirectory()) throw new Error('database path contains a non-directory component')
  }
  return { path: walk[walk.length - 1]!, missing: false }
}

function readMigrationHistory(path: string): number {
  const db = new DatabaseSync(path, { readOnly: true, timeout: 5000 })
  try {
    const columns = (db.prepare('PRAGMA table_info(schema_migrations)').all() as Array<{ name: string }>).map((row) => row.name)
    if (columns.length === 0) throw new Error('schema_migrations table is missing')
    const expectedA = ['version', 'applied_at']
    const expectedB = ['version', 'name', 'applied_at']
    if (columns.join(',') !== expectedA.join(',') && columns.join(',') !== expectedB.join(',')) {
      throw new Error('corrupt migration history: schema_migrations has an unknown column layout, want exactly [version applied_at] or [version name applied_at]')
    }
    const versions = (db.prepare('SELECT version FROM schema_migrations').all() as Array<{ version: number }>)
      .map((row) => Number(row.version))
      .sort((left, right) => left - right)
    for (let index = 0; index < versions.length; index += 1) {
      const version = versions[index]!
      if (version <= 0) throw new Error(`corrupt migration history: invalid version ${version}`)
      if (index > 0 && version === versions[index - 1]) {
        throw new Error(`corrupt migration history: duplicate version ${version}`)
      }
      if (version !== index + 1) {
        throw new Error(`corrupt migration history: missing version ${index + 1}`)
      }
    }
    return versions.length === 0 ? 0 : versions[versions.length - 1]!
  } finally {
    db.close()
  }
}

function safeDescriptorPath(relativePath: string): boolean {
  if (!String(relativePath ?? '').trim()) return false
  if (relativePath.startsWith('/')) return false
  const native = relativePath.replaceAll('/', sep)
  if (isAbsolute(native)) return false
  if (native === '.' || native === '..' || native.startsWith(`..${sep}`)) return false
  return !native.split(sep).includes('..')
}

function supportedDatabaseVersion(supported: number): number | undefined {
  return supported > 0 ? supported : undefined
}

function sanitizeDatabaseError(value: string, root: string): string {
  return sanitizeDiagnosticText(value.replaceAll(root, '<data>'))
}
