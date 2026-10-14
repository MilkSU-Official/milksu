import { homedir } from 'node:os'
import { chmod, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, isAbsolute, join, resolve } from 'node:path'
import { codingProjectMemoryPath } from '../home.ts'

const MAX_RECENTS = 12
const generatedScratchWorkspace = /\/(?:MilkSU\/Coding\/(?:新编码任务|临时任务)-[a-f0-9]{8}|agent-workspaces\/Coding\/无项目任务-[a-f0-9]{8})$/i

export type RecentProject = {
  path: string
  name: string
  usedAt: number
}

type StoredMemory = {
  lastWorkspacePath?: string
  recents?: RecentProject[]
}

export type ProjectMemorySnapshot = {
  lastWorkspacePath?: string
  effectiveWorkspace: string
  homeDirectory: string
  recents: RecentProject[]
}

class Mutex {
  private chain: Promise<void> = Promise.resolve()

  run<T>(fn: () => Promise<T>): Promise<T> {
    const previous = this.chain
    let release!: () => void
    this.chain = new Promise((resolveNext) => {
      release = resolveNext
    })
    return previous.then(fn).finally(() => release())
  }
}

export function isGeneratedScratchWorkspace(path: string): boolean {
  return generatedScratchWorkspace.test(path.replaceAll('\\', '/'))
}

export function normalizeStoredPath(value: string): string {
  return resolve(value.trim()).replace(/[\\/]+$/, '')
}

export async function resolveProjectDirectory(value: string, userHome = homedir()): Promise<string> {
  let next = value.trim()
  if (!next) throw new Error('project directory is required')
  if (next === '~' || next.startsWith('~/')) {
    next = join(userHome, next.slice(2))
  }
  const absolute = isAbsolute(next) ? next : resolve(next)
  const { realpath } = await import('node:fs/promises')
  let resolved: string
  try {
    resolved = await realpath(absolute)
  } catch (error) {
    throw new Error(`resolve project directory: ${error instanceof Error ? error.message : error}`)
  }
  const info = await stat(resolved)
  if (!info.isDirectory()) throw new Error('project path must be a directory')
  return resolved
}

async function comparableProjectPath(value: string, userHome: string): Promise<string> {
  try {
    return await resolveProjectDirectory(value, userHome)
  } catch {
    return normalizeStoredPath(value)
  }
}

function rememberRecent(recents: RecentProject[], next: RecentProject): RecentProject[] {
  const out: RecentProject[] = [next]
  for (const recent of recents) {
    if (normalizeStoredPath(recent.path) === normalizeStoredPath(next.path)) continue
    out.push(recent)
    if (out.length >= MAX_RECENTS) break
  }
  return out
}

export class ProjectMemoryStore {
  private readonly mutex = new Mutex()
  private readonly path: string
  private readonly userHome: string

  constructor(path: string, userHome = homedir()) {
    this.path = path
    this.userHome = userHome
  }

  static async open(home: string, userHome = homedir()): Promise<ProjectMemoryStore> {
    const path = codingProjectMemoryPath(home)
    await mkdir(join(path, '..'), { recursive: true, mode: 0o700 })
    return new ProjectMemoryStore(path, userHome)
  }

  get(): Promise<ProjectMemorySnapshot> {
    return this.mutex.run(() => this.snapshotLocked())
  }

  remember(path: string): Promise<ProjectMemorySnapshot> {
    return this.mutex.run(async () => {
      const resolved = await resolveProjectDirectory(path, this.userHome)
      if (isGeneratedScratchWorkspace(resolved)) return this.snapshotLocked()
      const memory = await this.readLocked()
      memory.lastWorkspacePath = resolved
      memory.recents = rememberRecent(memory.recents ?? [], {
        path: resolved,
        name: basename(resolved),
        usedAt: Date.now(),
      })
      await this.writeLocked(memory)
      return this.snapshotFromLocked(memory)
    })
  }

