import { inspectDiff, inspectEnvironment, runGit, type EnvironmentSnapshot } from './git.ts'
import { lookPath, MAX_DIFF_SECTION_BYTES, MAX_GIT_OUTPUT_BYTES, resolveGitPathspec, resolveWorkspace, runHosted } from './paths.ts'

export const GIT_ACTION_STAGE = 'stage'
export const GIT_ACTION_STAGE_ALL = 'stage-all'
export const GIT_ACTION_UNSTAGE = 'unstage'
export const GIT_ACTION_UNSTAGE_ALL = 'unstage-all'
export const GIT_ACTION_DISCARD_WORK = 'discard-worktree'
export const GIT_ACTION_COMMIT = 'commit'
export const GIT_ACTION_PUSH = 'push'
export const GIT_ACTION_CHECKOUT = 'checkout'
export const GIT_ACTION_CREATE_BRANCH = 'create-branch'
export const GIT_ACTION_STAGE_HUNK = 'stage-hunk'
export const GIT_ACTION_UNSTAGE_HUNK = 'unstage-hunk'
export const GIT_ACTION_DISCARD_HUNK = 'discard-hunk'

const MAX_COMMIT_MESSAGE_BYTES = 64 * 1024
const gitURLUserInfoPattern = /([A-Za-z][A-Za-z0-9+.-]*:\/\/)[^/@\s]+@/g

export type GitActionResult = {
  action: string
  message: string
  snapshot: EnvironmentSnapshot
}

function boundedProblem(error: unknown): string {
  const value = String(error instanceof Error ? error.message : error ?? '').trim()
  if (value.length > 240) return `${value.slice(0, 240)}…`
  return value
}

export function sanitizedGitOutput(value: string): string {
  let output = value.replaceAll('\0', '').trim()
  output = output.replace(gitURLUserInfoPattern, '$1***@')
  if (output.length > 1200) return `${output.slice(0, 1200)}…`
  return output
}

async function runGitMutation(
  gitPath: string,
  workspace: string,
  label: string,
  args: string[],
  timeoutMs: number,
  input?: string,
): Promise<void> {
  const commandArgs = ['--no-optional-locks', '-C', workspace, '-c', 'commit.gpgsign=false', ...args]
  const result = await runHosted(gitPath, commandArgs, {
    timeoutMs,
    maxBytes: MAX_GIT_OUTPUT_BYTES,
    input,
  })
  if (result.code === 0) return
  const detail = sanitizedGitOutput(result.output) || boundedProblem('git failed')
  throw new Error(`${label} failed: ${detail}`)
}

function validateCommitMessage(value: string): string {
  const message = value.replaceAll('\r\n', '\n').trim()
  if (!message) throw new Error('commit message is required')
  if (message.includes('\0')) throw new Error('commit message contains an invalid null byte')
  if (Buffer.byteLength(message, 'utf8') !== Buffer.from(message, 'utf8').length) {
    throw new Error('commit message must be valid UTF-8')
  }
  if (Buffer.byteLength(message, 'utf8') > MAX_COMMIT_MESSAGE_BYTES) {
    throw new Error(`commit message must be at most ${MAX_COMMIT_MESSAGE_BYTES} bytes`)
  }
  return message
}

