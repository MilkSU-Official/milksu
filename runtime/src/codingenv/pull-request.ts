import { randomBytes } from 'node:crypto'
import { lookPath, MAX_GIT_OUTPUT_BYTES, resolveWorkspace, runHosted } from './paths.ts'
import { sanitizedGitOutput } from './git-actions.ts'

export const CODING_PULL_REQUEST_REPOSITORY = 'MilkSU-Official/milksu'
export const CODING_PULL_REQUEST_REMOTE = 'origin'
export const PULL_REQUEST_PREVIEW_LIFETIME_MS = 5 * 60 * 1000
const MAX_PENDING_PULL_REQUESTS = 16
const MAX_PULL_REQUEST_TITLE_RUNES = 256
const MAX_PULL_REQUEST_BODY_BYTES = 64 << 10
const pullRequestURLPattern = /^https:\/\/github\.com\/MilkSU-Official\/milksu\/pull\/([1-9][0-9]*)$/

export type PullRequestPreview = {
  repository: string
  repositoryUrl: string
  private: boolean
  remote: string
  sourceBranch: string
  headCommit: string
  targetBranch: string
  suggestedTitle: string
  draft: boolean
  existingNumber?: number
  existingUrl?: string
  confirmationToken: string
  expiresAt: string
}

export type PullRequestPublishResult = {
  repository: string
  sourceBranch: string
  headCommit: string
  targetBranch: string
  number: number
  url: string
  state: string
  draft: boolean
  created?: boolean
  verified?: boolean
  problem?: string
}

export type PullRequestState = {
  workspace: string
  repository: string
  repositoryUrl: string
  sourceBranch: string
  headCommit: string
  targetBranch: string
  suggestedTitle: string
  existingNumber?: number
  existingUrl?: string
}

export type PullRequestBackend = {
  inspect(workspace: string): Promise<PullRequestState>
  createDraft(state: PullRequestState, title: string, body: string): Promise<PullRequestPublishResult>
}

type PendingPullRequest = {
  state: PullRequestState
  expiresAt: number
}

function randomPullRequestToken(): string {
  return randomBytes(24).toString('base64url')
}

export function normalizePullRequestTitle(value: string): string {
  const title = value.replaceAll('\r\n', '\n').trim()
  if (!title) throw new Error('pull request title is required')
  if (title.includes('\0') || /[\r\n]/.test(title)) {
    throw new Error('pull request title must be one line without null bytes')
  }
  for (const ch of title) {
    if (ch.charCodeAt(0) < 0x20 || ch === '\u007f') {
      throw new Error('pull request title contains a control character')
    }
  }
  if ([...title].length > MAX_PULL_REQUEST_TITLE_RUNES) {
    throw new Error(`pull request title must be at most ${MAX_PULL_REQUEST_TITLE_RUNES} characters`)
  }
  return title
}

export function normalizePullRequestBody(value: string): string {
  const body = value.replaceAll('\r\n', '\n').trim()
  if (body.includes('\0')) throw new Error('pull request body contains an invalid null byte')
  if (Buffer.byteLength(body, 'utf8') > MAX_PULL_REQUEST_BODY_BYTES) {
    throw new Error(`pull request body must be at most ${MAX_PULL_REQUEST_BODY_BYTES} bytes`)
  }
  return body
}

export function samePullRequestState(first: PullRequestState, second: PullRequestState): boolean {
  return first.workspace === second.workspace
    && first.repository === second.repository
    && first.repositoryUrl === second.repositoryUrl
    && first.sourceBranch === second.sourceBranch
    && first.headCommit === second.headCommit
    && first.targetBranch === second.targetBranch
    && (first.existingNumber ?? 0) === (second.existingNumber ?? 0)
    && (first.existingUrl ?? '') === (second.existingUrl ?? '')
}

export function validGitOID(value: string): boolean {
  if (value.length !== 40 && value.length !== 64) return false
  return /^[0-9a-fA-F]+$/.test(value)
}

