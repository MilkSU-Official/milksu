import { createHash } from 'node:crypto'
import { lstat, readdir, readFile } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'
import { MAX_PACKAGE_BYTES, MAX_PACKAGE_FILES, SIGNATURE_FILE } from './types.ts'

const HEX_DIGEST = /^[a-f0-9]{64}$/

export function validDigest(value: string): boolean {
  return HEX_DIGEST.test(String(value ?? '').trim().toLowerCase())
}

function writeU64(value: number): Buffer {
  const buffer = Buffer.alloc(8)
  buffer.writeBigUInt64BE(BigInt(value))
  return buffer
}

async function walkRegularFiles(root: string): Promise<string[]> {
  const paths: string[] = []
  const caseFolded = new Map<string, string>()
  const stack = [root]
  while (stack.length) {
    const current = stack.pop()!
    const entries = await readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      const path = join(current, entry.name)
      const info = await lstat(path)
      if (info.isSymbolicLink()) throw new Error(`plugin package contains symlink: ${path}`)
      if (entry.isDirectory()) {
        stack.push(path)
        continue
      }
      if (!info.isFile()) throw new Error(`plugin package contains non-regular file: ${path}`)
      const rel = relative(root, path).split(sep).join('/')
      const folded = rel.toLowerCase()
      const previous = caseFolded.get(folded)
      if (previous && previous !== rel) {
        throw new Error(`plugin package paths collide across filesystems: ${previous} and ${rel}`)
      }
      caseFolded.set(folded, rel)
      paths.push(rel)
    }
  }
  return paths
}

export async function digestDirectory(directory: string, ignored?: Set<string>): Promise<string> {
  const root = resolve(directory)
  const paths = (await walkRegularFiles(root)).filter((path) => !ignored?.has(path))
  if (paths.length > MAX_PACKAGE_FILES) {
    throw new Error(`plugin package contains more than ${MAX_PACKAGE_FILES} files`)
  }
  paths.sort()
  const hash = createHash('sha256')
  let total = 0
  for (const rel of paths) {
    const path = join(root, ...rel.split('/'))
    const info = await lstat(path)
    total += info.size
    if (total > MAX_PACKAGE_BYTES) {
      throw new Error(`plugin package is larger than ${MAX_PACKAGE_BYTES} bytes`)
    }
    hash.update(writeU64(Buffer.byteLength(rel)))
    hash.update(rel)
    hash.update(writeU64(info.size))
    hash.update(await readFile(path))
  }
  return hash.digest('hex')
}

export function packageDigest(directory: string): Promise<string> {
  return digestDirectory(directory)
}

export function packagePayloadDigest(directory: string): Promise<string> {
  return digestDirectory(directory, new Set([SIGNATURE_FILE]))
}

export async function canonicalArchivePaths(directory: string): Promise<string[]> {
  const paths = await walkRegularFiles(resolve(directory))
  paths.sort()
  return paths
}
