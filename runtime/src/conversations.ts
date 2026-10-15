import { mkdir, readdir, readFile, rename, stat, unlink, writeFile, chmod } from 'node:fs/promises'
import { join } from 'node:path'
import { conversationsDirectory } from './home.ts'

export const CONVERSATION_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/

export const KERNEL_PI = 'pi'
export const KERNEL_DSH = 'dsh'

export type StoredAttachment = {
  id: string
  name: string
  mediaType: string
  size: number
  sha256: string
}

export type StoredApprovalJustification = {
  purpose?: string
  safety?: string
}

export type StoredMessage = {
  id: string
  role: string
  content: string
  timestamp: number
  toolName?: string
  toolCallId?: string
  durationMs?: number
  status?: string
  approvalRequestId?: string
  approvalInput?: string
  approvalState?: string
  approvalReason?: string
  approvalJustification?: StoredApprovalJustification
  attachments?: StoredAttachment[]
}

export type StoredCapability = {
  id: string
  label: string
  status: string
  detail: string
}

export type StoredGoal = {
  id: string
  text: string
  status: string
  startedAt: number
  updatedAt: number
  iteration: number
  tokenBudget?: number
  tokensUsed: number
  timeUsedSeconds: number
  automaticModelTurns: number
  queuedCount: number
}

export type StoredAgentProblem = {
  notice?: string
  noticeEnglish?: string
  at?: number
}

export type StoredContextUsageCategory = {
  id: string
  tokens: number
}

export type StoredContextUsage = {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  reasoningTokens?: number
  totalTokens: number
  contextWindow?: number
  model?: string
  provider?: string
  recordedAt: number
  sessionInputTokens?: number
  sessionOutputTokens?: number
  sessionCacheReadTokens?: number
  sessionCacheWriteTokens?: number
  sessionReasoningTokens?: number
  sessionTotalTokens?: number
  sessionTurns?: number
  estimatedTokens?: number
  maxOutput?: number
  usableWindow?: number
  categories?: StoredContextUsageCategory[]
}

export type StoredConversation = {
  id: string
  title: string
  createdAt: number
  workspacePath?: string
  workspaceHome?: string
  kernel?: string
  acpAgentId?: string
  parentConversationId?: string
  multitask?: boolean
  modelMode?: string
  modelProvider?: string
  modelId?: string
  thinkingLevel?: string
  executionMode?: string
  approvalPolicy?: string
  mcpServers?: string[]
  mcpConfigDigest?: string
  agentTools?: string[]
  agentExtensions?: string[]
  agentSkills?: string[]
  agentCapabilities?: StoredCapability[]
  agentGoal?: StoredGoal
  agentProblem?: StoredAgentProblem
  domainTaskContext?: Record<string, unknown>
  lastContextUsage?: StoredContextUsage
  archivedAt?: number
  pinned?: boolean
  pinnedOrder?: number
  messages: StoredMessage[]
}

class Mutex {
  private chain: Promise<void> = Promise.resolve()

  run<T>(fn: () => Promise<T>): Promise<T> {
    const previous = this.chain
    let release!: () => void
    this.chain = new Promise((resolve) => {
      release = resolve
    })
    return previous.then(fn).finally(() => release())
  }
}

export function normalizeKernel(value: unknown): string {
  switch (String(value ?? '').trim().toLowerCase()) {
    case KERNEL_DSH:
    case 'acp':
    case 'deepseek':
    case 'deepseek-harness':
      return KERNEL_DSH
    default:
      return KERNEL_PI
  }
}

export function isValidConversationId(id: string): boolean {
  return CONVERSATION_ID_PATTERN.test(id)
}

export function hasStarted(value: StoredConversation): boolean {
  for (const message of value.messages ?? []) {
    if (message.role !== 'user') continue
    if (String(message.status ?? '').trim() === 'queued') continue
    return true
  }
  return false
}

const RETIRED_CTF_FIELDS = ['ctfJobId', 'ctfMode', 'ctfRole', 'ctf_job_id', 'ctf_mode', 'ctf_role']

export function normalizeStoredConversation(value: StoredConversation): StoredConversation {
  value.kernel = normalizeKernel(value.kernel)
  const agentId = String(value.acpAgentId ?? '').trim()
  if (agentId) value.acpAgentId = agentId
  else delete value.acpAgentId
  if (String(value.workspaceHome ?? '').trim().toLowerCase() === 'ctf') {
    value.workspaceHome = 'chat'
  }
  const kind = value.domainTaskContext?.kind
  if (typeof kind === 'string' && kind.trim().toLowerCase() === 'ctf') {
    value.domainTaskContext = undefined
  }
  if (!Array.isArray(value.messages)) value.messages = []
  const extra = value as StoredConversation & Record<string, unknown>
  for (const field of RETIRED_CTF_FIELDS) delete extra[field]
  return value
}

function decodeConversation(raw: string): StoredConversation {
  const parsed = JSON.parse(raw) as StoredConversation
  return normalizeStoredConversation(parsed)
}

