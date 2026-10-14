import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import {
  chmod,
  cp,
  lstat,
  mkdir,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { existsSync, mkdirSync, realpathSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { dataDirectory } from '../home.ts'

export const SCHEMA_VERSION = 2
export const MIN_WRITERS = 1
export const MAX_WRITERS = 2

export type CodingCollaborationWorktree = {
  id: string
  path: string
  branch: string
}

export type CodingCollaborationDescriptor = {
  schemaVersion: number
  conversationId: string
  workspace: string
  baseHead: string
  worktrees: CodingCollaborationWorktree[]
}

type ManifestWorktree = CodingCollaborationWorktree & {
  baseHead?: string
  provisioned?: boolean
  prepared?: boolean
}

type Manifest = {
  schemaVersion: number
  conversationId: string
  workspace: string
  projectPath?: string
  baseBranch?: string
  baseHead: string
  phase: string
  createdAt: string
  updatedAt: string
  worktrees: ManifestWorktree[]
}

const PHASE_ACTIVE = 'active'
const PHASE_PREPARING = 'preparing'

const execFileAsync = promisify(execFile)

export function codingCollaborationRoot(home: string): string {
  const root = join(dataDirectory(home), 'agent', 'home', 'coding-collaboration')
  return root
}

export function collaborationTaskKey(conversationId: string): string {
  return createHash('sha256').update(String(conversationId ?? '').trim()).digest('hex').slice(0, 32)
}

export function collaborationWriterId(index: number): string {
  return `writer-${index}`
}

export function collaborationWriterBranch(conversationId: string, index: number): string {
  return `codex/agent-${collaborationTaskKey(conversationId).slice(0, 12)}-writer-${index}`
}

export function boundedWriterCount(writers: number): number {
  if (!Number.isInteger(writers) || writers < MIN_WRITERS) return MIN_WRITERS
  if (writers > MAX_WRITERS) return MAX_WRITERS
  return writers
}

function trim(value: unknown): string {
  return String(value ?? '').trim()
}

function resolveExistingDir(value: string): string {
  const absolute = isAbsolute(value) ? value : resolve(value)
  return realpathSync(absolute)
}

function validGitObjectID(value: string): boolean {
  if (value.length !== 40 && value.length !== 64) return false
  return /^[0-9a-f]+$/u.test(value)
}

function taskDirectory(root: string, conversationId: string): string {
  return join(root, collaborationTaskKey(conversationId))
}

function manifestPath(root: string, conversationId: string): string {
  return join(taskDirectory(root, conversationId), 'manifest.json')
}

export function normalizeCodingCollaborationDescriptor(
  descriptor: CodingCollaborationDescriptor | null | undefined,
  sessionId: string,
  workspace: string,
  root: string,
): CodingCollaborationDescriptor | null {
  if (!descriptor) return null
  if (descriptor.schemaVersion !== SCHEMA_VERSION) {
    throw new Error('invalid Coding collaboration schema version')
  }
  if (trim(descriptor.conversationId) !== trim(sessionId)) {
    throw new Error('Coding collaboration must belong to the current task')
  }
  let resolvedWorkspace: string
  try {
    resolvedWorkspace = resolveExistingDir(descriptor.workspace)
  } catch {
    throw new Error('Coding collaboration must belong to the current workspace')
  }
  if (resolvedWorkspace !== workspace) {
    throw new Error('Coding collaboration must belong to the current workspace')
  }
  if (!validGitObjectID(descriptor.baseHead)) {
    throw new Error('invalid Coding collaboration base commit')
  }
  const resolvedRoot = resolveExistingDir(root)
  const worktrees = descriptor.worktrees ?? []
  if (worktrees.length < MIN_WRITERS || worktrees.length > MAX_WRITERS) {
    throw new Error('Coding collaboration requires one or two writer worktrees')
  }
  const normalized: CodingCollaborationDescriptor = {
    schemaVersion: SCHEMA_VERSION,
    conversationId: trim(sessionId),
    workspace,
    baseHead: descriptor.baseHead,
    worktrees: [],
  }
  for (let index = 0; index < worktrees.length; index += 1) {
    const expectedId = collaborationWriterId(index + 1)
    const expectedBranch = collaborationWriterBranch(sessionId, index + 1)
    const expectedPath = join(resolvedRoot, collaborationTaskKey(sessionId), expectedId)
    let resolvedPath = ''
    try {
      resolvedPath = resolveExistingDir(worktrees[index].path)
    } catch {
      resolvedPath = ''
    }
    if (
      worktrees[index].id !== expectedId
      || trim(worktrees[index].branch) !== expectedBranch
      || resolvedPath !== expectedPath
    ) {
      throw new Error(`invalid Coding collaboration boundary for ${expectedId}`)
    }
    normalized.worktrees.push({
      id: expectedId,
      path: expectedPath,
      branch: expectedBranch,
    })
  }
  return normalized
}

async function git(cwd: string, args: string[], timeoutMs = 30_000): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    timeout: timeoutMs,
    env: process.env,
  })
  return String(stdout ?? '').trim()
}

