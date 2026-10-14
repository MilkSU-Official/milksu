import { basename } from 'node:path'
import { discoverArtifacts } from './artifacts.ts'
import { discoverImages } from './images.ts'
import {
  isMilkSUInternalPath,
  lookPath,
  MAX_DIFF_SECTION_BYTES,
  MAX_GIT_OUTPUT_BYTES,
  resolveGitPathspec,
  resolveWorkspace,
  runHosted,
  toSlash,
} from './paths.ts'

export const MAX_GIT_CHANGES = 80
export const MAX_LOCAL_BRANCHES = 80

const aheadBehindPattern = /\b(ahead|behind) ([0-9]+)\b/g

export type GitChange = {
  path: string
  originalPath?: string
  indexStatus: string
  worktreeStatus: string
  staged: boolean
  modified: boolean
  untracked: boolean
  conflict: boolean
  additions: number
  deletions: number
}

export type GitStatus = {
  available: boolean
  isRepository: boolean
  branch?: string
  upstream?: string
  head?: string
  ahead: number
  behind: number
  changedFiles: number
  staged: number
  modified: number
  untracked: number
  conflicts: number
  additions: number
  deletions: number
  dirty: boolean
  problem?: string
  changes?: GitChange[]
  changesTruncated?: boolean
  localBranches?: string[]
}

export type DiffSnapshot = {
  workspace: string
  path: string
  staged?: string
  workingTree?: string
  truncated?: boolean
}

export type EnvironmentSnapshot = {
  workspace: string
  workspaceName: string
  capturedAt: string
  git: GitStatus
  artifacts: string[]
  images?: string[]
}

export async function runGit(
  gitPath: string,
  workspace: string,
  args: string[],
  timeoutMs = 4000,
  input?: string,
): Promise<{ output: string; ok: boolean }> {
  const result = await runHosted(
    gitPath,
    ['--no-optional-locks', '-C', workspace, ...args],
    { timeoutMs, maxBytes: MAX_GIT_OUTPUT_BYTES, input },
  )
  return { output: result.output, ok: result.code === 0 }
}

export function isNotRepository(output: string): boolean {
  const lower = output.toLowerCase()
  return lower.includes('not a git repository') || lower.includes('not a git work tree')
}

export function boundedProblem(error: unknown): string {
  const value = String(error instanceof Error ? error.message : error ?? '').trim()
  if (value.length > 240) return `${value.slice(0, 240)}…`
  return value
}

export function parseLocalBranches(output: string): string[] {
  const lines = output.replaceAll('\r\n', '\n').split('\n')
  const branches: string[] = []
  const seen = new Set<string>()
  for (const line of lines) {
    const name = line.trim()
    if (!name || seen.has(name)) continue
    seen.add(name)
    branches.push(name)
    if (branches.length >= MAX_LOCAL_BRANCHES) break
  }
  return branches
}

function parseBranchLine(status: GitStatus, line: string): void {
  const value = line.trim()
  if (value.startsWith('No commits yet on ')) {
    status.branch = value.slice('No commits yet on '.length).trim()
    return
  }
  if (value.startsWith('Initial commit on ')) {
    status.branch = value.slice('Initial commit on '.length).trim()
    return
  }
  if (value.startsWith('HEAD (no branch)')) {
    status.branch = 'detached'
    return
  }
  let branchPart = value
  const bracket = branchPart.indexOf(' [')
  if (bracket >= 0) branchPart = branchPart.slice(0, bracket)
  const separator = branchPart.indexOf('...')
  if (separator >= 0) {
    status.branch = branchPart.slice(0, separator).trim()
    status.upstream = branchPart.slice(separator + 3).trim()
  } else {
    status.branch = branchPart.trim()
  }
  for (const match of value.matchAll(aheadBehindPattern)) {
    const count = Number(match[2])
    if (!Number.isInteger(count)) continue
    if (match[1] === 'ahead') status.ahead = count
    else status.behind = count
  }
}

export function isConflictCode(code: string): boolean {
  return ['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'].includes(code)
}

