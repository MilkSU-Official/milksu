import { createHash, randomUUID } from 'node:crypto'
import { chmod, lstat, mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import {
  ConversationStore,
  KERNEL_DSH,
  normalizeKernel,
  type StoredConversation,
  type StoredMessage,
} from './conversations.ts'
import { workspacesDirectory } from './home.ts'

export const DEFAULT_CODING_TITLE_ZH = '新编码任务'
export const DEFAULT_CODING_TITLE_EN = 'New coding task'

const GENERATED_SCRATCH_WORKSPACE =
  /(?:MilkSU\/Coding\/(?:新编码任务|临时任务)-[a-f0-9]{8}|agent-workspaces\/Coding\/无项目任务-[a-f0-9]{8})$/i
const CVE_ID_PATTERN = /^CVE-[0-9]{4}-[0-9]+$/i
const ARTIFACT_OVERRIDE = 'MILKSU_USER_ARTIFACTS_DIR'

export type SessionHandoffResult = {
  sessionId: string
  summary?: string
  surfaceText?: string
}

export function newConversationId(): string {
  return randomUUID()
}

export function fallbackConversationTitle(value: string): string {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim()
  if (!normalized) return DEFAULT_CODING_TITLE_ZH
  const truncated = Array.from(normalized).slice(0, 24).join('')
  return truncated.replace(/[，。！？、；：,.!?;:]+$/u, '').trim() || DEFAULT_CODING_TITLE_ZH
}

export function isPlaceholderTitle(title: string, firstMessage: string): boolean {
  const current = String(title ?? '').trim()
  if (!current) return true
  if (current === DEFAULT_CODING_TITLE_ZH || current === DEFAULT_CODING_TITLE_EN) return true
  return current === fallbackConversationTitle(firstMessage)
}

export function sliceMessagesToRoleOccurrence(
  messages: StoredMessage[],
  role: string,
  occurrence: number,
): StoredMessage[] {
  const wanted = role === 'user' ? 'user' : 'assistant'
  let index = Number.isInteger(occurrence) && occurrence >= 0 ? occurrence : 0
  let seen = -1
  for (let cursor = 0; cursor < messages.length; cursor += 1) {
    const message = messages[cursor]
    if (message.role !== wanted) continue
    if (wanted === 'user' && String(message.status ?? '').trim() === 'queued') continue
    seen += 1
    if (seen === index) {
      return messages.slice(0, cursor + 1).map((item) => ({ ...item }))
    }
  }
  return messages.map((item) => ({ ...item }))
}

export function rewindVisibleMessages(messages: StoredMessage[]): StoredMessage[] | null {
  const users = messages.filter((message) => (
    message.role === 'user' && String(message.status ?? '').trim() !== 'queued'
  ))
  if (users.length < 2) return null
  const lastUser = users[users.length - 1]
  const previousUser = users[users.length - 2]
  const lastUserIndex = messages.lastIndexOf(lastUser)
  const previousUserIndex = messages.lastIndexOf(previousUser)
  const lastAssistant = [...messages.slice(previousUserIndex, lastUserIndex)]
    .reverse()
    .find((message) => message.role === 'assistant')
  const keepUntil = lastAssistant
    ? messages.lastIndexOf(lastAssistant)
    : previousUserIndex
  return messages.slice(0, keepUntil + 1).map((item) => ({ ...item }))
}

export function cloneConversationRow(
  source: StoredConversation,
  options: { id: string; title?: string; messages?: StoredMessage[]; kernel?: string },
): StoredConversation {
  const title = String(options.title ?? source.title).trim().slice(0, 40) || source.title
  const cloned: StoredConversation = {
    ...source,
    id: options.id,
    title,
    createdAt: Date.now(),
    kernel: normalizeKernel(options.kernel ?? source.kernel),
    pinned: undefined,
    pinnedOrder: undefined,
    archivedAt: undefined,
    lastContextUsage: undefined,
    parentConversationId: undefined,
    multitask: undefined,
    messages: (options.messages ?? []).map((item) => ({ ...item })),
  }
  return cloned
}

export async function forkConversationRecord(
  store: ConversationStore,
  conversationId: string,
  forkedId: string,
  role: string,
  occurrence: number,
): Promise<StoredConversation> {
  const source = await store.get(conversationId)
  const pointRole = role === 'user' ? 'user' : 'assistant'
  const firstUser = source.messages.find((message) => message.role === 'user')
  const forked = cloneConversationRow(source, {
    id: forkedId,
    title: fallbackConversationTitle(firstUser?.content ?? source.title),
    messages: sliceMessagesToRoleOccurrence(source.messages, pointRole, occurrence),
  })
  await store.save(forked)
  return forked
}

export async function rewindConversationRecord(
  store: ConversationStore,
  conversationId: string,
): Promise<StoredConversation> {
  const stored = await store.get(conversationId)
  const kept = rewindVisibleMessages(stored.messages)
  if (!kept) throw new Error('Nothing to rewind')
  stored.messages = kept
  await store.save(stored)
  return stored
}

export function handoffSummaryFromStored(stored: StoredConversation): string {
  const parts: string[] = []
  for (const message of stored.messages) {
    const content = String(message.content ?? '').trim()
    const role = String(message.role ?? '').trim()
    if (!content) continue
    const clipped = content.length > 400 ? content.slice(0, 400) : content
    parts.push(role ? `${role}: ${clipped}` : clipped)
    if (parts.length >= 8) break
  }
  if (parts.length === 0) return String(stored.title ?? '').trim()
  return parts.join('\n')
}

export function handoffFromStoredConversation(stored: StoredConversation): SessionHandoffResult {
  const summary = handoffSummaryFromStored(stored)
  return {
    sessionId: newConversationId(),
    summary,
    surfaceText: summary,
  }
}

export function compactionAllowsStoredHandoff(error: unknown): boolean {
  const text = String(error instanceof Error ? error.message : error).toLowerCase()
  return text.includes('session not found') || text.includes('sidecar is not running')
}

export function visibleHandoffMessages(
  messages: StoredMessage[],
  receipt: SessionHandoffResult,
): StoredMessage[] {
  const summary = String(receipt.summary ?? '').trim()
  if (summary) {
    return [{
      id: newConversationId(),
      role: 'assistant',
      content: summary,
      timestamp: Date.now(),
      status: 'done',
    }]
  }
  const original = messages.filter((message) => (
    (message.role === 'user' || message.role === 'assistant')
    && String(message.status ?? '').trim() !== 'queued'
    && String(message.content ?? '').trim()
  )).map((message) => ({ ...message, status: 'done' }))
  if (original.length > 0) return original
  const surface = String(receipt.surfaceText ?? '').trim()
  if (surface) {
    return [{
      id: newConversationId(),
      role: 'assistant',
      content: surface,
      timestamp: Date.now(),
      status: 'done',
    }]
  }
  return []
}

export async function saveHandoffConversation(
  store: ConversationStore,
  source: StoredConversation,
  receipt: SessionHandoffResult,
  kernel: string,
): Promise<StoredConversation> {
  const handed = cloneConversationRow(source, {
    id: receipt.sessionId,
    title: source.title,
    kernel,
    messages: visibleHandoffMessages(source.messages, receipt),
  })
  await store.save(handed)
  return handed
}

export async function applyGeneratedTitle(
  store: ConversationStore,
  conversationId: string,
  title: string,
): Promise<StoredConversation> {
  const stored = await store.get(conversationId)
  stored.title = title
  await store.save(stored)
  return stored
}

export async function findConversationForTitle(
  store: ConversationStore,
  firstMessage: string,
): Promise<StoredConversation | null> {
  const needle = String(firstMessage ?? '').trim()
  if (!needle) return null
  const values = await store.list()
  for (const value of values) {
    const first = value.messages.find((message) => message.role === 'user')
    if (String(first?.content ?? '').trim() !== needle) continue
    if (!isPlaceholderTitle(value.title, needle)) continue
    return value
  }
  return null
}

export function isGeneratedScratchWorkspace(path: string): boolean {
  const normalized = String(path ?? '').trim().replaceAll('\\', '/')
  return GENERATED_SCRATCH_WORKSPACE.test(normalized)
}

export function artifactDirectory(
  env: NodeJS.ProcessEnv = process.env,
  userHome = homedir(),
): string {
  const override = String(env[ARTIFACT_OVERRIDE] ?? '').trim()
  if (override) {
    if (!isAbsolute(override)) {
      throw new Error('MilkSU artifact directory must be an absolute path')
    }
    return resolve(override)
  }
  const home = String(userHome || env.HOME || env.USERPROFILE || '').trim()
  if (!home) throw new Error('cannot resolve user home for MilkSU artifacts')
  if (process.platform === 'win32') return join(home, 'MilkSU')
  return join(home, 'Documents', 'MilkSU')
}

function slug(value: string): string {
  let builder = ''
  let previousSeparator = false
  let characterCount = 0
  for (const character of String(value ?? '').trim()) {
    if (/[\p{L}\p{N}]/u.test(character)) {
      builder += character
      characterCount += 1
      previousSeparator = false
    } else if (character === '-' || character === '_' || /\s/u.test(character)) {
      if (builder.length > 0 && !previousSeparator) {
        builder += '-'
        characterCount += 1
        previousSeparator = true
      }
    }
    if (characterCount >= 48) break
  }
  return builder.replace(/^-+|-+$/g, '')
}

async function protectDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 })
  try {
    await chmod(path, 0o700)
  } catch {
    // Windows may ignore POSIX modes
  }
}

