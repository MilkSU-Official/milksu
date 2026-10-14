import { chmod, lstat, mkdir, open, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

export async function secureRoot(root: string): Promise<string> {
  root = resolve(String(root ?? '').trim())
  if (!root || root === '.' || !isAbsolute(root)) {
    throw new Error('MilkSU data directory must be absolute')
  }
  const info = await lstat(root)
  if (info.isSymbolicLink()) throw new Error('MilkSU data directory must not be a symbolic link')
  if (!info.isDirectory()) throw new Error('MilkSU data path is not a directory')
  return root
}

export function secureRelativePath(path: string): string {
  path = String(path ?? '').trim()
  const clean = resolve('/', path).slice(1) || path
  const native = clean.replaceAll('/', sep)
  if (!path || isAbsolute(native) || native === '.' || native === '..' || native.startsWith(`..${sep}`)) {
    throw new Error(`invalid backup path ${JSON.stringify(path)}`)
  }
  return native
}

export async function writeJSONAtomically(path: string, value: unknown): Promise<void> {
  const payload = `${JSON.stringify(value, null, 2)}\n`
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = join(dirname(path), `.milksu-state-${process.pid}-${Date.now()}`)
  const handle = await open(temporary, 'w')
  try {
    await handle.chmod(0o600)
    await handle.writeFile(payload)
    await handle.sync()
  } finally {
    await handle.close()
  }
  await rename(temporary, path)
  await chmod(path, 0o600)
}

export async function writeBytesAtomically(path: string, data: Buffer | string, mode = 0o600): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = join(dirname(path), `.milksu-state-${process.pid}-${Date.now()}`)
  await writeFile(temporary, data, { mode })
  const handle = await open(temporary, 'r+')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
  await rename(temporary, path)
  await chmod(path, mode)
}

export async function isSymlink(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isSymbolicLink()
  } catch {
    return false
  }
}

export async function pathInside(root: string, target: string): Promise<boolean> {
  const relativePath = relative(root, target)
  return relativePath === '' || (relativePath !== '..' && !relativePath.startsWith(`..${sep}`))
}

export async function removeIfExists(path: string): Promise<void> {
  try {
    await unlink(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}