export function parsePorcelainStatus(output: string): GitStatus {
  const status: GitStatus = {
    available: true,
    isRepository: true,
    ahead: 0,
    behind: 0,
    changedFiles: 0,
    staged: 0,
    modified: 0,
    untracked: 0,
    conflicts: 0,
    additions: 0,
    deletions: 0,
    dirty: false,
  }
  for (const line of output.replaceAll('\r\n', '\n').split('\n')) {
    if (!line) continue
    if (line.startsWith('## ')) {
      parseBranchLine(status, line.slice(3))
      continue
    }
    if (line.length < 4) continue
    if (isMilkSUInternalPath(line.slice(3).trim())) continue
    const code = line.slice(0, 2)
    status.changedFiles += 1
    if (code === '??') {
      status.untracked += 1
      continue
    }
    if (code === '!!') {
      status.changedFiles -= 1
      continue
    }
    if (isConflictCode(code)) status.conflicts += 1
    if (code[0] !== ' ' && code[0] !== '?') status.staged += 1
    if (code[1] !== ' ' && code[1] !== '?') status.modified += 1
  }
  status.dirty = status.changedFiles > 0
  return status
}

export function parsePorcelainChanges(output: string): {
  changes: GitChange[]
  truncated: boolean
  ignored: string[]
} {
  const entries = output.split('\0')
  const changes: GitChange[] = []
  const ignored: string[] = []
  let truncated = false
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]
    if (entry.length < 4) continue
    const code = entry.slice(0, 2)
    if (code === '!!') {
      const path = entry.slice(3).replace(/\/$/, '')
      if (path && !isMilkSUInternalPath(path)) ignored.push(path)
      continue
    }
    const change: GitChange = {
      path: entry.slice(3),
      indexStatus: code[0],
      worktreeStatus: code[1],
      staged: code[0] !== ' ' && code[0] !== '?',
      modified: code[1] !== ' ' && code[1] !== '?',
      untracked: code === '??',
      conflict: isConflictCode(code),
      additions: 0,
      deletions: 0,
    }
    if ((code[0] === 'R' || code[0] === 'C') && index + 1 < entries.length) {
      change.originalPath = entries[index + 1]
      index += 1
    }
    if (isMilkSUInternalPath(change.path)) continue
    if (changes.length >= MAX_GIT_CHANGES) {
      truncated = true
      continue
    }
    changes.push(change)
  }
  return { changes, truncated, ignored }
}

export type GitLineStat = { additions: number; deletions: number }

export function parseNumstatByPath(output: string): Map<string, GitLineStat> {
  const stats = new Map<string, GitLineStat>()
  for (const line of output.replaceAll('\r\n', '\n').split('\n')) {
    const fields = line.split('\t')
    if (fields.length < 3) continue
    const path = fields[2].trim()
    if (isMilkSUInternalPath(path)) continue
    const additions = Number.parseInt(fields[0], 10)
    const deletions = Number.parseInt(fields[1], 10)
    stats.set(path, {
      additions: Number.isInteger(additions) ? additions : 0,
      deletions: Number.isInteger(deletions) ? deletions : 0,
    })
  }
  return stats
}

export function parseNumstat(output: string): { additions: number; deletions: number } {
  let additions = 0
  let deletions = 0
  for (const stat of parseNumstatByPath(output).values()) {
    additions += stat.additions
    deletions += stat.deletions
  }
  return { additions, deletions }
}

export function boundedDiff(value: string): { text: string; truncated: boolean } {
  if (value.length <= MAX_DIFF_SECTION_BYTES) return { text: value, truncated: false }
  return {
    text: `${value.slice(0, MAX_DIFF_SECTION_BYTES)}\n…diff truncated by MilkSU\n`,
    truncated: true,
  }
}

function emptyGit(): GitStatus {
  return {
    available: false,
    isRepository: false,
    ahead: 0,
    behind: 0,
    changedFiles: 0,
    staged: 0,
    modified: 0,
    untracked: 0,
    conflicts: 0,
    additions: 0,
    deletions: 0,
    dirty: false,
  }
}

