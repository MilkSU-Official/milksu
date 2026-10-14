export const SESSION_ID = 'companion'

export const DEFAULT_PROVIDER = 'tokenflux'
export const DEFAULT_MODEL = 'deepseek/deepseek-flash'

export const RELAY_PREFIX = '看板娘转达 / Companion relay:\n'

export const CREDENTIAL_WITHDRAWN_ERROR = 'companion credential withdrawn'
export const CREDENTIAL_MISSING_ERROR = 'companion credential missing'

export type ConversationRef = {
  id: string
  title: string
  kind?: string
  workspacePath?: string
  kernel?: string
  status?: string
  archived?: boolean
}

export type SessionState = {
  id: string
  title: string
  kind?: string
  status: string
  lastError?: string
  archived?: boolean
}

export type Todo = {
  id: string
  title: string
  targetConversationId?: string
  dependsOn?: string[]
  note?: string
  reason?: string
  status: string
  updatedAt?: number
}

export type BoardSnapshot = {
  sessions: SessionState[]
  todos: Todo[]
}

export type DispatchResult = {
  accepted: boolean
  delivered: boolean
  conversationId?: string
  targetTitle?: string
  entryId?: string
  error?: string
  needsConfirmation?: boolean
  idempotentReplay?: boolean
}

export type SpeakManyResult = {
  accepted: boolean
  needsConfirmation?: boolean
  targetTitle?: string
  results?: DispatchResult[]
  error?: string
}

export type PendingConfirm = {
  action?: string
  conversationId?: string
  text?: string
  idempotencyKey?: string
  mode?: string
  hostRequestId?: string
  targetTitle?: string
}

export type Status = {
  ready: boolean
  provider: string
  model: string
  error?: string
  pendingConfirm?: PendingConfirm
}

export type MemoryProposal = {
  id: string
  title: string
  markdown: string
  sourceSessionIds?: string[]
  pending: boolean
}

export type ApprovedMemory = {
  id: string
  title: string
  markdown: string
  evidence?: string
  sourceSessionIds?: string[]
  at?: string
}

export type MemorySnapshot = {
  pending: MemoryProposal[]
  approved: ApprovedMemory[]
}

export type MemoryHit = {
  sessionId: string
  snippet: string
  title?: string
}

export type ConversationExcerpt = {
  id: string
  title: string
  messages: Array<{ role: string; text: string }>
  truncated?: boolean
}

export type AppOutcome = {
  ok: boolean
  needsConfirmation?: boolean
  summary?: string
  error?: string
  settings?: Record<string, unknown>
  excerpt?: ConversationExcerpt
  then?: string
}

export type CompanionAttachment = {
  id?: string
  name?: string
  mediaType?: string
  size?: number
  sha256?: string
  [key: string]: unknown
}

export type Catalog = {
  lookup(id: string): Promise<ConversationRef>
  listActive(): Promise<ConversationRef[]>
  listArchived(): Promise<ConversationRef[]>
  create(ref: ConversationRef): Promise<ConversationRef>
}

export type Speaker = {
  deliverSpeak(conversationId: string, text: string): Promise<{ entryId: string; produced: boolean }>
  deliverSteer(conversationId: string, text: string): Promise<{ entryId: string; produced: boolean }>
}

export type SessionControl = {
  abort(conversationId: string): Promise<void>
  steer(conversationId: string, text: string): Promise<void>
}

export type SessionSearcher = {
  search(query: string, limit: number, scope: string): Promise<MemoryHit[]>
}

export type AppControl = {
  openMainWindow(): Promise<void>
  focusConversation(id: string): Promise<void>
  readConversation(id: string, limit: number): Promise<ConversationExcerpt>
  currentSettings(): Promise<Record<string, unknown>>
  saveSettings(next: Record<string, unknown>): Promise<void>
  quit(): Promise<void>
  relaunch(): Promise<void>
}

export type CompanionEvent = {
  schemaVersion?: number
  engine?: string
  sessionId?: string
  type: string
  timestamp?: string
  text?: string
  error?: string
  reason?: string
  toolName?: string
  toolCallId?: string
  durationMs?: number
  done?: boolean
  aborted?: boolean
  resumed?: boolean
  requestId?: string
  input?: string
  notice?: string
  bucket?: string
  source?: string
}