export function canonicalMilkSURemote(raw: string): string {
  const value = raw.trim()
  if (!value || /[\r\n\0]/.test(value)) {
    throw new Error('pull requests are allowed only for the authorized MilkSU origin')
  }
  if (value.startsWith('git@github.com:')) {
    const name = value.slice('git@github.com:'.length).replace(/\.git$/, '')
    if (name.toLowerCase() === CODING_PULL_REQUEST_REPOSITORY.toLowerCase()) {
      return CODING_PULL_REQUEST_REPOSITORY
    }
    throw new Error('pull requests are allowed only for the authorized MilkSU origin')
  }
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error('pull requests are allowed only for the authorized MilkSU origin')
  }
  if (parsed.search || parsed.hash) {
    throw new Error('pull requests are allowed only for the authorized MilkSU origin')
  }
  switch (parsed.protocol) {
    case 'https:':
      if (parsed.username || parsed.password) {
        throw new Error('remove embedded credentials from the origin URL before preparing a pull request')
      }
      break
    case 'ssh:':
      if (parsed.username !== 'git' || parsed.password) {
        throw new Error('pull requests are allowed only for the authorized MilkSU origin')
      }
      break
    default:
      throw new Error('pull requests are allowed only for the authorized MilkSU origin')
  }
  const path = parsed.pathname.replace(/^\/+|\/+$/g, '').replace(/\.git$/, '')
  if (
    parsed.hostname.toLowerCase() !== 'github.com'
    || parsed.port
    || path.toLowerCase() !== CODING_PULL_REQUEST_REPOSITORY.toLowerCase()
  ) {
    throw new Error('pull requests are allowed only for the authorized MilkSU origin')
  }
  return CODING_PULL_REQUEST_REPOSITORY
}

async function runProgram(
  workspace: string,
  program: string,
  args: string[],
  input = '',
  timeoutMs = 30_000,
): Promise<string> {
  const path = await lookPath(program)
  if (!path) {
    throw new Error(program === 'gh'
      ? 'GitHub CLI is not installed or unavailable'
      : `${program} is not installed or unavailable`)
  }
  const result = await runHosted(path, args, {
    cwd: workspace,
    input,
    timeoutMs,
    maxBytes: MAX_GIT_OUTPUT_BYTES,
  })
  if (result.code !== 0) {
    const detail = sanitizedGitOutput(result.output) || 'command failed'
    throw new Error(`${program} failed: ${detail}`)
  }
  return result.output
}

type GithubPullRequestView = {
  number: number
  url: string
  state: string
  isDraft: boolean
  headRefName: string
  headRefOid: string
  baseRefName: string
}

function uncertainPullRequestResult(
  state: PullRequestState,
  number: number,
  url: string,
  problem: string,
): PullRequestPublishResult {
  return {
    repository: state.repository,
    sourceBranch: state.sourceBranch,
    headCommit: state.headCommit,
    targetBranch: state.targetBranch,
    number,
    url,
    state: 'UNKNOWN',
    draft: true,
    created: true,
    problem,
  }
}