export async function inspectEnvironment(workspace: string, timeoutMs = 4000): Promise<EnvironmentSnapshot> {
  const resolved = await resolveWorkspace(workspace)
  const snapshot: EnvironmentSnapshot = {
    workspace: resolved,
    workspaceName: basename(resolved),
    capturedAt: new Date().toISOString(),
    git: emptyGit(),
    artifacts: [],
  }
  const gitPath = await lookPath('git')
  if (!gitPath) {
    snapshot.git.problem = 'Git is not installed or unavailable.'
    snapshot.artifacts = await discoverArtifacts(resolved, [], ['.'])
    snapshot.images = await discoverImages(resolved, [], ['.'])
    return snapshot
  }
  snapshot.git.available = true
  const status = await runGit(gitPath, resolved, [
    'status',
    '--porcelain=v1',
    '--branch',
    '--untracked-files=normal',
  ], timeoutMs)
  if (!status.ok) {
    if (isNotRepository(status.output)) {
      snapshot.artifacts = await discoverArtifacts(resolved, [], ['.'])
      snapshot.images = await discoverImages(resolved, [], ['.'])
      return snapshot
    }
    snapshot.git.problem = boundedProblem(status.output || 'git status failed')
    return snapshot
  }
  snapshot.git = parsePorcelainStatus(status.output)
  snapshot.git.available = true
  snapshot.git.isRepository = true
  let ignoredRoots: string[] = []
  const fileStatus = await runGit(gitPath, resolved, [
    'status',
    '--porcelain=v1',
    '-z',
    '--untracked-files=normal',
    '--ignored=matching',
  ], timeoutMs)
  if (fileStatus.ok) {
    const parsed = parsePorcelainChanges(fileStatus.output)
    snapshot.git.changes = parsed.changes
    snapshot.git.changesTruncated = parsed.truncated || undefined
    ignoredRoots = parsed.ignored
  }
  snapshot.artifacts = await discoverArtifacts(resolved, snapshot.git.changes ?? [], ignoredRoots)
  snapshot.images = await discoverImages(resolved, snapshot.git.changes ?? [], ignoredRoots)

  const head = await runGit(gitPath, resolved, ['rev-parse', '--short=12', 'HEAD'], timeoutMs)
  if (head.ok) snapshot.git.head = head.output.trim()
  const refs = await runGit(gitPath, resolved, [
    'for-each-ref',
    '--format=%(refname:short)',
    '--sort=-committerdate',
    'refs/heads/',
  ], timeoutMs)
  if (refs.ok) snapshot.git.localBranches = parseLocalBranches(refs.output)
  const numstat = await runGit(gitPath, resolved, ['diff', '--numstat', 'HEAD', '--'], timeoutMs)
  if (numstat.ok) {
    const byPath = parseNumstatByPath(numstat.output)
    for (const stat of byPath.values()) {
      snapshot.git.additions += stat.additions
      snapshot.git.deletions += stat.deletions
    }
    for (const change of snapshot.git.changes ?? []) {
      const stat = byPath.get(change.path) ?? (change.originalPath ? byPath.get(change.originalPath) : undefined)
      if (stat) {
        change.additions = stat.additions
        change.deletions = stat.deletions
      }
    }
  }
  return snapshot
}

export async function inspectDiff(
  workspace: string,
  relativePath: string,
  timeoutMs = 4000,
): Promise<DiffSnapshot> {
  const resolved = await resolveWorkspace(workspace)
  const pathspec = await resolveGitPathspec(resolved, relativePath)
  const gitPath = await lookPath('git')
  if (!gitPath) throw new Error('Git is not installed or unavailable')
  const inside = await runGit(gitPath, resolved, ['rev-parse', '--is-inside-work-tree'], timeoutMs)
  if (!inside.ok) throw new Error('Coding workspace is not a Git repository')
  const stagedRun = await runGit(gitPath, resolved, [
    'diff',
    '--cached',
    '--no-ext-diff',
    '--no-color',
    '--unified=3',
    '--',
    pathspec,
  ], timeoutMs)
  if (!stagedRun.ok) throw new Error(`read staged diff: ${boundedProblem(stagedRun.output || 'git diff failed')}`)
  const workingRun = await runGit(gitPath, resolved, [
    'diff',
    '--no-ext-diff',
    '--no-color',
    '--unified=3',
    '--',
    pathspec,
  ], timeoutMs)
  if (!workingRun.ok) throw new Error(`read working tree diff: ${boundedProblem(workingRun.output || 'git diff failed')}`)
  const staged = boundedDiff(stagedRun.output)
  const workingTree = boundedDiff(workingRun.output)
  return {
    workspace: resolved,
    path: toSlash(pathspec),
    staged: staged.text,
    workingTree: workingTree.text,
    truncated: staged.truncated || workingTree.truncated || undefined,
  }
}