export function validateGitBranchName(value: string): string {
  const name = value.trim()
  if (!name) throw new Error('Git branch is required')
  if (name.startsWith('-') || name.includes('..') || /[ \t\n\r\\~^:?*[]/.test(name)) {
    throw new Error('invalid Git branch')
  }
  if ([...name].length > 255) throw new Error('Git branch name is too long')
  return name
}

async function unstage(
  gitPath: string,
  workspace: string,
  pathspec: string,
  timeoutMs: number,
): Promise<void> {
  const head = await runGit(gitPath, workspace, ['rev-parse', '--verify', 'HEAD'], timeoutMs)
  if (head.ok) {
    await runGitMutation(gitPath, workspace, 'unstage change', ['restore', '--staged', '--', pathspec], timeoutMs)
    return
  }
  const arguments_ = pathspec === '.'
    ? ['rm', '-r', '--cached', '--ignore-unmatch', '--', pathspec]
    : ['rm', '--cached', '--ignore-unmatch', '--', pathspec]
  await runGitMutation(gitPath, workspace, 'unstage initial change', arguments_, timeoutMs)
}

async function discardWorkingTreeChange(
  gitPath: string,
  workspace: string,
  pathspec: string,
  timeoutMs: number,
): Promise<void> {
  const snapshot = await inspectEnvironment(workspace, timeoutMs)
  const selected = snapshot.git.changes?.find((change) => change.path === pathspec)
  if (!selected) throw new Error('selected file no longer has a Git change')
  if (selected.conflict) {
    throw new Error('resolve conflicts explicitly; MilkSU will not discard a conflicted file')
  }
  if (selected.untracked) throw new Error('untracked files are not deleted by this action')
  if (!selected.modified) throw new Error('selected file has no unstaged working-tree change')
  await runGitMutation(
    gitPath,
    workspace,
    'discard working-tree change',
    ['restore', '--worktree', '--', pathspec],
    timeoutMs,
  )
}

async function pushCurrentBranch(gitPath: string, workspace: string, timeoutMs: number): Promise<void> {
  const snapshot = await inspectEnvironment(workspace, Math.min(timeoutMs, 4000))
  if (!snapshot.git.branch || snapshot.git.branch === 'detached') {
    throw new Error('select a local Git branch before pushing')
  }
  if (snapshot.git.upstream) {
    await runGitMutation(gitPath, workspace, 'push branch', ['push', '--porcelain'], timeoutMs)
    return
  }
  const origin = await runGit(gitPath, workspace, ['remote', 'get-url', 'origin'], timeoutMs)
  if (!origin.ok) {
    throw new Error('this branch has no upstream and the repository has no origin remote')
  }
  await runGitMutation(
    gitPath,
    workspace,
    'push branch',
    ['push', '--porcelain', '--set-upstream', 'origin', snapshot.git.branch],
    timeoutMs,
  )
}

function gitActionMessage(action: string, snapshot: EnvironmentSnapshot): string {
  switch (action) {
    case GIT_ACTION_STAGE:
      return '已暂存文件'
    case GIT_ACTION_STAGE_ALL:
      return '已暂存全部变更'
    case GIT_ACTION_UNSTAGE:
      return '已取消暂存文件'
    case GIT_ACTION_UNSTAGE_ALL:
      return '已取消全部暂存'
    case GIT_ACTION_DISCARD_WORK:
      return '已丢弃未暂存修改'
    case GIT_ACTION_COMMIT:
      return snapshot.git.head ? `已提交 ${snapshot.git.head}` : '已创建提交'
    case GIT_ACTION_PUSH:
      return `已推送 ${snapshot.git.branch}`
    case GIT_ACTION_CHECKOUT:
      return snapshot.git.branch ? `已切换到 ${snapshot.git.branch}` : '已切换分支'
    case GIT_ACTION_CREATE_BRANCH:
      return snapshot.git.branch ? `已创建并切换到 ${snapshot.git.branch}` : '已创建分支'
    case GIT_ACTION_STAGE_HUNK:
      return '已暂存所选代码块'
    case GIT_ACTION_UNSTAGE_HUNK:
      return '已取消暂存所选代码块'
    case GIT_ACTION_DISCARD_HUNK:
      return '已撤销所选代码块'
    default:
      return 'Git 操作已完成'
  }
}

export function splitUnifiedDiffHunks(value: string): string[] {
  if (!value || value.includes('…diff truncated by MilkSU')) return []
  const lines = value.split(/(?<=\n)/)
  let firstHunk = -1
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].startsWith('@@ ')) {
      firstHunk = index
      break
    }
  }
  if (firstHunk < 0) return []
  const header = lines.slice(0, firstHunk).join('')
  if (
    !header.startsWith('diff --git ')
    || !header.includes('\n--- ')
    || !header.includes('\n+++ ')
    || header.includes('\n--- /dev/null')
    || header.includes('\n+++ /dev/null')
    || header.includes('\nnew file mode ')
    || header.includes('\ndeleted file mode ')
    || header.includes('\nrename from ')
    || header.includes('\nrename to ')
  ) {
    return []
  }
  const hunks: string[] = []
  let start = firstHunk
  for (let index = firstHunk + 1; index < lines.length; index += 1) {
    if (lines[index].startsWith('@@ ')) {
      hunks.push(header + lines.slice(start, index).join(''))
      start = index
    }
  }
  const last = header + lines.slice(start).join('')
  if (last.trim() !== header.trim()) hunks.push(last)
  return hunks
}

export function exactUnifiedDiffHunk(source: string, requested: string): string | null {
  if (!requested || requested.length > MAX_DIFF_SECTION_BYTES || requested.includes('\0')) return null
  for (const hunk of splitUnifiedDiffHunks(source)) {
    if (hunk === requested) return hunk
  }
  return null
}

function gitHunkActionLabel(action: string): string {
  switch (action) {
    case GIT_ACTION_STAGE_HUNK:
      return 'stage selected hunk'
    case GIT_ACTION_UNSTAGE_HUNK:
      return 'unstage selected hunk'
    case GIT_ACTION_DISCARD_HUNK:
      return 'discard selected hunk'
    default:
      return 'apply selected hunk'
  }
}

async function requireGitRepo(workspace: string, timeoutMs: number): Promise<{ resolved: string; gitPath: string }> {
  const resolved = await resolveWorkspace(workspace)
  const gitPath = await lookPath('git')
  if (!gitPath) throw new Error('Git is not installed or unavailable')
  const inside = await runGit(gitPath, resolved, ['rev-parse', '--is-inside-work-tree'], timeoutMs)
  if (!inside.ok) throw new Error('Coding workspace is not a Git repository')
  return { resolved, gitPath }
}