export function preserveSentAttachments(
  existing: StoredConversation,
  value: StoredConversation,
): void {
  if (!existing.messages?.length) return
  const keep = (message: StoredMessage) =>
    message.role === 'user' && (message.attachments?.length ?? 0) > 0 && message.id !== ''
  if (!value.messages?.length) {
    for (const message of existing.messages) {
      if (keep(message)) value.messages.push(message)
    }
    return
  }
  const incomingIds = new Set<string>()
  const existingAttachments = new Map<string, StoredAttachment[]>()
  let maxTimestamp = 0
  for (const message of value.messages) {
    if (message.id) incomingIds.add(message.id)
    if (message.timestamp > maxTimestamp) maxTimestamp = message.timestamp
  }
  for (const message of existing.messages) {
    if (!keep(message)) continue
    if (incomingIds.has(message.id)) {
      existingAttachments.set(message.id, message.attachments ?? [])
      continue
    }
    if (message.timestamp > maxTimestamp) continue
    value.messages.push(message)
  }
  for (const message of value.messages) {
    const attachments = existingAttachments.get(message.id)
    if (!attachments || (message.attachments?.length ?? 0) > 0) continue
    message.attachments = attachments
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

export class ConversationStore {
  readonly directory: string
  private readonly mutex = new Mutex()

  constructor(directory: string) {
    this.directory = directory
  }

  static async open(home?: string): Promise<ConversationStore> {
    const directory = conversationsDirectory(home)
    const store = new ConversationStore(directory)
    await store.ensure()
    return store
  }

  archivedDirectory(): string {
    return join(this.directory, 'archived')
  }

  async ensure(): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    await mkdir(this.archivedDirectory(), { recursive: true, mode: 0o700 })
  }

  list(): Promise<StoredConversation[]> {
    return this.mutex.run(() => this.listDirectory(this.directory))
  }

  listArchived(): Promise<StoredConversation[]> {
    return this.mutex.run(async () => {
      const values = await this.listDirectory(this.archivedDirectory())
      values.sort((a, b) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0))
      return values
    })
  }

  get(id: string): Promise<StoredConversation> {
    return this.mutex.run(() => this.getFromDirectory(this.directory, id))
  }

  getAny(id: string): Promise<StoredConversation> {
    return this.mutex.run(async () => {
      try {
        return await this.getFromDirectory(this.directory, id)
      } catch (error) {
        try {
          return await this.getFromDirectory(this.archivedDirectory(), id)
        } catch {
          throw error
        }
      }
    })
  }

  save(value: StoredConversation): Promise<void> {
    return this.mutex.run(async () => {
      if (!isValidConversationId(value.id)) throw new Error('invalid conversation id')
      if (await pathExists(join(this.archivedDirectory(), `${value.id}.json`))) {
        throw new Error('conversation is archived')
      }
      value.archivedAt = 0
      await this.writeToDirectory(this.directory, value)
    })
  }

  delete(id: string): Promise<void> {
    return this.mutex.run(() => this.deleteFromDirectory(this.directory, id))
  }

  deleteArchived(id: string): Promise<void> {
    return this.mutex.run(() => this.deleteFromDirectory(this.archivedDirectory(), id))
  }

  archive(id: string): Promise<void> {
    return this.mutex.run(async () => {
      if (await pathExists(join(this.archivedDirectory(), `${id}.json`))) {
        await this.stamp(this.archivedDirectory(), id, Date.now())
        return
      }
      await this.move(this.directory, this.archivedDirectory(), id)
      await this.stamp(this.archivedDirectory(), id, Date.now())
    })
  }

  restore(id: string): Promise<void> {
    return this.mutex.run(async () => {
      if (await pathExists(join(this.directory, `${id}.json`))) {
        await this.stamp(this.directory, id, 0)
        return
      }
      await this.move(this.archivedDirectory(), this.directory, id)
      await this.stamp(this.directory, id, 0)
    })
  }

  private async listDirectory(directory: string): Promise<StoredConversation[]> {
    let entries: string[]
    try {
      entries = await readdir(directory)
    } catch (error) {
      throw new Error(`list conversations: ${error instanceof Error ? error.message : error}`)
    }
    const values: StoredConversation[] = []
    for (const name of entries) {
      if (!name.endsWith('.json')) continue
      const path = join(directory, name)
      try {
        const info = await stat(path)
        if (info.isDirectory()) continue
        const data = await readFile(path, 'utf8')
        values.push(decodeConversation(data))
      } catch {
        continue
      }
    }
    values.sort((a, b) => b.createdAt - a.createdAt)
    return values
  }

  private async getFromDirectory(directory: string, id: string): Promise<StoredConversation> {
    if (!isValidConversationId(id)) throw new Error('invalid conversation id')
    let data: string
    try {
      data = await readFile(join(directory, `${id}.json`), 'utf8')
    } catch {
      throw new Error('read conversation: file does not exist')
    }
    const value = decodeConversation(data)
    if (value.id !== id) throw new Error('conversation id does not match stored record')
    return value
  }

  private async writeToDirectory(directory: string, value: StoredConversation): Promise<void> {
    if (!isValidConversationId(value.id)) throw new Error('invalid conversation id')
    await mkdir(directory, { recursive: true, mode: 0o700 })
    value.kernel = normalizeKernel(value.kernel)
    const path = join(directory, `${value.id}.json`)
    const data = `${JSON.stringify(value, null, 2)}\n`
    await writeFile(path, data, { mode: 0o600 })
    await chmod(path, 0o600)
  }

  private async deleteFromDirectory(directory: string, id: string): Promise<void> {
    if (!isValidConversationId(id)) throw new Error('invalid conversation id')
    try {
      await unlink(join(directory, `${id}.json`))
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') throw new Error(`delete conversation: ${error instanceof Error ? error.message : error}`)
    }
  }

  private async move(from: string, to: string, id: string): Promise<void> {
    if (!isValidConversationId(id)) throw new Error('invalid conversation id')
    await mkdir(to, { recursive: true, mode: 0o700 })
    try {
      await rename(join(from, `${id}.json`), join(to, `${id}.json`))
    } catch (error) {
      throw new Error(`move conversation: ${error instanceof Error ? error.message : error}`)
    }
  }

  private async stamp(directory: string, id: string, archivedAt: number): Promise<void> {
    const value = await this.getFromDirectory(directory, id)
    value.archivedAt = archivedAt
    await this.writeToDirectory(directory, value)
  }
}
