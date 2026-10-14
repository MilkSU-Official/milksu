import { createHash } from 'node:crypto'
import { chmod, lstat, mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

export const DIRECTORY_OVERRIDE_ENV = 'MILKSU_USER_ARTIFACTS_DIR'
export const KIND_CODING = 'Coding'
export const KIND_CVE = 'CVE'
export const KIND_LAB = 'Lab'

const CVE_ID_PATTERN = /^CVE-[0-9]{4}-[0-9]+$/i

export function userArtifactDirectory(
  env: Record<string, string | undefined> = process.env,
  userHome = homedir(),
): string {
  const override = String(env[DIRECTORY_OVERRIDE_ENV] ?? '').trim()
  if (override) return validateRoot(override)
  if (process.platform === 'win32') return join(userHome, 'MilkSU')
  return join(userHome, 'Documents', 'MilkSU')
}

export async function ensureUserArtifactDirectory(root: string): Promise<string> {
  const validated = validateRoot(root)
  for (const directory of [validated, join(validated, KIND_CODING), join(validated, KIND_CVE), join(validated, KIND_LAB)]) {
    await mkdir(directory, { recursive: true, mode: 0o700 })
    await protectDirectory(directory)
  }
  return validated
}

export async function userArtifactWorkspace(root: string, kind: string, identity: string, label: string): Promise<string> {
  if (kind !== KIND_CODING && kind !== KIND_CVE && kind !== KIND_LAB) {
    throw new Error('MilkSU can only create Coding, CVE, or Lab workspaces here')
  }
  identity = String(identity ?? '').trim()
  if (!identity) throw new Error('MilkSU artifact workspace identity is required')
  const section = join(await ensureUserArtifactDirectory(root), kind)
  let name = ''
  if (kind === KIND_CVE && CVE_ID_PATTERN.test(String(label ?? '').trim())) {
    name = String(label).trim().toUpperCase()
  } else {
    name = slug(label)
    if (!name) name = kind.toLowerCase()
    name += `-${createHash('sha256').update(identity).digest('hex').slice(0, 8)}`
  }
  const workspace = join(section, name)
  ensureWithin(section, workspace)
  for (const directory of [workspace, join(workspace, '.git')]) {
    try {
      const info = await lstat(directory)
      if (info.isSymbolicLink()) throw new Error('MilkSU artifact workspace must not be a symbolic link')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    await mkdir(directory, { recursive: true, mode: 0o700 })
    await protectDirectory(directory)
  }
  return workspace
}

function validateRoot(value: string): string {
  const clean = resolve(String(value ?? '').trim())
  if (clean === '.' || !isAbsolute(clean)) {
    throw new Error('MilkSU artifact directory must be an absolute path')
  }
  if (dirname(clean) === clean) {
    throw new Error('MilkSU artifact directory must not be the filesystem root')
  }
  if (resolve(homedir()) === clean) {
    throw new Error('MilkSU artifact directory must not be the user home directory')
  }
  return clean
}

async function protectDirectory(path: string): Promise<void> {
  const info = await lstat(path)
  if ((info.mode & 0o777) === 0o700) return
  await chmod(path, 0o700)
}

function ensureWithin(root: string, target: string): void {
  const relativePath = relative(root, target)
  if (relativePath === '..' || relativePath.startsWith(`..${sep}`)) {
    throw new Error('MilkSU artifact workspace escaped its section')
  }
}

function slug(value: string): string {
  let previousSeparator = false
  let count = 0
  let result = ''
  for (const character of String(value ?? '').trim()) {
    if (/[A-Za-z0-9]/u.test(character)) {
      result += character
      count += 1
      previousSeparator = false
    } else if (character === '-' || character === '_' || /\s/u.test(character)) {
      if (result && !previousSeparator) {
        result += '-'
        count += 1
        previousSeparator = true
      }
    }
    if (count >= 48) break
  }
  return result.replace(/^-+|-+$/gu, '')
}