export async function applyGitAction(
  workspace: string,
  action: string,
  relativePath: string,
  message: string,
  timeoutMs = 15_000,
): Promise<GitActionResult> {
  const { resolved, gitPath } = await requireGitRepo(workspace, Math.min(timeoutMs, 4000))
  const normalizedAction = action.trim()
  switch (normalizedAction) {
    case GIT_ACTION_STAGE: {
      const pathspec = await resolveGitPathspec(resolved, relativePath)
      await runGitMutation(gitPath, resolved, 'stage change', ['add', '--', pathspec], timeoutMs)
      break
    }
    case GIT_ACTION_STAGE_ALL:
      await runGitMutation(gitPath, resolved, 'stage all changes', ['add', '-A', '--', '.'], timeoutMs)
      break
    case GIT_ACTION_UNSTAGE: {
      const pathspec = await resolveGitPathspec(resolved, relativePath)
      await unstage(gitPath, resolved, pathspec, timeoutMs)
      break
    }
    case GIT_ACTION_UNSTAGE_ALL:
      await unstage(gitPath, resolved, '.', timeoutMs)
      break
    case GIT_ACTION_DISCARD_WORK: {
      const pathspec = await resolveGitPathspec(resolved, relativePath)
      await discardWorkingTreeChange(gitPath, resolved, pathspec, timeoutMs)
      break
    }
    case GIT_ACTION_COMMIT: {
      const commitMessage = validateCommitMessage(message)
      const before = await inspectEnvironment(resolved, Math.min(timeoutMs, 4000))
      if (before.git.conflicts > 0) throw new Error('resolve Git conflicts before committing')
      if (before.git.staged === 0) throw new Error('stage at least one change before committing')
      await runGitMutation(gitPath, resolved, 'commit changes', ['commit', '-F', '-'], timeoutMs, commitMessage)
      break
    }
    case GIT_ACTION_PUSH:
      await pushCurrentBranch(gitPath, resolved, timeoutMs)
      break
    case GIT_ACTION_CHECKOUT: {
      const branch = validateGitBranchName(relativePath)
      const exists = await runGit(gitPath, resolved, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], timeoutMs)
      if (!exists.ok) throw new Error(`Git branch not found: ${branch}`)
      try {
        await runGitMutation(gitPath, resolved, 'switch branch', ['switch', '--', branch], timeoutMs)
      } catch {
        await runGitMutation(gitPath, resolved, 'switch branch', ['checkout', branch], timeoutMs)
      }
      break
    }
    case GIT_ACTION_CREATE_BRANCH: {
      const branch = validateGitBranchName(relativePath)
      const exists = await runGit(gitPath, resolved, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], timeoutMs)
      if (exists.ok) throw new Error(`Git branch already exists: ${branch}`)
      try {
        await runGitMutation(gitPath, resolved, 'create branch', ['switch', '-c', branch], timeoutMs)
      } catch {
        await runGitMutation(gitPath, resolved, 'create branch', ['checkout', '-b', branch], timeoutMs)
      }
      break
    }
    default:
      throw new Error(`unsupported Coding Git action: ${action}`)
  }
  const snapshot = await inspectEnvironment(resolved, Math.min(timeoutMs, 4000))
  return {
    action: normalizedAction,
    message: gitActionMessage(normalizedAction, snapshot),
    snapshot,
  }
}

export async function applyGitHunkAction(
  workspace: string,
  action: string,
  relativePath: string,
  patch: string,
  timeoutMs = 15_000,
): Promise<GitActionResult> {
  const { resolved, gitPath } = await requireGitRepo(workspace, Math.min(timeoutMs, 4000))
  const pathspec = await resolveGitPathspec(resolved, relativePath)
  const normalizedAction = action.trim()
  const diff = await inspectDiff(resolved, pathspec, Math.min(timeoutMs, 4000))
  if (diff.truncated) throw new Error('diff is too large for safe hunk operations')
  let source = ''
  let arguments_: string[] = []
  switch (normalizedAction) {
    case GIT_ACTION_STAGE_HUNK:
      source = diff.workingTree ?? ''
      arguments_ = ['apply', '--cached', '--whitespace=nowarn', '--recount', '-']
      break
    case GIT_ACTION_UNSTAGE_HUNK:
      source = diff.staged ?? ''
      arguments_ = ['apply', '--cached', '--reverse', '--whitespace=nowarn', '--recount', '-']
      break
    case GIT_ACTION_DISCARD_HUNK:
      source = diff.workingTree ?? ''
      arguments_ = ['apply', '--reverse', '--whitespace=nowarn', '--recount', '-']
      break
    default:
      throw new Error(`unsupported Coding Git hunk action: ${action}`)
  }
  const canonicalPatch = exactUnifiedDiffHunk(source, patch)
  if (!canonicalPatch) {
    throw new Error('selected hunk is stale or does not belong to the current file diff')
  }
  await runGitMutation(gitPath, resolved, gitHunkActionLabel(normalizedAction), arguments_, timeoutMs, canonicalPatch)
  const snapshot = await inspectEnvironment(resolved, Math.min(timeoutMs, 4000))
  return {
    action: normalizedAction,
    message: gitActionMessage(normalizedAction, snapshot),
    snapshot,
  }
}