  forget(path: string): Promise<ProjectMemorySnapshot> {
    return this.mutex.run(async () => {
      const normalized = await comparableProjectPath(path, this.userHome)
      const memory = await this.readLocked()
      const remaining: RecentProject[] = []
      for (const recent of memory.recents ?? []) {
        if (await comparableProjectPath(recent.path, this.userHome) === normalized) continue
        remaining.push(recent)
      }
      memory.recents = remaining
      if (
        memory.lastWorkspacePath
        && await comparableProjectPath(memory.lastWorkspacePath, this.userHome) === normalized
      ) {
        memory.lastWorkspacePath = memory.recents[0]?.path ?? ''
      }
      await this.writeLocked(memory)
      return this.snapshotFromLocked(memory)
    })
  }

  private async snapshotLocked(): Promise<ProjectMemorySnapshot> {
    return this.snapshotFromLocked(await this.readLocked())
  }

  private async snapshotFromLocked(memory: StoredMemory): Promise<ProjectMemorySnapshot> {
    const home = resolve(this.userHome)
    let effective = home
    try {
      const resolved = await resolveProjectDirectory(memory.lastWorkspacePath ?? '', this.userHome)
      if (!isGeneratedScratchWorkspace(resolved)) effective = resolved
    } catch {
      // missing last project falls back to the user home
    }
    const recents: RecentProject[] = []
    for (const recent of memory.recents ?? []) {
      try {
        await stat(recent.path)
        recents.push(recent)
      } catch {
        // drop missing recents
      }
    }
    return {
      lastWorkspacePath: (memory.lastWorkspacePath ?? '').trim() || undefined,
      effectiveWorkspace: effective,
      homeDirectory: home,
      recents,
    }
  }

  private async readLocked(): Promise<StoredMemory> {
    try {
      const data = await readFile(this.path, 'utf8')
      return JSON.parse(data) as StoredMemory
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
      if (error instanceof SyntaxError) return {}
      throw new Error(`read coding project memory: ${error instanceof Error ? error.message : error}`)
    }
  }

  private async writeLocked(memory: StoredMemory): Promise<void> {
    await mkdir(join(this.path, '..'), { recursive: true, mode: 0o700 })
    await writeFile(this.path, `${JSON.stringify(memory, null, 2)}\n`, { mode: 0o600 })
    try {
      await chmod(this.path, 0o600)
    } catch {
      // Windows file mode is best-effort
    }
  }
}

export function cleanAgentWorkspaceName(name: string): string {
  const cleaned = name.trim().replace(/[ .]+$/, '')
  if (!cleaned) throw new Error('project name is empty')
  if ([...cleaned].length > 64) throw new Error('project name is too long')
  if (cleaned === '.' || cleaned === '..') throw new Error('project name is reserved')
  for (const ch of cleaned) {
    const code = ch.charCodeAt(0)
    if (code < 0x20 || code === 0x7f) throw new Error('project name contains control characters')
  }
  if (/[/\\<>|"?*:]/.test(cleaned)) throw new Error('project name contains reserved characters')
  return cleaned
}

export async function normalizeAgentWorkspaceSelection(value: string, userHome = homedir()): Promise<string> {
  return resolveProjectDirectory(value, userHome)
}

export async function createAgentWorkspace(parent: string, name: string, userHome = homedir()): Promise<string> {
  const resolvedParent = await normalizeAgentWorkspaceSelection(parent, userHome)
  const cleaned = cleanAgentWorkspaceName(name)
  let target = join(resolvedParent, cleaned)
  for (let suffix = 2; ; suffix += 1) {
    try {
      await stat(target)
      target = join(resolvedParent, `${cleaned}-${suffix}`)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new Error(`inspect project directory: ${error instanceof Error ? error.message : error}`)
      }
      break
    }
  }
  await mkdir(target, { mode: 0o755 })
  return target
}