async function gitAvailable(): Promise<boolean> {
  try {
    await execFileAsync('git', ['--version'], { timeout: 4_000, env: process.env })
    return true
  } catch {
    return false
  }
}

async function inspectRepository(workspace: string): Promise<{
  workspace: string
  root: string
  projectPath: string
  branch: string
  head: string
}> {
  const resolved = resolveExistingDir(workspace)
  let root = ''
  try {
    root = await git(resolved, ['rev-parse', '--show-toplevel'])
  } catch {
    throw new Error('this project is not a Git repository')
  }
  root = resolveExistingDir(root)
  let projectPath = ''
  if (root !== resolved) {
    const rel = relative(root, resolved)
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
      throw new Error('Coding workspace is outside its Git repository')
    }
    projectPath = rel.split(sep).join('/')
  }
  const head = await git(resolved, ['rev-parse', 'HEAD'])
  if (!validGitObjectID(head)) {
    throw new Error('Coding collaboration requires a committed base')
  }
  let branch = ''
  try {
    branch = await git(resolved, ['branch', '--show-current'])
  } catch {
    branch = ''
  }
  return { workspace: resolved, root, projectPath, branch, head }
}

async function loadManifest(root: string, conversationId: string): Promise<Manifest | null> {
  try {
    const raw = await readFile(manifestPath(root, conversationId), 'utf8')
    return JSON.parse(raw) as Manifest
  } catch {
    return null
  }
}

async function saveManifest(root: string, value: Manifest): Promise<void> {
  const directory = taskDirectory(root, value.conversationId)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const target = manifestPath(root, value.conversationId)
  const temporary = join(directory, `.manifest-${process.pid}.json`)
  const body = `${JSON.stringify({ ...value, schemaVersion: SCHEMA_VERSION }, null, 2)}\n`
  await writeFile(temporary, body, { mode: 0o600 })
  await rename(temporary, target)
}

function descriptorFromManifest(current: Manifest): CodingCollaborationDescriptor {
  return {
    schemaVersion: SCHEMA_VERSION,
    conversationId: current.conversationId,
    workspace: current.workspace,
    baseHead: current.baseHead,
    worktrees: (current.worktrees ?? []).map((worktree) => ({
      id: worktree.id,
      path: worktree.path,
      branch: worktree.branch,
    })),
  }
}

export async function lookupCodingCollaboration(
  home: string,
  conversationId: string,
  workspacePath: string,
): Promise<CodingCollaborationDescriptor | null> {
  const id = trim(conversationId)
  const workspace = trim(workspacePath)
  if (!id || !workspace) return null
  const root = codingCollaborationRoot(home)
  const current = await loadManifest(root, id)
  if (!current || current.phase !== PHASE_ACTIVE) return null
  if (current.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(`unsupported Coding collaboration schema version ${current.schemaVersion}`)
  }
  const resolvedWorkspace = resolveExistingDir(workspace)
  if (resolvedWorkspace !== current.workspace) {
    throw new Error('the active Coding collaboration belongs to a different repository')
  }
  return descriptorFromManifest(current)
}

async function copyIncludedPath(source: string, destination: string): Promise<void> {
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 })
  await cp(source, destination, { recursive: true, errorOnExist: true, preserveTimestamps: true })
}

function rewriteIncludePattern(pattern: string): string {
  let value = pattern.trim()
  if (!value || value.startsWith('#')) return value
  let negated = false
  if (value.startsWith('!')) {
    negated = true
    value = value.slice(1).trim()
  }
  value = value.split(sep).join('/')
  if (!value.startsWith('/')) {
    const trimmed = value.endsWith('/') ? value.slice(0, -1) : value
    if (!trimmed.includes('/')) value = `/${value}`
  }
  return negated ? `!${value}` : value
}

