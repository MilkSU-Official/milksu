import { chmod, lstat, mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { MAX_PACKAGE_METADATA_BYTES } from './types.ts'

export class Mutex {
  private chain: Promise<void> = Promise.resolve()

  run<T>(fn: () => Promise<T>): Promise<T> {
    let release!: () => void
    const previous = this.chain
    this.chain = new Promise<void>((resolveNext) => {
      release = resolveNext
    })
    return previous.then(fn, fn).finally(() => release())
  }
}

export function trim(value: unknown): string {
  return String(value ?? '').trim()
}

export function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function rejectUnknownKeys(value: Record<string, unknown>, allowed: Set<string>, label: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`${label}: json: unknown field "${key}"`)
  }
}

export function parseJsonObject(raw: string, label: string): Record<string, unknown> {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch (error) {
    throw new Error(`decode ${label}: ${error instanceof Error ? error.message : error}`)
  }
  if (!isObject(value)) throw new Error(`decode ${label}: must be an object`)
  return value
}

export async function isRegularFile(path: string, maxBytes?: number): Promise<{ size: number }> {
  const info = await lstat(path)
  if (info.isSymbolicLink() || !info.isFile()) {
    throw new Error(`${path} must be a regular, non-symlink file`)
  }
  if (maxBytes !== undefined && info.size > maxBytes) {
    throw new Error(`${path} is larger than ${maxBytes} bytes`)
  }
  return { size: info.size }
}

export async function isRegularDirectory(path: string): Promise<boolean> {
  try {
    const info = await lstat(path)
    return !info.isSymbolicLink() && info.isDirectory()
  } catch {
    return false
  }
}

export function validSlashPath(relativePath: string): boolean {
  if (!relativePath || relativePath.includes('\\') || relativePath.includes('\0')) return false
  if (relativePath.startsWith('/')) return false
  const parts = relativePath.split('/')
  for (const part of parts) {
    if (part === '' || part === '.' || part === '..') return false
  }
  return true
}

export function secureJoin(root: string, relativePath: string): string {
  const clean = relativePath.split('/').join(sep)
  const path = join(root, clean)
  const check = relative(root, path)
  if (check === '..' || check.startsWith(`..${sep}`) || isAbsolute(check)) {
    throw new Error('entry path escapes the plugin package')
  }
  return path
}

export async function securePackageFile(directory: string, relativePath: string, maxBytes: number): Promise<string> {
  const trimmed = trim(relativePath)
  if (!validSlashPath(trimmed)) {
    throw new Error('entry path must be a canonical relative slash path')
  }
  const root = resolve(directory)
  const path = secureJoin(root, trimmed)
  const info = await lstat(path)
  if (info.isSymbolicLink() || !info.isFile()) {
    throw new Error(`${trimmed} must be a regular, non-symlink file`)
  }
  if (info.size > maxBytes) {
    throw new Error(`${trimmed} is larger than ${maxBytes} bytes`)
  }
  return path
}

export async function readBoundedFile(path: string, maxBytes: number): Promise<Buffer> {
  await isRegularFile(path, maxBytes)
  return readFile(path)
}

export async function readStrictJsonFile(path: string, maxBytes: number): Promise<unknown> {
  await isRegularFile(path, maxBytes)
  const raw = await readFile(path, 'utf8')
  if (Buffer.byteLength(raw) > maxBytes) {
    throw new Error('metadata must be a bounded regular, non-symlink file')
  }
  return JSON.parse(raw)
}

export async function atomicWriteFile(path: string, payload: Buffer | string, maxBytes = MAX_PACKAGE_METADATA_BYTES): Promise<void> {
  const buffer = typeof payload === 'string' ? Buffer.from(payload) : payload
  if (buffer.length > maxBytes) throw new Error('plugin metadata is too large')
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = join(dirname(path), `.plugin-metadata-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  const handle = await open(temporary, 'wx', 0o600)
  try {
    await handle.writeFile(buffer)
    await handle.sync()
    await handle.close()
    await chmod(temporary, 0o600)
    await rename(temporary, path)
  } catch (error) {
    await handle.close().catch(() => {})
    await unlink(temporary).catch(() => {})
    throw error
  }
}

export async function atomicWriteJson(path: string, value: unknown, maxBytes = MAX_PACKAGE_METADATA_BYTES): Promise<void> {
  await atomicWriteFile(path, `${JSON.stringify(value, null, 2)}\n`, maxBytes)
}

export function hasPermission(permissions: string[] | undefined, permission: string): boolean {
  return (permissions ?? []).includes(permission)
}

export function contributesSlot(slots: string[] | undefined, slot: string): boolean {
  return (slots ?? []).includes(slot)
}

export function canonicalJsonMap(value: Record<string, unknown> | undefined): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value ?? {})) {
    result[key] = item
  }
  return result
}

export function encodeJson(value: unknown): string {
  return JSON.stringify(value)
}

export function isValidJson(value: unknown): boolean {
  try {
    JSON.parse(JSON.stringify(value))
    return true
  } catch {
    return false
  }
}
