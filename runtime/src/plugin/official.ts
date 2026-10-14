import { createHash } from 'node:crypto'
import { chmod, lstat, mkdir, readdir, readFile, rename, rm } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'
import { existsSync } from 'node:fs'
import { findProjectRoot } from '../sidecar.ts'

function writeU64(value: number): Buffer {
  const buffer = Buffer.alloc(8)
  buffer.writeBigUInt64BE(BigInt(value))
  return buffer
}

async function walkFiles(root: string): Promise<Array<{ path: string; payload: Buffer }>> {
  const files: Array<{ path: string; payload: Buffer }> = []
  const stack = [root]
  while (stack.length) {
    const current = stack.pop()!
    const entries = await readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      const path = join(current, entry.name)
      const info = await lstat(path)
      if (info.isSymbolicLink()) throw new Error(`embedded plugin entry is not a regular file: ${path}`)
      if (entry.isDirectory()) {
        stack.push(path)
        continue
      }
      if (!info.isFile()) throw new Error(`embedded plugin entry is not a regular file: ${path}`)
      files.push({
        path: relative(root, path).split(sep).join('/'),
        payload: await readFile(path),
      })
    }
  }
  files.sort((a, b) => a.path.localeCompare(b.path))
  return files
}

function digestFiles(files: Array<{ path: string; payload: Buffer }>): string {
  const hash = createHash('sha256')
  for (const file of files) {
    hash.update(writeU64(Buffer.byteLength(file.path)))
    hash.update(file.path)
    hash.update(writeU64(file.payload.length))
    hash.update(file.payload)
  }
  return hash.digest('hex')
}

export function findOfficialSource(env: NodeJS.ProcessEnv = process.env): string {
  const override = String(env.MILKSU_PLUGIN_OFFICIAL ?? '').trim()
  if (override && existsSync(join(override, 'plugins.lock.json'))) return override
  try {
    const root = findProjectRoot(env)
    const candidate = join(root, 'plugins', 'official')
    if (existsSync(join(candidate, 'plugins.lock.json'))) return candidate
  } catch {
    // packaged runtime without a checkout
  }
  return ''
}

export async function materializeOfficial(dataDirectory: string, source = findOfficialSource()): Promise<string> {
  if (!source) return ''
  const files = await walkFiles(source)
  const digest = digestFiles(files)
  const parent = join(dataDirectory, 'services', 'plugins', 'bundled')
  const root = join(parent, digest)
  const officialRoot = join(root, 'official')
  try {
    const info = await lstat(root)
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new Error('embedded plugin cache target is not a regular directory')
    }
    await verifyMaterialized(officialRoot, files)
    return officialRoot
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  await mkdir(parent, { recursive: true, mode: 0o700 })
  const temporary = join(parent, `.materialize-${process.pid}-${Date.now()}`)
  const temporaryOfficial = join(temporary, 'official')
  try {
    for (const file of files) {
      const destination = join(temporaryOfficial, ...file.path.split('/'))
      await mkdir(dirname(destination), { recursive: true, mode: 0o700 })
      const { writeFile } = await import('node:fs/promises')
      await writeFile(destination, file.payload, { flag: 'wx', mode: 0o600 })
      await chmod(destination, 0o600)
    }
    await verifyMaterialized(temporaryOfficial, files)
    await rename(temporary, root)
    return officialRoot
  } catch (error) {
    await rm(temporary, { recursive: true, force: true }).catch(() => {})
    try {
      await verifyMaterialized(officialRoot, files)
      return officialRoot
    } catch {
      throw error
    }
  }
}

async function verifyMaterialized(root: string, expected: Array<{ path: string; payload: Buffer }>): Promise<void> {
  const actual = await walkFiles(root)
  if (actual.length !== expected.length) {
    throw new Error(`cache file count is ${actual.length}, expected ${expected.length}`)
  }
  const map = new Map(actual.map((file) => [file.path, file.payload]))
  for (const file of expected) {
    const payload = map.get(file.path)
    if (!payload || !payload.equals(file.payload)) throw new Error(`cache file ${file.path} differs`)
  }
}