async function discoverWorktreeIncludes(repository: string): Promise<string[]> {
  const includeFile = join(repository, '.worktreeinclude')
  let info
  try {
    info = await lstat(includeFile)
  } catch {
    return []
  }
  if (!info.isFile() || info.size > 64 * 1024) return []
  try {
    await git(repository, ['ls-files', '--error-unmatch', '--', '.worktreeinclude'])
  } catch {
    return []
  }
  const content = await readFile(includeFile, 'utf8')
  const rewritten = content.replaceAll('\r\n', '\n').split('\n').map(rewriteIncludePattern).join('\n')
  const excludePath = join(tmpdir(), `milksu-worktreeinclude-${process.pid}-${Date.now()}.txt`)
  await writeFile(excludePath, rewritten)
  let output = ''
  try {
    output = await git(repository, [
      'ls-files',
      '--others',
      '--ignored',
      '--directory',
      `--exclude-from=${excludePath}`,
    ])
  } catch {
    return []
  } finally {
    try { await unlink(excludePath) } catch { /* ignore */ }
  }
  const selected: string[] = []
  for (const line of output.split('\n')) {
    const path = line.trim().replace(/\/$/u, '')
    if (!path || path === '.' || path.includes('..') || isAbsolute(path)) continue
    selected.push(path)
  }
  return selected
}

async function materializeIncludes(
  repository: string,
  worktree: string,
  paths: string[],
): Promise<void> {
  for (const path of paths) {
    const source = join(repository, path)
    const destination = join(worktree, path)
    try {
      await stat(source)
    } catch {
      continue
    }
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 })
    await copyIncludedPath(source, destination)
  }
}

export async function prepareCodingCollaboration(
  home: string,
  conversationId: string,
  workspacePath: string,
  writers = 1,
): Promise<CodingCollaborationDescriptor> {
  const id = trim(conversationId)
  if (!id) throw new Error('a valid Coding conversation id is required')
  const workspace = trim(workspacePath)
  if (!workspace) throw new Error('this task has no Git project to isolate')
  if (!(await gitAvailable())) throw new Error('Git is not installed or unavailable')

  const existing = await lookupCodingCollaboration(home, id, workspace)
  if (existing) return existing

  const base = await inspectRepository(workspace)
  const count = boundedWriterCount(writers)
  const root = codingCollaborationRoot(home)
  await mkdir(root, { recursive: true, mode: 0o700 })
  try {
    await chmod(root, 0o700)
  } catch {
    // Windows may ignore chmod
  }
  const resolvedRoot = existsSync(root) ? resolveExistingDir(root) : root
  const directory = taskDirectory(resolvedRoot, id)
  await mkdir(directory, { recursive: true, mode: 0o700 })

  const now = new Date().toISOString()
  const worktrees: ManifestWorktree[] = []
  for (let index = 1; index <= count; index += 1) {
    worktrees.push({
      id: collaborationWriterId(index),
      path: join(directory, collaborationWriterId(index)),
      branch: collaborationWriterBranch(id, index),
      baseHead: base.head,
    })
  }
  const next: Manifest = {
    schemaVersion: SCHEMA_VERSION,
    conversationId: id,
    workspace: base.workspace,
    projectPath: base.projectPath || undefined,
    baseBranch: base.branch || undefined,
    baseHead: base.head,
    phase: PHASE_PREPARING,
    createdAt: now,
    updatedAt: now,
    worktrees,
  }
  await saveManifest(resolvedRoot, next)

  const includes = await discoverWorktreeIncludes(base.root)
  for (let index = 0; index < worktrees.length; index += 1) {
    const worktree = worktrees[index]
    await git(base.root, [
      'worktree',
      'add',
      '-b',
      worktree.branch,
      worktree.path,
      base.head,
    ], 180_000)
    next.worktrees[index].provisioned = true
    next.updatedAt = new Date().toISOString()
    await saveManifest(resolvedRoot, next)
    await materializeIncludes(base.root, worktree.path, includes)
    next.worktrees[index].prepared = true
    next.updatedAt = new Date().toISOString()
    await saveManifest(resolvedRoot, next)
  }
  next.phase = PHASE_ACTIVE
  next.updatedAt = new Date().toISOString()
  await saveManifest(resolvedRoot, next)
  return descriptorFromManifest(next)
}

export function ensureCollaborationRoot(home: string): string {
  const root = codingCollaborationRoot(home)
  mkdirSync(root, { recursive: true, mode: 0o700 })
  return existsSync(root) ? resolveExistingDir(root) : root
}