export class GithubPullRequestBackend implements PullRequestBackend {
  async inspect(workspace: string): Promise<PullRequestState> {
    const resolved = await resolveWorkspace(workspace)
    const run = (program: string, args: string[]) => runProgram(resolved, program, args, '', 30_000)
    try {
      await run('git', ['rev-parse', '--is-inside-work-tree'])
    } catch {
      throw new Error('Coding workspace is not a Git repository')
    }
    const status = await run('git', ['status', '--porcelain=v1', '--untracked-files=normal'])
    if (status.trim()) {
      throw new Error('commit or discard all Git changes before preparing a pull request')
    }
    let sourceBranch = ''
    try {
      sourceBranch = (await run('git', ['symbolic-ref', '--quiet', '--short', 'HEAD'])).trim()
    } catch {
      sourceBranch = ''
    }
    if (!sourceBranch) throw new Error('select a local Git branch before preparing a pull request')
    let upstream = ''
    try {
      upstream = (await run('git', ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'])).trim()
    } catch {
      upstream = ''
    }
    if (upstream !== `${CODING_PULL_REQUEST_REMOTE}/${sourceBranch}`) {
      throw new Error('push the current branch to the authorized origin before preparing a pull request')
    }
    let remoteURL = ''
    try {
      remoteURL = (await run('git', ['remote', 'get-url', CODING_PULL_REQUEST_REMOTE])).trim()
    } catch {
      throw new Error('the repository has no origin remote')
    }
    canonicalMilkSURemote(remoteURL)
    const headCommit = (await run('git', ['rev-parse', 'HEAD'])).trim().toLowerCase()
    if (!validGitOID(headCommit)) throw new Error('cannot resolve the current Git commit')
    const suggestedTitle = normalizePullRequestTitle(await run('git', ['log', '-1', '--format=%s']))
    const repositoryOutput = await run('gh', [
      'repo', 'view', CODING_PULL_REQUEST_REPOSITORY, '--json', 'nameWithOwner,isPrivate,defaultBranchRef,url',
    ])
    let repositoryView: {
      nameWithOwner?: string
      isPrivate?: boolean
      url?: string
      defaultBranchRef?: { name?: string }
    }
    try {
      repositoryView = JSON.parse(repositoryOutput) as typeof repositoryView
    } catch {
      throw new Error('GitHub CLI returned an invalid repository verification response')
    }
    if (
      (repositoryView.nameWithOwner ?? '').toLowerCase() !== CODING_PULL_REQUEST_REPOSITORY.toLowerCase()
      || !repositoryView.isPrivate
      || repositoryView.url !== `https://github.com/${CODING_PULL_REQUEST_REPOSITORY}`
    ) {
      throw new Error('pull requests are allowed only for the verified private MilkSU repository')
    }
    const targetBranch = String(repositoryView.defaultBranchRef?.name ?? '').trim()
    if (!targetBranch || targetBranch === sourceBranch) {
      throw new Error('the current branch cannot target the repository default branch')
    }
    let branchView: { commit?: { sha?: string } }
    try {
      const branchOutput = await run('gh', [
        'api',
        `repos/${CODING_PULL_REQUEST_REPOSITORY}/branches/${encodeURIComponent(sourceBranch)}`,
      ])
      branchView = JSON.parse(branchOutput) as typeof branchView
    } catch {
      throw new Error('the current branch is not available on the authorized GitHub repository; push it first')
    }
    if (!validGitOID(branchView.commit?.sha ?? '') || (branchView.commit?.sha ?? '').toLowerCase() !== headCommit) {
      throw new Error('the authorized remote branch does not contain the current commit; push it first')
    }
    const state: PullRequestState = {
      workspace: resolved,
      repository: CODING_PULL_REQUEST_REPOSITORY,
      repositoryUrl: repositoryView.url ?? '',
      sourceBranch,
      headCommit,
      targetBranch,
      suggestedTitle,
    }
    const existing = await this.findOpenPullRequest(state)
    if (existing) {
      state.existingNumber = existing.number
      state.existingUrl = existing.url
    }
    return state
  }

  async createDraft(state: PullRequestState, title: string, body: string): Promise<PullRequestPublishResult> {
    if ((state.existingNumber ?? 0) > 0 && state.existingUrl) {
      return {
        repository: state.repository,
        sourceBranch: state.sourceBranch,
        headCommit: state.headCommit,
        targetBranch: state.targetBranch,
        number: state.existingNumber ?? 0,
        url: state.existingUrl,
        state: 'OPEN',
        draft: true,
        verified: true,
      }
    }
    let output = ''
    try {
      output = await runProgram(state.workspace, 'gh', [
        'pr', 'create',
        '--repo', state.repository,
        '--base', state.targetBranch,
        '--head', state.sourceBranch,
        '--title', title,
        '--body-file', '-',
        '--draft',
      ], body, 120_000)
    } catch (error) {
      const existing = await this.findOpenPullRequest(state)
      if (existing) return { ...existing, created: false }
      throw new Error(`create draft pull request: ${error instanceof Error ? error.message : error}`)
    }
    const pullRequestURL = output.trim()
    const match = pullRequestURLPattern.exec(pullRequestURL)
    if (!match) {
      const recovered = await this.findOpenPullRequest(state)
      if (recovered) return { ...recovered, created: true }
      throw new Error('GitHub CLI may have created a pull request but returned an unexpected URL; inspect the MilkSU repository before retrying')
    }
    const number = Number(match[1])
    if (!Number.isInteger(number)) throw new Error('GitHub CLI returned an invalid pull request number')
    try {
      const verificationOutput = await runProgram(state.workspace, 'gh', [
        'pr', 'view', pullRequestURL,
        '--repo', state.repository,
        '--json', 'number,url,state,isDraft,headRefName,headRefOid,baseRefName',
      ], '', 30_000)
      const view = JSON.parse(verificationOutput) as GithubPullRequestView
      if (
        view.number !== number
        || view.url !== pullRequestURL
        || view.state !== 'OPEN'
        || !view.isDraft
        || view.headRefName !== state.sourceBranch
        || view.baseRefName !== state.targetBranch
        || view.headRefOid.toLowerCase() !== state.headCommit
      ) {
        return uncertainPullRequestResult(
          state,
          number,
          pullRequestURL,
          'draft pull request was created but its readback did not match the confirmed branches, commit, and draft state',
        )
      }
      return {
        repository: state.repository,
        sourceBranch: state.sourceBranch,
        headCommit: state.headCommit,
        targetBranch: state.targetBranch,
        number: view.number,
        url: view.url,
        state: view.state,
        draft: view.isDraft,
        created: true,
        verified: true,
      }
    } catch (error) {
      return uncertainPullRequestResult(
        state,
        number,
        pullRequestURL,
        `draft pull request was created but readback failed: ${error instanceof Error ? error.message : error}`,
      )
    }
  }

  private async findOpenPullRequest(state: PullRequestState): Promise<PullRequestPublishResult | null> {
    try {
      const output = await runProgram(state.workspace, 'gh', [
        'pr', 'list',
        '--repo', state.repository,
        '--head', state.sourceBranch,
        '--base', state.targetBranch,
        '--state', 'open',
        '--limit', '5',
        '--json', 'number,url,state,isDraft,headRefName,headRefOid,baseRefName',
      ], '', 30_000)
      const views = JSON.parse(output) as GithubPullRequestView[]
      for (const view of views) {
        if (
          view.number <= 0
          || !pullRequestURLPattern.test(view.url)
          || view.state !== 'OPEN'
          || !view.isDraft
          || view.headRefName !== state.sourceBranch
          || view.baseRefName !== state.targetBranch
          || view.headRefOid.toLowerCase() !== state.headCommit
        ) continue
        return {
          repository: state.repository,
          sourceBranch: state.sourceBranch,
          headCommit: state.headCommit,
          targetBranch: state.targetBranch,
          number: view.number,
          url: view.url,
          state: view.state,
          draft: view.isDraft,
          verified: true,
        }
      }
    } catch {
      return null
    }
    return null
  }
}

export class PullRequestPublisher {
  private readonly backend: PullRequestBackend
  private readonly now: () => Date
  private readonly randomToken: () => string
  private readonly pending = new Map<string, PendingPullRequest>()

  constructor(
    backend: PullRequestBackend = new GithubPullRequestBackend(),
    now: () => Date = () => new Date(),
    randomToken: () => string = randomPullRequestToken,
  ) {
    this.backend = backend
    this.now = now
    this.randomToken = randomToken
  }

  async prepare(workspace: string): Promise<PullRequestPreview> {
    const state = await this.backend.inspect(workspace)
    const token = this.randomToken()
    const now = this.now()
    const expiresAt = now.getTime() + PULL_REQUEST_PREVIEW_LIFETIME_MS
    this.prune(now.getTime())
    if (this.pending.size >= MAX_PENDING_PULL_REQUESTS) {
      let oldestToken = ''
      let oldestExpiry = Number.POSITIVE_INFINITY
      for (const [candidate, pending] of this.pending) {
        if (pending.expiresAt < oldestExpiry) {
          oldestToken = candidate
          oldestExpiry = pending.expiresAt
        }
      }
      if (oldestToken) this.pending.delete(oldestToken)
    }
    this.pending.set(token, { state, expiresAt })
    return {
      repository: state.repository,
      repositoryUrl: state.repositoryUrl,
      private: true,
      remote: CODING_PULL_REQUEST_REMOTE,
      sourceBranch: state.sourceBranch,
      headCommit: state.headCommit,
      targetBranch: state.targetBranch,
      suggestedTitle: state.suggestedTitle,
      draft: true,
      existingNumber: state.existingNumber,
      existingUrl: state.existingUrl,
      confirmationToken: token,
      expiresAt: new Date(expiresAt).toISOString(),
    }
  }

  async publish(
    workspace: string,
    confirmationToken: string,
    title: string,
    body: string,
  ): Promise<PullRequestPublishResult> {
    const now = this.now().getTime()
    this.prune(now)
    const pending = this.pending.get(confirmationToken.trim())
    if (pending) this.pending.delete(confirmationToken.trim())
    if (!pending) {
      throw new Error('pull request confirmation is missing, expired, or already used; prepare it again')
    }
    const normalizedTitle = normalizePullRequestTitle(title)
    const normalizedBody = normalizePullRequestBody(body)
    const current = await this.backend.inspect(workspace)
    if (!samePullRequestState(pending.state, current)) {
      throw new Error('pull request preview is stale because the repository, branch, commit, or target changed; prepare it again')
    }
    return this.backend.createDraft(current, normalizedTitle, normalizedBody)
  }

  private prune(now: number): void {
    for (const [token, pending] of this.pending) {
      if (pending.expiresAt <= now) this.pending.delete(token)
    }
  }
}