function ensureWithin(root: string, target: string): void {
  const relativePath = relative(root, target)
  if (!relativePath || relativePath === '..' || relativePath.startsWith(`..${sep}`)) {
    throw new Error('MilkSU artifact workspace escaped its section')
  }
}

async function notSymlink(path: string): Promise<void> {
  try {
    const info = await lstat(path)
    if (info.isSymbolicLink()) {
      throw new Error('MilkSU artifact workspace must not be a symbolic link')
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return
    throw error
  }
}

export async function createArtifactWorkspace(
  root: string,
  kind: 'Coding' | 'CVE' | 'Lab',
  identity: string,
  label: string,
): Promise<string> {
  const id = String(identity ?? '').trim()
  if (!id) throw new Error('MilkSU artifact workspace identity is required')
  await protectDirectory(root)
  const section = join(root, kind)
  await protectDirectory(section)
  let name = ''
  if (kind === 'CVE' && CVE_ID_PATTERN.test(String(label ?? '').trim())) {
    name = String(label).trim().toUpperCase()
  } else {
    name = slug(label)
    if (!name) name = kind.toLowerCase()
    const digest = createHash('sha256').update(id).digest('hex').slice(0, 8)
    name += `-${digest}`
  }
  const workspace = join(section, name)
  ensureWithin(section, workspace)
  await notSymlink(workspace)
  await protectDirectory(workspace)
  const gitDir = join(workspace, '.git')
  await notSymlink(gitDir)
  await protectDirectory(gitDir)
  return workspace
}

async function seedReport(workspace: string, heading: string): Promise<void> {
  const path = join(workspace, 'report.md')
  try {
    const info = await lstat(path)
    if (info.isSymbolicLink()) throw new Error('MilkSU report must not be a symbolic link')
    return
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') throw error
  }
  const title = String(heading ?? '').trim() || '报告'
  const body = `# ${title}\n\n## 摘要\n\n## 环境\n\n## 进程\n\n## 网络\n\n## 步骤\n`
  await writeFile(path, body, { mode: 0o600 })
}

async function seedRelated(workspace: string, cveId: string): Promise<void> {
  const path = join(workspace, 'related.md')
  try {
    const info = await lstat(path)
    if (info.isSymbolicLink()) throw new Error('MilkSU related CVE file must not be a symbolic link')
    return
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') throw error
  }
  const id = String(cveId ?? '').trim()
  const heading = id ? `关联 CVE · ${id}` : '关联 CVE'
  const body = `# ${heading}\n\n## 上游\n\n## 下游\n\n## 同类\n`
  await writeFile(path, body, { mode: 0o600 })
}

export async function ensureCodingArtifactWorkspace(
  store: ConversationStore,
  conversationId: string,
  home: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const stored = await store.get(conversationId)
  if (String(stored.workspaceHome ?? '').trim() === 'image') {
    return ensureImageWorkspace(store, stored, home)
  }
  const existing = String(stored.workspacePath ?? '').trim()
  if (existing) return existing

  const domain = stored.domainTaskContext ?? {}
  const domainKind = String(domain.kind ?? '').trim()
  let kind: 'Coding' | 'CVE' | 'Lab' = 'Coding'
  let label = '无项目任务'
  let workspaceRoot = join(workspacesDirectory(home), 'agent-workspaces')
  let identity = conversationId
  if (domainKind === 'cve') {
    kind = 'CVE'
    workspaceRoot = artifactDirectory(env)
    const cveId = String(domain.cveId ?? '').trim()
    if (cveId) label = cveId
  } else if (domainKind === 'lab') {
    kind = 'Lab'
    workspaceRoot = artifactDirectory(env)
    const title = String(domain.title ?? '').trim()
    label = title || '实验室作业'
    const jobId = String(domain.jobId ?? '').trim()
    if (jobId) identity = `lab-job-${jobId}`
  }
  const workspace = await createArtifactWorkspace(workspaceRoot, kind, identity, label)
  if (kind === 'CVE' || kind === 'Lab') {
    await seedReport(workspace, label)
  }
  if (kind === 'CVE') {
    await seedRelated(workspace, label)
  }
  stored.workspacePath = workspace
  await store.save(stored)
  return workspace
}

async function ensureImageWorkspace(
  store: ConversationStore,
  stored: StoredConversation,
  home: string,
): Promise<string> {
  const existing = String(stored.workspacePath ?? '').trim()
  if (isGeneratedScratchWorkspace(existing)) return existing
  const workspace = await createArtifactWorkspace(
    join(workspacesDirectory(home), 'agent-workspaces'),
    'Coding',
    stored.id,
    '无项目任务',
  )
  stored.workspacePath = workspace
  await store.save(stored)
  return workspace
}

export function agentSessionMissingError(sessionId: string, kernel: string): Error {
  if (normalizeKernel(kernel) === KERNEL_DSH) {
    return new Error(`Agent session not found: ${sessionId}`)
  }
  return new Error(`PI session not found: ${sessionId}`)
}

export function sidecarMissingError(kernel: string): Error {
  if (normalizeKernel(kernel) === KERNEL_DSH) {
    return new Error('Agent is not running')
  }
  return new Error('PI Sidecar is not running')
}
