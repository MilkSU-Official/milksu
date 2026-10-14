import { execFile } from 'node:child_process'
import { lstat, readdir } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join } from 'node:path'
import { promisify } from 'node:util'
import { registerOwnedHandlers } from '../domains.ts'
import type { HandlerContext } from '../handlers.ts'

const execFileAsync = promisify(execFile)

const INSPECT_MAX_FILES = 20_000
const INSPECT_MAX_DURATION_MS = 1500
const INSPECT_MAX_DEPTH = 32
const INSPECT_MAX_BACKUPS = 8

export type DestructiveTargetInspection = {
  path: string
  status: string
  exists: boolean
  isDirectory: boolean
  emptyDirectory: boolean
  fileCount: number
  totalBytes: number
  diskBytes: number
  sampled: boolean
  inGitRepository: boolean
  gitTracked: boolean
  rebuildable: boolean
  backups: string[]
  error?: string
}

function arg<T>(args: unknown[] | undefined, index: number, fallback: T): T {
  if (!args || index >= args.length || args[index] === undefined || args[index] === null) {
    return fallback
  }
  return args[index] as T
}

function slashDepth(value: string): number {
  const trimmed = value.replace(/[/\\]+$/, '')
  let count = 0
  for (const ch of trimmed) {
    if (ch === '/' || ch === '\\') count += 1
  }
  return count
}

function diskBytesOf(info: { blocks?: number }): number {
  if (process.platform === 'win32') return -1
  if (typeof info.blocks !== 'number') return -1
  return info.blocks * 512
}

async function inspectGit(target: string): Promise<{ inRepository: boolean; gitTracked: boolean }> {
  let directory = target
  try {
    const info = await lstat(target)
    if (!info.isDirectory()) directory = dirname(target)
  } catch {
    return { inRepository: false, gitTracked: false }
  }
  try {
    const { stdout } = await execFileAsync('git', ['-C', directory, 'rev-parse', '--show-toplevel'], {
      timeout: 2000,
    })
    if (!String(stdout ?? '').trim()) return { inRepository: false, gitTracked: false }
  } catch {
    return { inRepository: false, gitTracked: false }
  }
  try {
    await execFileAsync('git', ['-C', directory, 'ls-files', '--error-unmatch', '--', target], {
      timeout: 2000,
    })
    return { inRepository: true, gitTracked: true }
  } catch {
    return { inRepository: true, gitTracked: false }
  }
}

async function findSiblingBackups(target: string): Promise<string[]> {
  const directory = dirname(target)
  const base = basename(target)
  let names: string[]
  try {
    names = await readdir(directory)
  } catch {
    return []
  }
  const found: string[] = []
  for (const name of names) {
    if (found.length >= INSPECT_MAX_BACKUPS) break
    if (name === base) continue
    if (
      name.startsWith(`${base}.bak`)
      || name.startsWith(`.${base}.bak`)
      || base.startsWith(`${name}-`)
    ) {
      found.push(join(directory, name))
    }
  }
  return found
}

async function inspectTree(
  target: string,
  result: DestructiveTargetInspection,
): Promise<void> {
  const deadline = Date.now() + INSPECT_MAX_DURATION_MS
  const base = slashDepth(target)
  const stack = [target]
  while (stack.length) {
    const current = stack.pop()!
    if (current !== target) {
      const depth = slashDepth(current) - base
      if (depth > INSPECT_MAX_DEPTH) {
        result.sampled = true
        continue
      }
      if (Date.now() > deadline || result.fileCount >= INSPECT_MAX_FILES) {
        result.sampled = true
        break
      }
      let info
      try {
        info = await lstat(current)
      } catch {
        continue
      }
      result.fileCount += 1
      result.totalBytes += Number(info.size) || 0
      if (result.diskBytes >= 0) {
        const freed = diskBytesOf(info)
        if (freed >= 0) result.diskBytes += freed
        else result.diskBytes = -1
      }
      if (!info.isDirectory() || info.isSymbolicLink()) continue
    }
    let names: string[]
    try {
      names = await readdir(current)
    } catch {
      if (current !== target) result.sampled = true
      continue
    }
    for (const name of names) stack.push(join(current, name))
  }
}

export async function inspectDestructiveTarget(path: string): Promise<DestructiveTargetInspection> {
  const target = String(path ?? '').trim()
  const result: DestructiveTargetInspection = {
    path: target,
    status: '',
    exists: false,
    isDirectory: false,
    emptyDirectory: false,
    fileCount: 0,
    totalBytes: 0,
    diskBytes: 0,
    sampled: false,
    inGitRepository: false,
    gitTracked: false,
    rebuildable: false,
    backups: [],
  }
  if (!target || !isAbsolute(target)) {
    throw new Error('an absolute path is required')
  }
  if (target.includes('\0')) {
    throw new Error('path contains an invalid null byte')
  }

  let info
  try {
    info = await lstat(target)
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: string }).code ?? '')
      : ''
    if (code === 'ENOENT') {
      result.status = 'missing'
      return result
    }
    if (code === 'EACCES' || code === 'EPERM') {
      result.status = 'permission-denied'
      result.error = 'permission denied'
      return result
    }
    result.status = 'error'
    result.error = error instanceof Error ? error.message : String(error)
    return result
  }

  result.exists = true
  result.isDirectory = info.isDirectory()
  result.fileCount = 1
  result.totalBytes = Number(info.size) || 0
  result.diskBytes = diskBytesOf(info)
  result.status = 'ok'
  if (info.isDirectory() && !info.isSymbolicLink()) {
    await inspectTree(target, result)
    result.emptyDirectory = result.fileCount <= 1
  }

  const git = await inspectGit(target)
  result.inGitRepository = git.inRepository
  result.gitTracked = git.gitTracked
  result.backups = await findSiblingBackups(target)
  result.rebuildable = result.gitTracked || result.backups.length > 0
  return result
}

registerOwnedHandlers({
  async RelaunchDesktopApp(ctx) {
    if (!ctx.hostCall) throw new Error('desktop host is unavailable')
    const started = await ctx.hostCall('app.relaunch', null)
    return Boolean(started)
  },
  ListDshCommands(ctx, args) {
    return ctx.engine.listDshCommands(arg(args, 0, ''))
  },
  ExecuteDshCommand(ctx, args) {
    return ctx.engine.executeDshCommand(arg(args, 0, ''), arg(args, 1, ''))
  },
  SetDshPlanMode(ctx, args) {
    return ctx.engine.setDshPlanMode(arg(args, 0, ''), Boolean(arg(args, 1, false)))
  },
  async ControlDshGoal(ctx, args) {
    await ctx.engine.controlDshGoal(arg(args, 0, ''), arg(args, 1, ''), arg(args, 2, ''))
    return null
  },
  async KillDshJob(ctx, args) {
    await ctx.engine.killDshJob(arg(args, 0, ''), arg(args, 1, ''))
    return null
  },
  InspectDestructiveTarget(_ctx, args) {
    return inspectDestructiveTarget(arg(args, 0, ''))
  },
})
