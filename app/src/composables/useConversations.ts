import { createStore, nextTick } from '@/lib/reactStore'
import { invokeCommand, listenEvent } from '@/desktop'
import type { CodingCompactionResult, CodingProjectMemory } from '@/codingEnvironmentTypes'
import {
  applyCodingContinuityEvent,
  armCompactionErrorDismiss,
  clearCodingContinuityError,
  codingCompactionErrorMessage,
  createCodingContinuityState,
  removeCodingContinuitySession,
} from '@/codingContinuity'
import type { CodingContinuityState } from '@/codingContinuity'
import {
  DEFAULT_CODING_APPROVAL_POLICY,
  DEFAULT_CODING_EXECUTION_MODE,
  normalizeCodingApprovalPolicy,
  normalizeCodingExecutionMode,
} from '@/lib/codingPolicy'
import {
  applyAssistantThinkingEvent,
  applyCodingToolEvent,
  hasIdleRunResidue,
  settleLiveThinking,
  settleRunningToolMessages,
  withoutBlankAssistantMessages,
} from '@/lib/chatActivity'
import { redactProviderCredentials } from '@/lib/redaction'
import { normalizeSubagentTasks } from '@/lib/subagentRoster'
import { explainModelServiceError } from '@/lib/tokenFluxError'
import { t } from '@/lib/uiLocale'
import {
  conversationKernelLocked,
  normalizeAgentKernel,
  type AgentKernel,
} from '@/lib/agentKernel'
import {
  askApprovalChoice,
  encodeAskOtherChoice,
  pendingAskMessage,
} from '@/lib/agentAsk'
import { normalizeDomainTaskContext } from '@/lib/domainTaskContext'
import { shouldRememberCodingProject } from '@/lib/codingProjectMemory'
import { conversationWorkspaceHome, type WorkspaceHome } from '@/lib/workspaceSessionRouting'
import { modelContextWindowOverride, resolveModelContextWindow } from '@/lib/knownContextWindow'
import { installedModelContextWindows } from '@/modelCatalog'
import { MODEL_THINKING_LEVELS } from '@/lib/modelThinking'
import {
  applySessionCompacting,
  applySessionContextComposition,
  applySessionContextWindow,
  applySessionRunFinished,
  applySessionRunStarted,
  applySessionUsageAfterCompaction,
  applySessionUsageRecorded,
  compositionFromStoredUsage,
  emptySessionTurnSnapshot,
  readContextCompositionFromEvent,
  snapshotFromStoredContextUsage,
  storedContextUsageFromSnapshot,
  type ContextComposition,
  type SessionTurnSnapshot,
  type SessionTurnUsage,
} from '@/lib/sessionTurnStatus'
import type {
  CodingApprovalPolicy,
  CodingAttachment,
  CodingCapability,
  CodingExecutionMode,
  CodingGoalState,
  CodingProductActionRequest,
  Conversation,
  Message,
  ModelThinkingLevel,
  SubagentTask,
} from '@/types'

const BROWSER_USE_MCP_SERVER = 'milksu-playwright-user'
const DEFAULT_CODING_CONVERSATION_TITLE = t('新编码任务', 'New coding task')
type ComposerScopeToken = 'browser-use' | 'computer-use'

export function rewindVisibleMessages(messages: Message[]): Message[] | null {
  const users = messages.filter(message => (
    message.role === 'user' && message.status !== 'queued'
  ))
  if (users.length < 2) return null
  const lastUser = users[users.length - 1]
  const previousUser = users[users.length - 2]
  const lastUserIndex = messages.lastIndexOf(lastUser)
  const previousUserIndex = messages.lastIndexOf(previousUser)
  const lastAssistant = [...messages.slice(previousUserIndex, lastUserIndex)]
    .reverse()
    .find(message => message.role === 'assistant')
  const keepUntil = lastAssistant
    ? messages.lastIndexOf(lastAssistant)
    : previousUserIndex
  return messages.slice(0, keepUntil + 1)
}

export function lastRewindableUserMessageId(messages: Message[]): string | undefined {
  if (!rewindVisibleMessages(messages)) return undefined
  const users = messages.filter(message => (
    message.role === 'user' && message.status !== 'queued'
  ))
  return users.at(-1)?.id
}

export function fallbackConversationTitle(value: string) {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim()
  if (!normalized) return DEFAULT_CODING_CONVERSATION_TITLE
  const truncated = Array.from(normalized).slice(0, 24).join('')
  return truncated.replace(/[，。！？、；：,.!?;:]+$/u, '').trim()
    || DEFAULT_CODING_CONVERSATION_TITLE
}

export function turnMCPServers(
  selected: string[] | undefined,
  scopeToken?: ComposerScopeToken,
) {
  return [
    ...(selected ?? []),
    ...(scopeToken === 'browser-use' ? [BROWSER_USE_MCP_SERVER] : []),
  ]
}

function normalizeAttachments(value: unknown): CodingAttachment[] | undefined {
  if (!Array.isArray(value)) return undefined
  const attachments = value.flatMap(item => {
    if (!item || typeof item !== 'object') return []
    const attachment = item as Record<string, unknown>
    const id = String(attachment.id ?? '').toLowerCase()
    const sha256 = String(attachment.sha256 ?? '').toLowerCase()
    const name = String(attachment.name ?? '')
    const size = Number(attachment.size ?? 0)
    if (
      !/^[a-f0-9]{64}$/.test(id)
      || sha256 !== id
      || !name
      || name.length > 320
      || !Number.isSafeInteger(size)
      || size <= 0
      || size > 32 * 1024 * 1024
    ) return []
    return [{
      id,
      sha256,
      name,
      mediaType: String(attachment.mediaType ?? 'application/octet-stream'),
      size,
    }]
  })
  return attachments.length ? attachments.slice(0, 8) : undefined
}

function normalizeMCPServers(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const hasControlCharacter = (name: string) => (
    [...name].some(character => {
      const codePoint = character.codePointAt(0) ?? 0
      return codePoint <= 0x1f || codePoint === 0x7f
    })
  )
  const servers = [...new Set(value.map(item => String(item).trim()).filter(Boolean))]
    .filter(name => name.length <= 80 && !hasControlCharacter(name))
    .slice(0, 16)
    .sort((left, right) => left.localeCompare(right))
  return servers.length ? servers : undefined
}

const goalStatuses = new Set<CodingGoalState['status']>([
  'active',
  'paused',
  'blocked',
  'usage_limited',
  'budget_limited',
  'complete',
  'queued',
])

function normalizeGoal(value: unknown): CodingGoalState | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const goal = value as Record<string, unknown>
  const status = String(goal.status ?? '') as CodingGoalState['status']
  const id = String(goal.id ?? '').trim().slice(0, 160)
  const text = String(goal.text ?? '').trim().slice(0, 4000)
  if (!id || !text || !goalStatuses.has(status)) return undefined
  const nonNegativeInteger = (candidate: unknown) => {
    const number = Number(candidate)
    return Number.isFinite(number) && number >= 0 ? Math.floor(number) : 0
  }
  const tokenBudget = Number(goal.tokenBudget)
  return {
    id,
    text,
    status,
    startedAt: nonNegativeInteger(goal.startedAt),
    updatedAt: nonNegativeInteger(goal.updatedAt),
    iteration: nonNegativeInteger(goal.iteration),
    tokenBudget: Number.isSafeInteger(tokenBudget) && tokenBudget > 0
      ? tokenBudget
      : undefined,
    tokensUsed: nonNegativeInteger(goal.tokensUsed),
    timeUsedSeconds: nonNegativeInteger(goal.timeUsedSeconds),
    automaticModelTurns: nonNegativeInteger(goal.automaticModelTurns),
    queuedCount: nonNegativeInteger(goal.queuedCount),
  }
}

interface AgentEvent {
  sessionId?: string
  /** Engine instance that produced the event; absent on session-less engine stops. */
  engine?: string
  type: string
  text?: string
  toolName?: string
  toolCallId?: string
  durationMs?: number
  error?: string
  done?: boolean
  tools?: string[]
  extensions?: string[]
  skills?: string[]
  executionMode?: CodingExecutionMode
  approvalPolicy?: CodingApprovalPolicy
  capabilities?: CodingCapability[]
  requestId?: string
  input?: string
  approved?: boolean
  grantable?: boolean
  /** The requester's own purpose/safety note for a destructive approval. */
  justification?: { purpose?: string; safety?: string }
  choice?: string
  reason?: string
  goal?: CodingGoalState
  subagentTasks?: SubagentTask[]
  resumed?: boolean
  aborted?: boolean
  steering?: string[]
  followUp?: string[]
  /** Sessions a deliberately stopped engine instance was serving. */
  sessions?: string[]
  /** Workspace of that engine instance, for diagnostics. */
  workspace?: string
  modelSource?: 'account' | 'personal'
  /** Credential-free model usage projection from Pi (usage.recorded). */
  usage?: {
    inputTokens?: number
    outputTokens?: number
    cacheReadTokens?: number
    cacheWriteTokens?: number
    reasoningTokens?: number
    totalTokens?: number
    model?: string
    provider?: string
    recordId?: string
    contextComposition?: ContextComposition
  }
  /** Go-projected context.composition; may also ride next to usage. */
  contextComposition?: ContextComposition
  estimatedTokens?: number
  contextWindow?: number
  categories?: ContextComposition['categories']
  compaction?: {
    tokensBefore?: number
    estimatedTokensAfter?: number
  }
}

interface RuntimeTurnDispatch {
  prompt: string
  attachments: CodingAttachment[]
  scopeToken?: ComposerScopeToken
  productAction?: CodingProductActionRequest
  branchFromUserOccurrence?: number
}

export interface CodingMessageQueue {
  steering: string[]
  followUp: string[]
  /** True when the last turn ended before Pi consumed these steering messages. */
  stalled?: boolean
}

export function projectCodingMessageQueue(
  steering: unknown,
  followUp: unknown,
): CodingMessageQueue {
  const normalize = (value: unknown) => (Array.isArray(value) ? value : [])
    .map(item => String(item ?? '').trim())
    .filter(Boolean)
    .slice(0, 8)
    .map(item => Array.from(item).slice(0, 16_000).join(''))
  return {
    steering: normalize(steering),
    followUp: normalize(followUp),
  }
}

export function projectAgentTools(
  eventType: string,
  tools: string[] | undefined,
  previous: string[] | undefined,
  turnPolicyActive = false,
) {
  if (eventType === 'session.turn_policy' || turnPolicyActive) return []
  return tools ?? previous
}

export function projectAgentTurnPolicy(
  eventType: string,
  previous: boolean,
) {
  if (eventType === 'session.turn_policy') return true
  if (eventType === 'session.turn_policy_cleared') return false
  return previous
}

interface WorkspaceTask {
  jobId: string
  conversationId: string
  title: string
  workspacePath: string
  prompt: string
  visibleText?: string
  policy: {
    mode: 'coach' | 'copilot' | 'delegate'
  }
  role: 'solver' | 'tool-builder' | 'strategist'
  domainTaskContext?: Conversation['domainTaskContext']
  /** When false/omitted, attach session only — never auto-start Pi or fill the composer. */
  autoSend?: boolean
}

export interface PendingComposerDraft {
  prompt: string
  visibleText: string
}

function normalizeLastContextUsage(raw: unknown): Conversation['lastContextUsage'] {
  if (!raw || typeof raw !== 'object') return undefined
  const value = raw as Record<string, unknown>
  const inputTokens = Math.max(0, Math.floor(Number(value.inputTokens) || 0))
  const outputTokens = Math.max(0, Math.floor(Number(value.outputTokens) || 0))
  const cacheReadTokens = Math.max(0, Math.floor(Number(value.cacheReadTokens) || 0))
  const cacheWriteTokens = Math.max(0, Math.floor(Number(value.cacheWriteTokens) || 0))
  const reasoningTokens = Math.max(0, Math.floor(Number(value.reasoningTokens) || 0))
  const totalTokens = Math.max(0, Math.floor(Number(value.totalTokens) || 0))
    || (inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens)
  const recordedAt = Math.max(0, Math.floor(Number(value.recordedAt) || 0))
  const composition = compositionFromStoredUsage(value)
  if (totalTokens <= 0 && inputTokens <= 0 && !composition) return undefined
  const contextWindow = Math.max(0, Math.floor(Number(value.contextWindow) || 0))
  const sessionTurns = Math.max(0, Math.floor(Number(value.sessionTurns) || 0))
  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    reasoningTokens: reasoningTokens || undefined,
    totalTokens,
    contextWindow: contextWindow || undefined,
    model: typeof value.model === 'string' ? value.model : undefined,
    provider: typeof value.provider === 'string' ? value.provider : undefined,
    recordedAt,
    sessionInputTokens: sessionTurns ? Math.max(0, Math.floor(Number(value.sessionInputTokens) || 0)) : undefined,
    sessionOutputTokens: sessionTurns ? Math.max(0, Math.floor(Number(value.sessionOutputTokens) || 0)) : undefined,
    sessionCacheReadTokens: sessionTurns ? Math.max(0, Math.floor(Number(value.sessionCacheReadTokens) || 0)) : undefined,
    sessionCacheWriteTokens: sessionTurns ? Math.max(0, Math.floor(Number(value.sessionCacheWriteTokens) || 0)) : undefined,
    sessionReasoningTokens: sessionTurns ? Math.max(0, Math.floor(Number(value.sessionReasoningTokens) || 0)) : undefined,
    sessionTotalTokens: sessionTurns ? Math.max(0, Math.floor(Number(value.sessionTotalTokens) || 0)) : undefined,
    sessionTurns: sessionTurns || undefined,
    composition,
  }
}

export function normalizeConversation(raw: Record<string, unknown>): Conversation {
  const messages = (raw.messages as Record<string, unknown>[] | undefined) ?? []
  return {
    id: String(raw.id ?? ''),
    title: String(raw.title ?? t('未命名对话', 'Untitled conversation')),
    createdAt: Number(raw.createdAt ?? 0),
    workspacePath: typeof raw.workspacePath === 'string' ? raw.workspacePath : undefined,
    pinned: raw.pinned === true ? true : undefined,
    pinnedOrder: Number.isFinite(Number(raw.pinnedOrder))
      ? Number(raw.pinnedOrder)
      : undefined,
    kernel: normalizeAgentKernel(raw.kernel),
    modelMode: ['auto', 'manual'].includes(String(raw.modelMode))
      ? raw.modelMode as Conversation['modelMode']
      : undefined,
    modelProvider: typeof raw.modelProvider === 'string' ? raw.modelProvider : undefined,
    modelId: typeof raw.modelId === 'string' ? raw.modelId : undefined,
    thinkingLevel: MODEL_THINKING_LEVELS.includes(raw.thinkingLevel as ModelThinkingLevel)
      ? raw.thinkingLevel as ModelThinkingLevel
      : undefined,
    modelSourcePreference: raw.modelSourcePreference === 'account'
      || raw.modelSourcePreference === 'personal'
      ? raw.modelSourcePreference
      : undefined,
    modelSource: raw.modelSource === 'account' || raw.modelSource === 'personal'
      ? raw.modelSource
      : undefined,
    executionMode: normalizeCodingExecutionMode(raw.executionMode),
    approvalPolicy: normalizeCodingApprovalPolicy(raw.approvalPolicy),
    mcpServers: normalizeMCPServers(raw.mcpServers),
    mcpConfigDigest: /^[a-f0-9]{64}$/i.test(String(raw.mcpConfigDigest ?? ''))
      ? String(raw.mcpConfigDigest).toLowerCase()
      : undefined,
    agentTools: Array.isArray(raw.agentTools)
      ? raw.agentTools.map(String)
      : undefined,
    agentExtensions: Array.isArray(raw.agentExtensions)
      ? raw.agentExtensions.map(String)
      : undefined,
    agentSkills: Array.isArray(raw.agentSkills)
      ? raw.agentSkills.map(String)
      : undefined,
    agentCapabilities: Array.isArray(raw.agentCapabilities)
      ? raw.agentCapabilities.flatMap(value => {
          if (!value || typeof value !== 'object') return []
          const capability = value as Record<string, unknown>
          const status = String(capability.status)
          if (!['allowed', 'blocked', 'approval-required', 'unavailable'].includes(status)) return []
          return [{
            id: String(capability.id ?? ''),
            label: String(capability.label ?? ''),
            status: status as CodingCapability['status'],
            detail: String(capability.detail ?? ''),
          }]
        })
      : undefined,
    agentGoal: normalizeGoal(raw.agentGoal),
    subagentTasks: normalizeSubagentTasks(raw.subagentTasks),
    ctfJobId: typeof raw.ctfJobId === 'string' ? raw.ctfJobId : undefined,
    ctfMode: ['coach', 'copilot', 'delegate'].includes(String(raw.ctfMode))
      ? raw.ctfMode as Conversation['ctfMode']
      : undefined,
    ctfRole: ['solver', 'tool-builder', 'strategist'].includes(String(raw.ctfRole))
      ? raw.ctfRole as Conversation['ctfRole']
      : undefined,
    workspaceHome: ['chat', 'ctf', 'vuln', 'lab'].includes(String(raw.workspaceHome))
      ? raw.workspaceHome as Conversation['workspaceHome']
      : undefined,
    domainTaskContext: normalizeDomainTaskContext(raw.domainTaskContext),
    lastContextUsage: normalizeLastContextUsage(raw.lastContextUsage),
    messages: settleRunningToolMessages(messages.map(message => {
      const rawApprovalState = String(message.approvalState ?? '')
      const approvalState = rawApprovalState === 'pending'
        ? 'expired'
        : ['approved', 'denied', 'expired'].includes(rawApprovalState)
          ? rawApprovalState as Message['approvalState']
          : undefined
      return {
        id: String(message.id ?? crypto.randomUUID()),
        role: message.role as Message['role'],
        content: String(message.content ?? ''),
        timestamp: Number(message.timestamp ?? Date.now()),
        toolName: message.toolName as string | undefined,
        toolCallId: typeof message.toolCallId === 'string'
          ? message.toolCallId
          : undefined,
        durationMs: Number.isFinite(Number(message.durationMs))
          && Number(message.durationMs) >= 0
          ? Math.floor(Number(message.durationMs))
          : undefined,
        status: approvalState === 'expired'
          ? 'done'
          : (message.status as Message['status']) ?? 'done',
        approvalRequestId: typeof message.approvalRequestId === 'string'
          ? message.approvalRequestId
          : undefined,
        approvalInput: typeof message.approvalInput === 'string'
          ? message.approvalInput
          : undefined,
        approvalState,
        approvalGrantable: message.approvalGrantable === true,
        approvalChoiceId: typeof message.approvalChoiceId === 'string'
          ? message.approvalChoiceId
          : undefined,
        approvalReason: approvalState === 'expired'
          ? t('应用或 Agent 已重启，本次审批已失效', 'The app or Agent restarted, so this approval is no longer valid')
          : typeof message.approvalReason === 'string'
            ? message.approvalReason
            : undefined,
        attachments: normalizeAttachments(message.attachments),
        thinking: typeof message.thinking === 'string' && message.thinking.trim()
          ? message.thinking
          : undefined,
        thinkingStatus: message.thinkingStatus === 'running' || message.thinkingStatus === 'done'
          ? message.thinkingStatus
          : (typeof message.thinking === 'string' && message.thinking.trim() ? 'done' : undefined),
        thinkingDurationMs: Number.isFinite(Number(message.thinkingDurationMs))
          && Number(message.thinkingDurationMs) >= 0
          ? Math.floor(Number(message.thinkingDurationMs))
          : undefined,
      }
    })),
  }
}

/**
 * Projects one stored message. Shared by conversations read from disk and by messages
 * the backend appends while a remote device drives a turn.
 */
export function normalizeStoredMessage(message: Record<string, unknown>): Message {
  const rawApprovalState = String(message.approvalState ?? '')
  const approvalState = rawApprovalState === 'pending'
    ? 'expired'
    : ['approved', 'denied', 'expired'].includes(rawApprovalState)
      ? rawApprovalState as Message['approvalState']
      : undefined
  return {
    id: String(message.id ?? crypto.randomUUID()),
    role: message.role as Message['role'],
    content: String(message.content ?? ''),
    timestamp: Number(message.timestamp ?? Date.now()),
    toolName: message.toolName as string | undefined,
    toolCallId: typeof message.toolCallId === 'string'
      ? message.toolCallId
      : undefined,
    durationMs: Number.isFinite(Number(message.durationMs))
      && Number(message.durationMs) >= 0
      ? Math.floor(Number(message.durationMs))
      : undefined,
    status: approvalState === 'expired'
      ? 'done'
      : (message.status as Message['status']) ?? 'done',
    approvalRequestId: typeof message.approvalRequestId === 'string'
      ? message.approvalRequestId
      : undefined,
    approvalInput: typeof message.approvalInput === 'string'
      ? message.approvalInput
      : undefined,
    approvalState,
    approvalGrantable: message.approvalGrantable === true,
    // Restored from disk: a reloaded card must still show the purpose/safety note the
    // requester gave, instead of falling back to "not provided by the requester".
    approvalJustification: message.approvalJustification as
      | { purpose?: unknown; safety?: unknown }
      | undefined
      ? {
          purpose: typeof (message.approvalJustification as { purpose?: unknown }).purpose === 'string'
            ? String((message.approvalJustification as { purpose?: unknown }).purpose)
            : undefined,
          safety: typeof (message.approvalJustification as { safety?: unknown }).safety === 'string'
            ? String((message.approvalJustification as { safety?: unknown }).safety)
            : undefined,
        }
      : undefined,
    approvalChoiceId: typeof message.approvalChoiceId === 'string'
      ? message.approvalChoiceId
      : undefined,
    approvalReason: approvalState === 'expired'
      ? t('应用或 Agent 已重启，本次审批已失效', 'The app or Agent restarted, so this approval is no longer valid')
      : typeof message.approvalReason === 'string'
        ? message.approvalReason
        : undefined,
    attachments: normalizeAttachments(message.attachments),
    thinking: typeof message.thinking === 'string' && message.thinking.trim()
      ? message.thinking
      : undefined,
    thinkingStatus: message.thinkingStatus === 'running' || message.thinkingStatus === 'done'
      ? message.thinkingStatus
      : (typeof message.thinking === 'string' && message.thinking.trim() ? 'done' : undefined),
    thinkingDurationMs: Number.isFinite(Number(message.thinkingDurationMs))
      && Number(message.thinkingDurationMs) >= 0
      ? Math.floor(Number(message.thinkingDurationMs))
      : undefined,
  }
}

/** Payload of the backend's `remote-turn-started` desktop event. */
export interface RemoteTurnStartedPayload {
  conversationId?: string
  message?: Record<string, unknown>
}

/** True when the text looks like MilkSU/Node internals, not a provider reply. */
function isInternalAgentStack(message: string) {
  return (
    /node:internal|node:events|Unhandled ['"]error['"] event|bridge\.js|Cannot find module|Uncaught Exception|TypeError:|ReferenceError:|SyntaxError:|internal module|stack trace|milksu-sidecar|at\s+\S+\.(?:js|cjs|mjs|ts|go):\d+/i
      .test(message)
    || /Access to this API has been restricted|--allow-fs-(?:read|write)|ERR_ACCESS_DENIED/i
      .test(message)
  )
}

/**
 * Prefer a short, credential-free detail for chat. HTTP + JSON bodies from
 * TokenFlux/OpenAI-compatible APIs are unwrapped to their message field.
 */
export function agentProviderErrorDetail(value: unknown) {
  const raw = String(value ?? '')
  // Keep multi-line provider bodies (JSON) when the first line is only a status.
  const cleaned = raw
    .replace(/^(?:Error:\s*)+/gim, '')
    .replace(/\r\n/g, '\n')
    .trim()
  const compact = cleaned.split(/\n+/).map(line => line.trim()).filter(Boolean).join(' ')
  const redacted = redactProviderCredentials(compact)
  if (!redacted) return ''

  const statusJson = redacted.match(/^(\d{3})\s*:\s*(\{[\s\S]*\})\s*$/)
  if (statusJson) {
    try {
      const body = JSON.parse(statusJson[2]) as Record<string, unknown>
      const nested = body.error
      const nestedMessage = nested && typeof nested === 'object'
        ? String((nested as { message?: unknown }).message ?? '').trim()
        : ''
      const message = String(
        body.message
        ?? nestedMessage
        ?? (typeof nested === 'string' ? nested : '')
        ?? body.type
        ?? '',
      ).trim()
      if (message) return `${statusJson[1]}：${message}`
    } catch {
      // fall through to redacted text
    }
  }
  return redacted
}

export function agentErrorMessage(value: unknown) {
  const message = agentProviderErrorDetail(value) || 'Agent engine failed'
  if (/no API key is configured|No API key for/i.test(message)) {
    return t('当前模型没有可用的 API Key。', 'No API key is available for the current model.')
  }
  if (/Model not found/i.test(message)) {
    return t('当前模型不受支持，请更换模型。', 'This model is not supported. Choose another model.')
  }
  if (
    /ECONNREFUSED|ECONNRESET|ENOTFOUND|ETIMEDOUT|network is unreachable|connection refused|\bconnection error\b|fetch failed|dial tcp/i
      .test(message)
  ) {
    return t('模型或 Agent 网络连接失败。', 'Model or Agent network connection failed.')
  }
  return message
}

function missingPiSession(value: unknown) {
  return /PI session not found|PI Sidecar is not running/i.test(String(value ?? ''))
}

export function agentRuntimeErrorMessage(value: unknown) {
  const raw = String(value ?? '')
  const detail = agentProviderErrorDetail(value)
  const normalized = agentErrorMessage(value)
  if (new RegExp(`${t('具体路径', 'explicit path')}|explicit path|${t('可解析的具体路径', 'a resolvable explicit path')}`, 'i').test(raw)) {
    return t('请提供具体目录路径，例如 ~/code/project。', 'Provide a specific directory path, such as ~/code/project.')
  }
  if (new RegExp(`filesystem root|whole user directory|${t('整个用户目录', 'whole user directory')}|${t('磁盘根目录', 'disk root')}`, 'i').test(raw)) {
    return t('不能授权整个磁盘或用户主目录。', 'The whole disk or home directory cannot be authorized.')
  }
  if (new RegExp(`must have a primary workspace|${t('还没有工作区', 'no workspace yet')}`, 'i').test(raw)) {
    return t('当前会话没有工作区。', 'This conversation has no workspace.')
  }
  if (/CTF Agent directory scope/i.test(raw)) {
    return t('CTF 会话不能扩大 Coding 目录权限。', 'A CTF session cannot expand Coding directory permissions.')
  }
  if (new RegExp(`project access is (?:not|no longer) authorized|${t('目录权限', 'directory permission')}.*(?:${t('未授权', 'unauthorized')}|${t('已撤销', 'revoked')})`, 'i').test(raw)) {
    return t('当前会话没有这个目录的权限。', 'This conversation does not have access to that directory.')
  }
  if (/supports at most 8 additional project directories|limited to 8 additional directories/i.test(raw)) {
    return t('额外目录最多 8 个。', 'At most 8 extra directories are allowed.')
  }
  if (/resolve Coding Agent project|open Coding Agent project|project must be a directory/i.test(raw)) {
    return t('无法打开该目录。', 'Could not open that directory.')
  }
  if (/Access to this API has been restricted|--allow-fs-(?:read|write)|ERR_ACCESS_DENIED/i.test(raw)) {
    return t('本地 Agent 权限组件启动失败，请重试。', 'The local Agent permission component failed to start. Try again.')
  }
  if (
    /both model sources are unavailable|enable the personal API key|add a personal API key|connect the beta account quota/i
      .test(raw)
  ) {
    return t('当前模型没有可用凭据。', 'No credentials are available for the current model.')
  }
  if (/model provider .* is not supported|provider .* is not supported by the local Agent runtime/i.test(raw)) {
    return t('当前默认模型不可用，请在设置中选择可用模型。', 'The current default model is unavailable. Choose an available model in Settings.')
  }
  const modelService = explainModelServiceError(value)
  if (modelService) return modelService
  if (new RegExp(t('运行时正在启动', 'Runtime is starting'), 'i').test(raw)) {
    return t('运行时正在启动，请稍候。', 'Runtime is starting. Please wait.')
  }
  if (new RegExp(t('正在恢复运行时', 'Restoring runtime'), 'i').test(raw)) {
    return t('正在恢复运行时。', 'Restoring runtime.')
  }
  if (new RegExp(`Go runtime is unavailable|${t('本地运行时已停止', 'The local runtime has stopped')}|${t('本地运行时不可用', 'The local runtime is unavailable')}`, 'i').test(raw)) {
    return t('本地运行时已停止，请重新打开应用。', 'The local runtime has stopped. Reopen the app.')
  }
  if (/Sidecar for this workspace stopped/i.test(raw)) {
    return t('这个项目的 Agent 进程已停止，本轮已中断。', 'The Agent process for this project stopped, so this turn was interrupted.')
  }
  if (/\b401\b|unauthori[sz]ed|invalid api key|authentication failed/i.test(raw)) {
    return t('模型凭据无效或无权访问。', 'Model credentials are invalid or unauthorized.')
  }
  if (/baseUrl.*required|required.*baseUrl/i.test(raw)) {
    return t('模型连接未就绪，请刷新配置后重试。', 'The model connection is not ready. Refresh the configuration and try again.')
  }
  // Overflow is normally recovered by Pi auto-compaction. This text is only a
  // fallback if a rare path still surfaces the provider error to chat.
  if (
    new RegExp(
      `context overflow recovery failed|auto-compaction failed|context_length_exceeded|maximum context length|exceeds the context window|prompt is too long|token limit exceeded|too many tokens|${t('上下文', 'context')}(?:${t('窗口', 'window')}|${t('过长', 'too long')}|${t('长度', 'length')}|${t('已满', 'full')})`,
      'i',
    )
      .test(raw)
  ) {
    if (new RegExp(`recovery failed|auto-compaction failed|${t('整理失败', 'compaction failed')}|${t('压缩失败', 'compression failed')}`, 'i').test(raw)) {
      return t('自动整理上下文失败，请手动整理后再继续。', 'Automatic context compaction failed. Compact manually, then continue.')
    }
    return t('上下文过长，正在自动整理…', 'Context is too long. Compacting automatically…')
  }
  if (/Subagent yield requires cwd or worktreeId|Subagent yield must be an object|Subagent yield is missing |Read-only subagent yield/i.test(raw)) {
    return t('子任务结果不完整，本轮已停止。', 'The subtask result was incomplete, so this turn stopped.')
  }
  if (new RegExp(`abort(?:ed)?|cancel(?:led|ed)|interrupted|context canceled|${t('用户已中断', 'Interrupted by the user')}|${t('用户取消', 'Cancelled by the user')}`, 'i').test(raw)) {
    return t('本轮已停止。', 'This turn was stopped.')
  }
  if (
    /no API key is configured|No API key for|Model not found|ECONNREFUSED|ECONNRESET|ENOTFOUND|ETIMEDOUT|network is unreachable|connection refused|\bconnection error\b|fetch failed|dial tcp/i
      .test(raw)
  ) {
    return normalized
  }

  // Prefer the concrete redacted detail whenever it is not an internal stack dump.
  const candidate = detail || normalized
  if (candidate && !isInternalAgentStack(candidate) && !isInternalAgentStack(raw)) {
    return candidate.length > 480 ? `${candidate.slice(0, 477)}…` : candidate
  }
  // Internal stack / empty detail only: keep a short recovery hint.
  return t('本地 Agent 运行异常，请重试。', 'The local Agent hit a runtime error. Try again.')
}

export function agentEngineErrorBubble(error: unknown) {
  const detail = agentRuntimeErrorMessage(error)
  const stopped = t('本轮已停止。', 'This turn was stopped.')
  if (detail === stopped) {
    return {
      content: stopped,
      approvalReason: t('本轮已停止，本次审批已失效', 'This turn was stopped, so this approval is no longer valid'),
      stopped: true,
    }
  }
  return {
    content: t(`Agent 运行失败：${detail}`, `Agent failed: ${detail}`),
    approvalReason: t('Agent 运行失败，本次审批已失效', 'Agent failed, so this approval is no longer valid'),
    stopped: false,
  }
}

export function agentToolResultMessage(text: string, error?: string) {
  const raw = String(error ?? '').trim()
  if (!raw) return redactProviderCredentials(text)
  if (
    /Access to this API has been restricted|--allow-fs-(?:read|write)|ERR_ACCESS_DENIED|\b401\b|unauthori[sz]ed|invalid api key|authentication failed|baseUrl.*required|required.*baseUrl|node:internal|bridge\.js|Cannot find module|Uncaught Exception/i
      .test(raw)
  ) {
    return agentRuntimeErrorMessage(raw)
  }
  return redactProviderCredentials(text || raw) || t('工具执行失败。', 'Tool execution failed.')
}

export function projectCodingAbortRequest(
  running: ReadonlySet<string>,
  aborting: ReadonlySet<string>,
  id: string,
) {
  if (!running.has(id) || aborting.has(id)) {
    return { running: new Set(running), aborting: new Set(aborting), accepted: false }
  }
  return {
    running: new Set(running),
    aborting: new Set(aborting).add(id),
    accepted: true,
  }
}

const turnActivityEventTypes = new Set([
  'assistant.delta',
  'assistant.thinking_started',
  'assistant.thinking_delta',
  'assistant.thinking_completed',
  'assistant.segment_completed',
  'tool.started',
  'tool.completed',
  'tool.progress',
  'approval.requested',
  'approval.resolved',
])

// Any in-turn event proves the engine still owns this session. The running marker
// must be recoverable from those events, not only from assistant.started, otherwise
// one cleared marker hides the rest of a long turn.
export function isTurnActivityEvent(type: string) {
  return turnActivityEventTypes.has(type)
}

// A session-less engine stop only proves that one engine instance went away. Scope
// the damage to the conversations that instance served, and include sessions whose
// messages still show a running turn even when the running marker was already lost
// (otherwise that turn dies silently).
export function projectEngineStopAffected(
  conversations: readonly Conversation[],
  running: ReadonlySet<string>,
  kernel: string,
) {
  return conversations
    .filter(conversation => (
      (conversation.kernel ?? 'pi') === kernel
      && (running.has(conversation.id) || hasIdleRunResidue(conversation.messages))
    ))
    .map(conversation => conversation.id)
}

export function projectCodingRunFinished(
  running: ReadonlySet<string>,
  aborting: ReadonlySet<string>,
  id: string,
) {
  const nextRunning = new Set(running)
  nextRunning.delete(id)
  const nextAborting = new Set(aborting)
  nextAborting.delete(id)
  return { running: nextRunning, aborting: nextAborting }
}


type ConversationsState = {
  conversations: Conversation[]
  activeId: string | null
  pendingWorkspacePath: string
  pendingWorkspaceHome: WorkspaceHome
  pendingKernel: AgentKernel
  pendingModelMode: 'auto' | 'manual' | undefined
  pendingModelProvider: string | undefined
  pendingModelId: string | undefined
  pendingThinkingLevel: ModelThinkingLevel | undefined
  pendingModelSourcePreference: 'auto' | 'account' | 'personal'
  pendingExecutionMode: CodingExecutionMode
  pendingApprovalPolicy: CodingApprovalPolicy
  pendingMCPServers: string[]
  pendingMCPConfigDigest: string
  runningIds: Set<string>
  abortingIds: Set<string>
  messageQueues: Map<string, CodingMessageQueue>
  engineNotice: string
  engineNoticeRepeat: number
  engineNoticeAt: number
  abortStalledIds: Set<string>
  stalledQueueIds: Set<string>
  continuity: CodingContinuityState
  turnStatusById: Map<string, SessionTurnSnapshot>
  conversationActionError: string
  pendingComposerDraft: PendingComposerDraft | null
}

export function createConversationsRuntime(options?: { live?: boolean }) {
  const store = createStore<ConversationsState>({
    conversations: [],
    activeId: null,
    pendingWorkspacePath: '',
    pendingWorkspaceHome: 'chat',
    pendingKernel: 'pi',
    pendingModelMode: undefined,
    pendingModelProvider: undefined,
    pendingModelId: undefined,
    pendingThinkingLevel: undefined,
    pendingModelSourcePreference: 'auto',
    pendingExecutionMode: DEFAULT_CODING_EXECUTION_MODE,
    pendingApprovalPolicy: DEFAULT_CODING_APPROVAL_POLICY,
    pendingMCPServers: [],
    pendingMCPConfigDigest: '',
    runningIds: new Set<string>(),
    abortingIds: new Set<string>(),
    messageQueues: new Map<string, CodingMessageQueue>(),
    engineNotice: '',
    engineNoticeRepeat: 0,
    engineNoticeAt: 0,
    abortStalledIds: new Set<string>(),
    stalledQueueIds: new Set<string>(),
    continuity: createCodingContinuityState(),
    turnStatusById: new Map<string, SessionTurnSnapshot>(),
    conversationActionError: '',
    pendingComposerDraft: null,
  })
  const s = {
    get conversations() { return store.getState().conversations },
    set conversations(value) { store.setState({ conversations: value }) },
    get activeId() { return store.getState().activeId },
    set activeId(value) { store.setState({ activeId: value }) },
    get pendingWorkspacePath() { return store.getState().pendingWorkspacePath },
    set pendingWorkspacePath(value) { store.setState({ pendingWorkspacePath: value }) },
    get pendingWorkspaceHome() { return store.getState().pendingWorkspaceHome },
    set pendingWorkspaceHome(value) { store.setState({ pendingWorkspaceHome: value }) },
    get pendingKernel() { return store.getState().pendingKernel },
    set pendingKernel(value) { store.setState({ pendingKernel: value }) },
    get pendingModelMode() { return store.getState().pendingModelMode },
    set pendingModelMode(value) { store.setState({ pendingModelMode: value }) },
    get pendingModelProvider() { return store.getState().pendingModelProvider },
    set pendingModelProvider(value) { store.setState({ pendingModelProvider: value }) },
    get pendingModelId() { return store.getState().pendingModelId },
    set pendingModelId(value) { store.setState({ pendingModelId: value }) },
    get pendingThinkingLevel() { return store.getState().pendingThinkingLevel },
    set pendingThinkingLevel(value) { store.setState({ pendingThinkingLevel: value }) },
    get pendingModelSourcePreference() { return store.getState().pendingModelSourcePreference },
    set pendingModelSourcePreference(value) { store.setState({ pendingModelSourcePreference: value }) },
    get pendingExecutionMode() { return store.getState().pendingExecutionMode },
    set pendingExecutionMode(value) { store.setState({ pendingExecutionMode: value }) },
    get pendingApprovalPolicy() { return store.getState().pendingApprovalPolicy },
    set pendingApprovalPolicy(value) { store.setState({ pendingApprovalPolicy: value }) },
    get pendingMCPServers() { return store.getState().pendingMCPServers },
    set pendingMCPServers(value) { store.setState({ pendingMCPServers: value }) },
    get pendingMCPConfigDigest() { return store.getState().pendingMCPConfigDigest },
    set pendingMCPConfigDigest(value) { store.setState({ pendingMCPConfigDigest: value }) },
    get runningIds() { return store.getState().runningIds },
    set runningIds(value) { store.setState({ runningIds: value }) },
    get abortingIds() { return store.getState().abortingIds },
    set abortingIds(value) { store.setState({ abortingIds: value }) },
    get messageQueues() { return store.getState().messageQueues },
    set messageQueues(value) { store.setState({ messageQueues: value }) },
    get engineNotice() { return store.getState().engineNotice },
    set engineNotice(value) { store.setState({ engineNotice: value }) },
    get engineNoticeRepeat() { return store.getState().engineNoticeRepeat },
    set engineNoticeRepeat(value) { store.setState({ engineNoticeRepeat: value }) },
    get engineNoticeAt() { return store.getState().engineNoticeAt },
    set engineNoticeAt(value) { store.setState({ engineNoticeAt: value }) },
    get abortStalledIds() { return store.getState().abortStalledIds },
    set abortStalledIds(value) { store.setState({ abortStalledIds: value }) },
    get stalledQueueIds() { return store.getState().stalledQueueIds },
    set stalledQueueIds(value) { store.setState({ stalledQueueIds: value }) },
    get continuity() { return store.getState().continuity },
    set continuity(value) { store.setState({ continuity: value }) },
    get turnStatusById() { return store.getState().turnStatusById },
    set turnStatusById(value) { store.setState({ turnStatusById: value }) },
    get conversationActionError() { return store.getState().conversationActionError },
    set conversationActionError(value) { store.setState({ conversationActionError: value }) },
    get pendingComposerDraft() { return store.getState().pendingComposerDraft },
    set pendingComposerDraft(value) { store.setState({ pendingComposerDraft: value }) },
  }

  // A short-lived engine status line (idle reclaim, blocked deletions and friends). It is
  // deliberately not part of any conversation's messages.
  // How many times the current notice was repeated, so a burst is one line with a count
  // instead of a screenful of identical lines.
  function pushEngineNotice(text: string) {
    const notice = String(text ?? '').trim()
    if (!notice) return
    const now = Date.now()
    if (s.engineNotice === notice && now - s.engineNoticeAt < 30_000) {
      s.engineNoticeRepeat += 1
    } else {
      s.engineNotice = notice
      s.engineNoticeRepeat = 1
    }
    s.engineNoticeAt = now
  }
  const abortWatchdogs = new Map<string, number>()
  const ABORT_CONFIRM_TIMEOUT_MS = 10_000

  function clearAbortWatchdog(id: string) {
    const timer = abortWatchdogs.get(id)
    if (timer === undefined) return
    window.clearTimeout(timer)
    abortWatchdogs.delete(id)
  }

  function clearAbortStalled(id: string) {
    clearAbortWatchdog(id)
    if (!s.abortStalledIds.has(id)) return
    const next = new Set(s.abortStalledIds)
    next.delete(id)
    s.abortStalledIds = next
  }

  // AbortMessage only submits the interrupt to the Sidecar. If the engine never
  // answers with a terminal event, release the stop button after a bounded wait
  // so the user can try again instead of staring at a disabled control.
  function armAbortWatchdog(id: string) {
    clearAbortWatchdog(id)
    const timer = window.setTimeout(() => {
      abortWatchdogs.delete(id)
      if (!s.runningIds.has(id)) return
      const stalled = new Set(s.abortStalledIds)
      stalled.add(id)
      s.abortStalledIds = stalled
      if (!s.abortingIds.has(id)) return
      const aborting = new Set(s.abortingIds)
      aborting.delete(id)
      s.abortingIds = aborting
    }, ABORT_CONFIRM_TIMEOUT_MS)
    abortWatchdogs.set(id, timer)
  }

  function markQueueStalled(id: string, stalled: boolean) {
    if (s.stalledQueueIds.has(id) === stalled) return
    const next = new Set(s.stalledQueueIds)
    if (stalled) next.add(id)
    else next.delete(id)
    s.stalledQueueIds = next
  }
  const compactionErrorTimers = new Map<string, ReturnType<typeof setTimeout>>()

  function dismissCompactionErrorLater(sessionId: string) {
    armCompactionErrorDismiss(compactionErrorTimers, sessionId, id => {
      s.continuity = clearCodingContinuityError(s.continuity, id)
    })
  }

  /** Per-session last usage + run clock; not persisted (session-scoped projection). */
  const active = (() => s.conversations.find(item => item.id === s.activeId) ?? null)
  const workspacePath = (() => active()?.workspacePath ?? s.pendingWorkspacePath)
  const activeRunning = (() => (
    s.activeId ? s.runningIds.has(s.activeId) : false
  ))
  const runningConversationIds = (() => [...s.runningIds])
  const activeAborting = (() => (
    s.activeId ? s.abortingIds.has(s.activeId) : false
  ))
  const activeAbortStalled = (() => (
    s.activeId ? s.abortStalledIds.has(s.activeId) : false
  ))
  const activeMessageQueue = (() => {
    const empty: CodingMessageQueue = { steering: [], followUp: [] }
    if (!s.activeId) return empty
    const queue = s.messageQueues.get(s.activeId) ?? empty
    return s.stalledQueueIds.has(s.activeId) ? { ...queue, stalled: true } : queue
  })
  const activeQueuedGuidanceStalled = (() => (
    s.activeId ? s.stalledQueueIds.has(s.activeId) : false
  ))
  const activeResumed = (() => (
    s.activeId ? s.continuity.resumed.has(s.activeId) : false
  ))
  const activeSessionReady = (() => (
    s.activeId ? s.continuity.ready.has(s.activeId) : false
  ))
  const activeCompacting = (() => (
    s.activeId ? s.continuity.compacting.has(s.activeId) : false
  ))
  const activeCompactedAt = (() => (
    s.activeId ? s.continuity.compactedAt.get(s.activeId) : undefined
  ))
  const activeCompactionError = (() => (
    s.activeId ? s.continuity.errors.get(s.activeId) : undefined
  ))
  const activeTurnStatus = (() => {
    if (!s.activeId) return emptySessionTurnSnapshot()
    const base = s.turnStatusById.get(s.activeId) ?? emptySessionTurnSnapshot()
    // Keep compacting flag aligned with continuity without double-storing it.
    return applySessionCompacting(base, activeCompacting())
  })

  function patchTurnStatus(
    sessionId: string,
    updater: (state: SessionTurnSnapshot) => SessionTurnSnapshot,
  ) {
    const previous = s.turnStatusById.get(sessionId) ?? emptySessionTurnSnapshot()
    const next = updater(previous)
    if (next === previous) return
    const map = new Map(s.turnStatusById)
    map.set(sessionId, next)
    s.turnStatusById = map
  }

  function clearTurnRunClock(sessionId: string) {
    patchTurnStatus(sessionId, applySessionRunFinished)
  }
  const selectedKernel = (() => {
    const current = active()
    return current ? normalizeAgentKernel(current.kernel) : s.pendingKernel
  })
  const selectedModelMode = (() => active()?.modelMode ?? s.pendingModelMode)
  const selectedModelProvider = (() => active()?.modelProvider ?? s.pendingModelProvider)
  const selectedModelId = (() => active()?.modelId ?? s.pendingModelId)
  const selectedThinkingLevel = (() => (
    active()?.thinkingLevel ?? s.pendingThinkingLevel
  ))
  const selectedModelSourcePreference = (() => (
    active()?.modelSourcePreference ?? s.pendingModelSourcePreference
  ))
  const selectedExecutionMode = (() => (
    active()?.executionMode ?? s.pendingExecutionMode
  ))
  const selectedApprovalPolicy = (() => (
    active()?.approvalPolicy ?? s.pendingApprovalPolicy
  ))
  const selectedMCPServers = (() => (
    active()?.mcpServers ?? s.pendingMCPServers
  ))
  const selectedMCPConfigDigest = (() => (
    active()?.mcpConfigDigest ?? s.pendingMCPConfigDigest
  ))
  const saveTimers = new Map<string, number>()
  const activeTurnPolicies = new Set<string>()
  const titleGenerationAttemptedIds = new Set<string>()
  let disposeEvents: (() => void) | undefined

  function persist(conversation: Conversation) {
    void invokeCommand('save_conversation', { conversation }).catch(console.error)
  }

  function sessionContextUsageRecord(sessionId: string): Conversation['lastContextUsage'] {
    const snapshot = s.turnStatusById.get(sessionId)
    const stored = storedContextUsageFromSnapshot(snapshot ?? emptySessionTurnSnapshot())
    if (!stored) return undefined
    const conversation = s.conversations.find(item => item.id === sessionId)
    const modelId = stored.model || conversation?.modelId
    const contextWindow = resolveModelContextWindow(
      modelId,
      stored.contextWindow,
      modelContextWindowOverride(
        installedModelContextWindows(),
        stored.provider || conversation?.modelProvider,
        modelId,
      ),
    ) || stored.contextWindow
    return {
      ...stored,
      contextWindow: contextWindow || undefined,
    }
  }

  function persistSessionContextUsage(sessionId: string) {
    const lastContextUsage = sessionContextUsageRecord(sessionId)
    if (!lastContextUsage) return
    s.conversations = s.conversations.map(item => (
      item.id === sessionId ? { ...item, lastContextUsage } : item
    ))
    scheduleSave(sessionId)
  }

  function hydrateTurnStatus(conversation: Conversation): SessionTurnSnapshot | undefined {
    const snapshot = snapshotFromStoredContextUsage(conversation.lastContextUsage)
    if (!snapshot.usage && !snapshot.composition) return undefined
    const modelId = snapshot.usage?.model || conversation.modelId
    const contextWindow = resolveModelContextWindow(
      modelId,
      snapshot.contextWindow,
      modelContextWindowOverride(
        installedModelContextWindows(),
        snapshot.usage?.provider || conversation.modelProvider,
        modelId,
      ),
    ) || snapshot.contextWindow
    return applySessionContextWindow(snapshot, contextWindow)
  }

  function scheduleSave(conversationId: string) {
    const existingTimer = saveTimers.get(conversationId)
    if (existingTimer) window.clearTimeout(existingTimer)
    const timer = window.setTimeout(() => {
      saveTimers.delete(conversationId)
      const conversation = s.conversations.find(item => item.id === conversationId)
      if (conversation) persist(conversation)
    }, 400)
    saveTimers.set(conversationId, timer)
  }

  async function load() {
    const stored = await invokeCommand<Record<string, unknown>[]>('list_conversations')
    // The stored snapshot lags behind: message deltas persist on a 400ms debounce.
    // A reload triggered while another conversation streams must not roll it back,
    // so the disk decides which conversations exist and memory keeps their content.
    const loaded = new Map(s.conversations.map(conversation => [conversation.id, conversation]))
    s.conversations = stored.map(value => {
      const next = normalizeConversation(value)
      return loaded.get(next.id) ?? next
    })
    const next = new Map<string, SessionTurnSnapshot>()
    for (const conversation of s.conversations) {
      const live = s.turnStatusById.get(conversation.id)
      if (loaded.has(conversation.id) && live) {
        next.set(conversation.id, live)
        continue
      }
      const snapshot = hydrateTurnStatus(conversation)
      if (snapshot) next.set(conversation.id, snapshot)
    }
    s.turnStatusById = next
    await applyRememberedHomeProjectIfIdle()
  }

  function currentWorkspaceHome(): WorkspaceHome {
    return active()
      ? conversationWorkspaceHome(active())
      : s.pendingWorkspaceHome
  }

  async function applyRememberedHomeProjectIfIdle() {
    if (s.activeId || s.pendingWorkspaceHome !== 'chat' || s.pendingWorkspacePath) return
    try {
      const memory = await invokeCommand<CodingProjectMemory>('get_coding_project_memory')
      const last = memory.recents?.[0]?.path || memory.lastWorkspacePath || ''
      if (
        s.activeId
        || s.pendingWorkspaceHome !== 'chat'
        || s.pendingWorkspacePath
        || !shouldRememberCodingProject(last)
      ) return
      s.pendingWorkspacePath = last
    } catch {
      if (!s.pendingWorkspacePath) s.pendingWorkspacePath = ''
    }
  }

  function update(id: string, updater: (conversation: Conversation) => Conversation) {
    s.conversations = s.conversations.map(conversation => (
      conversation.id === id ? updater(conversation) : conversation
    ))
    const updated = s.conversations.find(conversation => conversation.id === id)
    if (updated) persist(updated)
  }

  function finishRun(id: string) {
    clearTurnRunClock(id)
    clearAbortStalled(id)
    const next = projectCodingRunFinished(
      s.runningIds,
      s.abortingIds,
      id,
    )
    s.runningIds = next.running
    s.abortingIds = next.aborting
  }

  const IDLE_RECONCILE_MS = 12_000

  function reconcileIdleConversation(conversationId: string) {
    if (!conversationId || s.runningIds.has(conversationId)) return
    const conversation = s.conversations.find(item => item.id === conversationId)
    if (!conversation || !hasIdleRunResidue(conversation.messages)) return
    update(conversationId, current => ({
      ...current,
      messages: settleRunningToolMessages(current.messages),
    }))
  }

  function reconcileIdleConversations() {
    for (const conversation of s.conversations) {
      reconcileIdleConversation(conversation.id)
    }
  }

  let lastActiveId = s.activeId
  const stopWatchActiveId = store.subscribe(() => {
    const id = s.activeId
    if (id === lastActiveId) return
    lastActiveId = id
    if (id) reconcileIdleConversation(id)
  })

  function onVisibilityChange() {
    if (document.visibilityState !== 'visible') return
    if (s.activeId) reconcileIdleConversation(s.activeId)
  }

  const ownsIdleReconcile = options?.live === true
  if (ownsIdleReconcile && typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibilityChange)
  }
  const idleReconcileTimer = ownsIdleReconcile && typeof window !== 'undefined'
    ? window.setInterval(reconcileIdleConversations, IDLE_RECONCILE_MS)
    : undefined

  async function invokeRuntimeTurn(
    conversationId: string,
    dispatch: RuntimeTurnDispatch,
  ) {
    const conversation = s.conversations.find(item => item.id === conversationId)
    if (!conversation) throw new Error('Coding conversation is unavailable')
    await invokeCommand('save_conversation', { conversation })
    await invokeCommand('send_message', {
      conversationId,
      prompt: dispatch.prompt,
      workspacePath: conversation.workspacePath ?? '',
      modelMode: conversation.modelMode ?? '',
      modelProvider: conversation.modelProvider ?? '',
      modelId: conversation.modelId ?? '',
      thinkingLevel: conversation.thinkingLevel ?? '',
      modelSourcePreference: conversation.modelSourcePreference ?? 'auto',
      executionMode: conversation.executionMode ?? DEFAULT_CODING_EXECUTION_MODE,
      approvalPolicy: conversation.approvalPolicy ?? DEFAULT_CODING_APPROVAL_POLICY,
      mcpServers: turnMCPServers(conversation.mcpServers, dispatch.scopeToken),
      mcpConfigDigest: conversation.mcpConfigDigest ?? '',
      attachments: dispatch.attachments,
      productAction: dispatch.productAction,
      branchFromUserOccurrence: dispatch.branchFromUserOccurrence,
    })
  }

  function setMessageQueue(id: string, queue: CodingMessageQueue) {
    const next = new Map(s.messageQueues)
    if (queue.steering.length || queue.followUp.length) next.set(id, queue)
    else next.delete(id)
    s.messageQueues = next
  }

  // The sidebar confirmation dialog renders this and stays open on failure, the
  // same way the archived-chat settings panel reports its own errors.

  async function archive(id: string) {
    await runConversationAction(t('归档', 'Archive'), 'archive_conversation', id)
  }

  async function remove(id: string) {
    await runConversationAction(t('删除', 'Delete'), 'delete_conversation', id)
  }

  async function runConversationAction(action: string, command: string, id: string) {
    s.conversationActionError = ''
    try {
      await invokeCommand(command, { id })
    } catch (cause) {
      const causeText = cause instanceof Error ? cause.message : String(cause)
      s.conversationActionError = t(`${action}失败：${causeText}`, `${action} failed: ${causeText}`)
      return
    }
    discard(id)
  }

  function discard(id: string) {
    s.conversations = s.conversations.filter(conversation => conversation.id !== id)
    titleGenerationAttemptedIds.delete(id)
    s.continuity = removeCodingContinuitySession(s.continuity, id)
    activeTurnPolicies.delete(id)
    setMessageQueue(id, { steering: [], followUp: [] })
    finishRun(id)
    if (s.turnStatusById.has(id)) {
      const next = new Map(s.turnStatusById)
      next.delete(id)
      s.turnStatusById = next
    }
    if (s.activeId === id) s.activeId = null
  }

  function comparePinnedConversations(left: Conversation, right: Conversation) {
    return (
      (left.pinnedOrder ?? Number.MAX_SAFE_INTEGER) - (right.pinnedOrder ?? Number.MAX_SAFE_INTEGER)
      || left.createdAt - right.createdAt
    )
  }

  function applyPinnedOrder(ordered: Conversation[]) {
    const nextOrder = new Map(ordered.map((conversation, index) => [conversation.id, index]))
    s.conversations = s.conversations.map(conversation => {
      const order = nextOrder.get(conversation.id)
      return order === undefined ? conversation : { ...conversation, pinned: true, pinnedOrder: order }
    })
    for (const conversation of ordered) {
      const updated = s.conversations.find(item => item.id === conversation.id)
      if (updated) persist(updated)
    }
  }

  function setConversationPinned(id: string, pinned: boolean) {
    const existing = s.conversations.filter(conversation => (
      conversation.pinned && conversation.id !== id
    )).sort(comparePinnedConversations)
    update(id, conversation => pinned
      ? { ...conversation, pinned: true, pinnedOrder: existing.length }
      : { ...conversation, pinned: undefined, pinnedOrder: undefined })
  }

  function movePinnedConversation(id: string, direction: -1 | 1) {
    const pinned = s.conversations
      .filter(conversation => conversation.pinned)
      .sort(comparePinnedConversations)
    const index = pinned.findIndex(conversation => conversation.id === id)
    const target = index + direction
    if (index < 0 || target < 0 || target >= pinned.length) return
    const reordered = [...pinned]
    const [moved] = reordered.splice(index, 1)
    if (!moved) return
    reordered.splice(target, 0, moved)
    applyPinnedOrder(reordered)
  }

  function reorderPinnedConversation(id: string, beforeId: string) {
    if (id === beforeId) return
    const pinned = s.conversations
      .filter(conversation => conversation.pinned)
      .sort(comparePinnedConversations)
    const source = pinned.find(conversation => conversation.id === id)
    if (!source) return
    const reordered = pinned.filter(conversation => conversation.id !== id)
    const target = reordered.findIndex(conversation => conversation.id === beforeId)
    if (target < 0) return
    reordered.splice(target, 0, source)
    applyPinnedOrder(reordered)
  }

  function rename(id: string, title: string) {
    const normalized = title.trim().slice(0, 40)
    if (!normalized) return
    update(id, conversation => ({
      ...conversation,
      title: normalized,
      domainTaskContext: conversation.domainTaskContext?.kind === 'lab'
        ? { ...conversation.domainTaskContext, title: normalized }
        : conversation.domainTaskContext,
    }))
  }


  function stageComposerDraft(prompt: string, visibleText = prompt) {
    const nextPrompt = String(prompt ?? '').trim()
    if (!nextPrompt) {
      s.pendingComposerDraft = null
      return
    }
    s.pendingComposerDraft = {
      prompt: nextPrompt,
      visibleText: String(visibleText ?? '').trim() || nextPrompt,
    }
  }

  function consumeComposerDraft() {
    const draft = s.pendingComposerDraft
    s.pendingComposerDraft = null
    return draft
  }

  function startNew(options: { workspaceHome?: WorkspaceHome } = {}) {
    const nextHome = options.workspaceHome ?? 'chat'
    const previousHome = currentWorkspaceHome()
    const currentWorkspace = active()?.workspacePath || s.pendingWorkspacePath
    const inheritHomeProject = nextHome === 'chat'
      && previousHome === 'chat'
      && shouldRememberCodingProject(currentWorkspace)
    s.activeId = null
    s.pendingWorkspaceHome = nextHome
    s.pendingWorkspacePath = inheritHomeProject ? String(currentWorkspace) : ''
    s.pendingKernel = 'pi'
    s.pendingModelMode = undefined
    s.pendingModelProvider = undefined
    s.pendingModelId = undefined
    s.pendingThinkingLevel = undefined
    s.pendingModelSourcePreference = 'auto'
    s.pendingExecutionMode = DEFAULT_CODING_EXECUTION_MODE
    s.pendingApprovalPolicy = DEFAULT_CODING_APPROVAL_POLICY
    s.pendingMCPServers = []
    s.pendingMCPConfigDigest = ''
    s.pendingComposerDraft = null
    if (nextHome === 'chat' && !inheritHomeProject) void applyRememberedHomeProjectIfIdle()
  }

  function ensureConversation(
    title = DEFAULT_CODING_CONVERSATION_TITLE,
    options: {
      domainTaskContext?: Conversation['domainTaskContext']
      conversationId?: string
      workspacePath?: string
      workspaceHome?: Conversation['workspaceHome']
      ctfJobId?: Conversation['ctfJobId']
      ctfMode?: Conversation['ctfMode']
      ctfRole?: Conversation['ctfRole']
    } = {},
  ) {
    const requestedId = String(options.conversationId ?? '').trim()
    const hasWorkspaceOverride = Object.prototype.hasOwnProperty.call(options, 'workspacePath')
    const workspaceOverride = String(options.workspacePath ?? '').trim() || undefined
    const clearsCTFContext = options.domainTaskContext?.kind === 'cve'
      || options.domainTaskContext?.kind === 'lab'
    if (requestedId) {
      const existing = s.conversations.find(item => item.id === requestedId)
      if (existing) {
        s.activeId = existing.id
        update(existing.id, conversation => ({
          ...conversation,
          title: title.trim().slice(0, 40) || conversation.title,
          workspacePath: hasWorkspaceOverride ? workspaceOverride : conversation.workspacePath,
          domainTaskContext: options.domainTaskContext ?? conversation.domainTaskContext,
          ctfJobId: clearsCTFContext ? undefined : (options.ctfJobId ?? conversation.ctfJobId),
          ctfMode: clearsCTFContext ? undefined : (options.ctfMode ?? conversation.ctfMode),
          ctfRole: clearsCTFContext ? undefined : (options.ctfRole ?? conversation.ctfRole),
        }))
        return existing.id
      }
    }
    if (s.activeId && !requestedId) {
      if (options.domainTaskContext) {
        update(s.activeId, conversation => ({
          ...conversation,
          domainTaskContext: options.domainTaskContext,
        }))
      }
      return s.activeId
    }
    const conversationId = requestedId || crypto.randomUUID()
    const conversation: Conversation = {
      id: conversationId,
      title: title.trim().slice(0, 40) || DEFAULT_CODING_CONVERSATION_TITLE,
      createdAt: Date.now(),
      workspacePath: hasWorkspaceOverride
        ? workspaceOverride
        : s.pendingWorkspacePath || undefined,
      kernel: s.pendingKernel,
      modelMode: s.pendingModelMode,
      modelProvider: s.pendingModelProvider,
      modelId: s.pendingModelId,
      thinkingLevel: s.pendingThinkingLevel,
      modelSourcePreference: s.pendingModelSourcePreference === 'auto'
        ? undefined
        : s.pendingModelSourcePreference,
      executionMode: s.pendingExecutionMode,
      approvalPolicy: s.pendingApprovalPolicy,
      mcpServers: s.pendingMCPServers.length ? s.pendingMCPServers : undefined,
      mcpConfigDigest: s.pendingMCPServers.length
        ? s.pendingMCPConfigDigest
        : undefined,
      domainTaskContext: options.domainTaskContext,
      ctfJobId: clearsCTFContext ? undefined : options.ctfJobId,
      ctfMode: clearsCTFContext ? undefined : options.ctfMode,
      ctfRole: clearsCTFContext ? undefined : options.ctfRole,
      messages: [],
    }
    s.conversations = [conversation, ...s.conversations]
    s.activeId = conversationId
    persist(conversation)
    return conversationId
  }

  function setWorkspace(path: string) {
    const normalized = path.trim()
    if (!normalized) return
    if (!s.activeId) {
      s.pendingWorkspacePath = normalized
      s.pendingMCPServers = []
      s.pendingMCPConfigDigest = ''
    } else {
      update(s.activeId, conversation => ({
        ...conversation,
        workspacePath: normalized,
        mcpServers: undefined,
        mcpConfigDigest: undefined,
      }))
    }
    if (currentWorkspaceHome() === 'chat' && shouldRememberCodingProject(normalized)) {
      void invokeCommand('remember_coding_project', { path: normalized }).catch(() => undefined)
    }
  }

  function clearWorkspace() {
    if (!s.activeId) {
      s.pendingWorkspacePath = ''
      s.pendingMCPServers = []
      s.pendingMCPConfigDigest = ''
      return
    }
    update(s.activeId, conversation => ({
      ...conversation,
      workspacePath: undefined,
      mcpServers: undefined,
      mcpConfigDigest: undefined,
    }))
  }

  function setKernel(kernel: AgentKernel) {
    const next = normalizeAgentKernel(kernel)
    if (!s.activeId) {
      s.pendingKernel = next
      return
    }
    const current = s.conversations.find(item => item.id === s.activeId)
    if (current && conversationKernelLocked(current.messages)) return
    update(s.activeId, conversation => ({ ...conversation, kernel: next }))
  }

  function setModelSelection(
    mode: 'auto' | 'manual',
    provider?: string,
    model?: string,
  ) {
    const normalizedProvider = provider?.trim() || undefined
    const normalizedModel = model?.trim() || undefined
    if (!s.activeId) {
      const changed = s.pendingModelMode !== mode
        || s.pendingModelProvider !== normalizedProvider
        || s.pendingModelId !== normalizedModel
      s.pendingModelMode = mode
      s.pendingModelProvider = mode === 'manual' ? normalizedProvider : undefined
      s.pendingModelId = mode === 'manual' ? normalizedModel : undefined
      if (changed) s.pendingThinkingLevel = undefined
      return
    }
    update(s.activeId, conversation => ({
      ...conversation,
      modelMode: mode,
      modelProvider: mode === 'manual' ? normalizedProvider : undefined,
      modelId: mode === 'manual' ? normalizedModel : undefined,
      thinkingLevel: conversation.modelMode !== mode
        || conversation.modelProvider !== normalizedProvider
        || conversation.modelId !== normalizedModel
        ? undefined
        : conversation.thinkingLevel,
    }))
  }

  function setThinkingLevel(level: ModelThinkingLevel) {
    if (!MODEL_THINKING_LEVELS.includes(level)) return
    if (!s.activeId) {
      s.pendingThinkingLevel = level
      return
    }
    update(s.activeId, conversation => ({ ...conversation, thinkingLevel: level }))
  }

  function setModelSourcePreference(preference: 'auto' | 'account' | 'personal') {
    if (!s.activeId) {
      s.pendingModelSourcePreference = preference
      return
    }
    if (!s.activeId) return
    update(s.activeId, conversation => ({
      ...conversation,
      modelSourcePreference: preference === 'auto' ? undefined : preference,
    }))
  }

  function setCodingPolicy(
    executionMode: CodingExecutionMode,
    approvalPolicy: CodingApprovalPolicy,
  ) {
    if (!s.activeId) {
      s.pendingExecutionMode = executionMode
      s.pendingApprovalPolicy = approvalPolicy
      return
    }
    update(s.activeId, conversation => ({
      ...conversation,
      executionMode,
      approvalPolicy,
    }))
  }

  function setMCPSelection(servers: string[], configDigest: string) {
    const normalizedServers = normalizeMCPServers(servers) ?? []
    const normalizedDigest = /^[a-f0-9]{64}$/i.test(configDigest)
      ? configDigest.toLowerCase()
      : ''
    if (normalizedServers.length && !normalizedDigest) return
    if (!s.activeId) {
      s.pendingMCPServers = normalizedServers
      s.pendingMCPConfigDigest = normalizedServers.length ? normalizedDigest : ''
      return
    }
    update(s.activeId, conversation => ({
      ...conversation,
      mcpServers: normalizedServers.length ? normalizedServers : undefined,
      mcpConfigDigest: normalizedServers.length ? normalizedDigest : undefined,
    }))
  }

  async function startWorkspaceTask(task: WorkspaceTask) {
    const autoSend = task.autoSend === true
    const existing = s.conversations.find(item => item.id === task.conversationId)
    if (existing) {
      s.activeId = existing.id
      if (
        existing.workspacePath !== task.workspacePath
        || existing.title !== task.title
        || existing.ctfJobId !== task.jobId
        || existing.ctfMode !== task.policy.mode
        || existing.ctfRole !== task.role
        || task.domainTaskContext
      ) {
        update(existing.id, conversation => ({
          ...conversation,
          title: task.title,
          workspacePath: task.workspacePath,
          ctfJobId: task.jobId,
          ctfMode: task.policy.mode,
          ctfRole: task.role,
          domainTaskContext: task.domainTaskContext ?? conversation.domainTaskContext,
        }))
      }
      if (autoSend && !s.runningIds.has(existing.id)) {
        await send(task.prompt)
      }
      return
    }

    const conversation: Conversation = {
      id: task.conversationId,
      title: task.title,
      createdAt: Date.now(),
      workspacePath: task.workspacePath,
      kernel: s.pendingKernel,
      ctfJobId: task.jobId,
      ctfMode: task.policy.mode,
      ctfRole: task.role,
      domainTaskContext: task.domainTaskContext,
      messages: [],
    }
    s.conversations = [conversation, ...s.conversations]
    s.activeId = conversation.id
    s.pendingWorkspacePath = ''
    persist(conversation)
    if (autoSend) {
      await send(task.prompt)
    }
  }

  async function send(
    text: string,
    visibleText = text,
    attachments: CodingAttachment[] = [],
    scopeToken?: ComposerScopeToken,
    productAction?: CodingProductActionRequest,
    branchFromUserOccurrence = -1,
  ) {
    const prompt = text.trim()
    if (!prompt) return false
    const visiblePrompt = visibleText.trim() || prompt
    const runningConversationId = s.activeId
    const activeConversation = s.conversations.find(item => item.id === runningConversationId)
    const pendingAsk = pendingAskMessage(activeConversation?.messages)
    const answeringAsk = Boolean(pendingAsk?.approvalRequestId)
    const steering = Boolean(
      runningConversationId
      && s.runningIds.has(runningConversationId)
      && !answeringAsk,
    )
    if ((steering || answeringAsk) && attachments.length) return false
    const message: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: visiblePrompt,
      timestamp: Date.now(),
      status: steering ? 'queued' : undefined,
      attachments: attachments.length ? attachments : undefined,
    }
    const fallbackTitle = fallbackConversationTitle(visiblePrompt)
    let conversationId = s.activeId
    if (!conversationId) {
      conversationId = crypto.randomUUID()
      const conversation: Conversation = {
        id: conversationId,
        title: fallbackTitle,
        createdAt: Date.now(),
        workspacePath: s.pendingWorkspacePath || undefined,
        workspaceHome: s.pendingWorkspaceHome === 'chat' ? undefined : s.pendingWorkspaceHome,
        kernel: s.pendingKernel,
        modelMode: s.pendingModelMode,
        modelProvider: s.pendingModelProvider,
        modelId: s.pendingModelId,
        thinkingLevel: s.pendingThinkingLevel,
        modelSourcePreference: s.pendingModelSourcePreference === 'auto'
          ? undefined
          : s.pendingModelSourcePreference,
        executionMode: s.pendingExecutionMode,
        approvalPolicy: s.pendingApprovalPolicy,
        mcpServers: s.pendingMCPServers.length ? s.pendingMCPServers : undefined,
        mcpConfigDigest: s.pendingMCPServers.length
          ? s.pendingMCPConfigDigest
          : undefined,
        messages: [message],
      }
      s.conversations = [conversation, ...s.conversations]
      s.activeId = conversationId
      persist(conversation)
    } else {
      update(conversationId, conversation => ({
        ...conversation,
        title: conversation.title === DEFAULT_CODING_CONVERSATION_TITLE
          ? fallbackTitle
          : conversation.title,
        messages: [...conversation.messages, message],
      }))
    }

    if (answeringAsk && pendingAsk?.approvalRequestId) {
      await respondApproval(
        pendingAsk.approvalRequestId,
        true,
        'once',
        encodeAskOtherChoice(prompt),
      )
      return true
    }

    if (steering) {
      try {
        await invokeCommand('steer_message', {
          conversationId,
          prompt,
        })
        const currentQueue = s.messageQueues.get(conversationId)
          ?? { steering: [], followUp: [] }
        setMessageQueue(conversationId, projectCodingMessageQueue(
          [...currentQueue.steering, visiblePrompt],
          currentQueue.followUp,
        ))
        return true
      } catch (reason) {
        if (missingPiSession(reason)) {
          // The host process may have restarted after the renderer observed a
          // running turn. Treat that state as stale and recreate the same Pi
          // conversation through the normal send path instead of exposing a
          // dead session id or asking the user to repeat the message.
          finishRun(conversationId)
          setMessageQueue(conversationId, { steering: [], followUp: [] })
          update(conversationId, conversation => ({
            ...conversation,
            messages: conversation.messages.map(item => (
              item.id === message.id ? { ...item, status: undefined } : item
            )),
          }))
        } else {
          update(conversationId, conversation => ({
            ...conversation,
            messages: [...conversation.messages, {
              id: crypto.randomUUID(),
              role: 'assistant',
              content: t(`引导未加入当前回合：${agentErrorMessage(reason)}`, `Guidance was not added to this turn: ${agentErrorMessage(reason)}`),
              timestamp: Date.now(),
              status: 'done',
            }],
          }))
          return false
        }
      }
    }

    s.runningIds = new Set(s.runningIds).add(conversationId)
    patchTurnStatus(conversationId, state => applySessionRunStarted(state))
    try {
      let conversation = s.conversations.find(item => item.id === conversationId)
      if (conversation && !conversation.workspacePath) {
        // Save the structured CTF/CVE context before the backend chooses the
        // visible Coding or CVE artifact directory for this conversation.
        await invokeCommand('save_conversation', { conversation })
        const automaticWorkspace = await invokeCommand<string>(
          'ensure_coding_artifact_workspace',
          { conversationId },
        )
        if (automaticWorkspace) {
          update(conversationId, current => ({
            ...current,
            workspacePath: automaticWorkspace,
          }))
          conversation = s.conversations.find(item => item.id === conversationId)
        }
      }
      if (conversation) await invokeCommand('save_conversation', { conversation })
      const dispatch: RuntimeTurnDispatch = {
        prompt,
        attachments,
        scopeToken,
        productAction,
        branchFromUserOccurrence: branchFromUserOccurrence >= 0
          ? branchFromUserOccurrence
          : undefined,
      }
      await invokeRuntimeTurn(conversationId, dispatch)
      void generateConversationTitle(conversationId)
      return true
    } catch (reason) {
      finishRun(conversationId)
      update(conversationId, conversation => ({
        ...conversation,
        messages: [...conversation.messages, {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: t(`Agent 未启动：${agentRuntimeErrorMessage(reason)}`, `Agent did not start: ${agentRuntimeErrorMessage(reason)}`),
          timestamp: Date.now(),
          status: 'done',
        }],
      }))
      return false
    }
  }

  async function removeQueuedGuidance(index: number, edit: boolean) {
    const conversationId = s.activeId
    if (!conversationId || !Number.isInteger(index) || index < 0) return false
    const currentQueue = s.messageQueues.get(conversationId)
      ?? { steering: [], followUp: [] }
    const message = currentQueue.steering[index]
    if (!message) return false
    await invokeCommand('remove_queued_message', {
      conversationId,
      queue: 'steering',
      index,
      expected: message,
    })
    update(conversationId, conversation => {
      let queuedIndex = -1
      return {
        ...conversation,
        messages: conversation.messages.filter(item => {
          if (item.role !== 'user' || item.status !== 'queued') return true
          queuedIndex += 1
          return queuedIndex !== index
        }),
      }
    })
    setMessageQueue(conversationId, {
      ...currentQueue,
      steering: currentQueue.steering.filter((_item, itemIndex) => itemIndex !== index),
    })
    if (edit) stageComposerDraft(message, message)
    return true
  }

  function cancelQueuedGuidance(index: number) {
    return removeQueuedGuidance(index, false)
  }

  function editQueuedGuidance(index: number) {
    return removeQueuedGuidance(index, true)
  }

  async function generateConversationTitle(conversationId: string) {
    if (titleGenerationAttemptedIds.has(conversationId)) return
    const conversation = s.conversations.find(item => item.id === conversationId)
    if (
      !conversation
      || conversation.ctfJobId
    ) return
    const firstMessage = conversation.messages.find(message => message.role === 'user')?.content.trim()
    if (!firstMessage) return
    const fallbackTitle = fallbackConversationTitle(firstMessage)
    if (
      conversation.title !== DEFAULT_CODING_CONVERSATION_TITLE
      && conversation.title !== fallbackTitle
    ) return

    titleGenerationAttemptedIds.add(conversationId)
    try {
      const title = await invokeCommand<string>('generate_conversation_title', {
        firstMessage,
        modelMode: conversation.modelMode ?? '',
        modelProvider: conversation.modelProvider ?? '',
        modelId: conversation.modelId ?? '',
      })
      const current = s.conversations.find(item => item.id === conversationId)
      if (
        !current
        || (
          current.title !== DEFAULT_CODING_CONVERSATION_TITLE
          && current.title !== fallbackTitle
        )
        || !title.trim()
      ) return
      update(conversationId, value => ({
        ...value,
        title: title.trim(),
      }))
    } catch {
      // Naming is best effort. The primary Coding turn and its recovery state
      // must remain independent from this silent projection.
    }
  }

  async function editAndResend(messageId: string, content: string) {
    const conversation = active()
    if (!conversation) return false
    const index = conversation.messages.findIndex(item => (
      item.id === messageId && item.role === 'user'
    ))
    if (index < 0) return false
    const occurrence = conversation.messages
      .slice(0, index + 1)
      .filter(item => item.role === 'user' && item.status !== 'queued')
      .length - 1
    if (s.runningIds.has(conversation.id)) finishRun(conversation.id)
    update(conversation.id, current => ({
      ...current,
      messages: current.messages.slice(0, index),
    }))
    return send(content, content, [], undefined, undefined, Math.max(0, occurrence))
  }

  async function branchFromAssistant(messageId: string) {
    const conversation = active()
    if (!conversation) return false
    const index = conversation.messages.findIndex(item => (
      item.id === messageId && item.role === 'assistant'
    ))
    if (index < 0) return false
    const occurrence = conversation.messages
      .slice(0, index + 1)
      .filter(item => item.role === 'assistant')
      .length - 1
    let sessionId = ''
    try {
      sessionId = String(await invokeCommand('fork_conversation', {
        conversationId: conversation.id,
        role: 'assistant',
        occurrence: Math.max(0, occurrence),
      })).trim()
    } catch {
      return false
    }
    if (!sessionId) return false
    const firstUser = conversation.messages.find(item => item.role === 'user')
    const forked: Conversation = {
      ...conversation,
      id: sessionId,
      title: fallbackConversationTitle(firstUser?.content ?? conversation.title),
      createdAt: Date.now(),
      messages: conversation.messages.slice(0, index + 1).map(item => ({ ...item })),
    }
    s.conversations = [forked, ...s.conversations]
    s.activeId = sessionId
    persist(forked)
    return true
  }

  async function abort(id: string) {
    const compacting = s.continuity.compacting.has(id)
    const requested = projectCodingAbortRequest(
      s.runningIds,
      s.abortingIds,
      id,
    )
    if (!requested.accepted && !compacting) return
    if (requested.accepted) {
      s.runningIds = requested.running
      s.abortingIds = requested.aborting
      clearAbortStalled(id)
    }
    try {
      // AbortMessage only submits the interrupt to the Sidecar. Keep the task
      // visibly running until its terminal engine event proves Pi is idle.
      await invokeCommand('abort_message', { conversationId: id })
      if (requested.accepted) armAbortWatchdog(id)
    } catch (reason) {
      clearAbortWatchdog(id)
      clearAbortStalled(id)
      const nextAborting = new Set(s.abortingIds)
      nextAborting.delete(id)
      s.abortingIds = nextAborting
      update(id, conversation => ({
        ...conversation,
        messages: [...conversation.messages, {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: t(`停止 Agent 失败：${agentErrorMessage(reason)}`, `Failed to stop Agent: ${agentErrorMessage(reason)}`),
          timestamp: Date.now(),
          status: 'done',
        }],
      }))
    }
  }

  function settleRunsForRuntimeRecovery() {
    const running = [...s.runningIds]
    if (!running.length) return
    for (const id of running) {
      setMessageQueue(id, { steering: [], followUp: [] })
      finishRun(id)
      update(id, conversation => {
        const messages = [...conversation.messages]
        const settledTools = settleRunningToolMessages(messages)
        const cleaned = withoutBlankAssistantMessages(settledTools)
        const stopped = t('本轮已停止。', 'This turn was stopped.')
        if (cleaned[cleaned.length - 1]?.content !== stopped) {
          cleaned.push({
            id: crypto.randomUUID(),
            role: 'assistant',
            content: stopped,
            timestamp: Date.now(),
            status: 'done',
          })
        }
        return { ...conversation, messages: cleaned }
      })
    }
  }

  async function rewindContext() {
    const conversation = active()
    if (!conversation || s.continuity.compacting.has(conversation.id)) return
    const kept = rewindVisibleMessages(conversation.messages)
    if (!kept) {
      update(conversation.id, current => ({
        ...current,
        messages: [...current.messages, {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: t('没有可丢掉的探索。', 'There is no exploration to drop.'),
          timestamp: Date.now(),
          status: 'done',
        }],
      }))
      return
    }
    if (s.runningIds.has(conversation.id)) finishRun(conversation.id)
    try {
      await invokeCommand('rewind_coding_session', {
        conversationId: conversation.id,
      })
      update(conversation.id, current => ({
        ...current,
        messages: [
          ...rewindVisibleMessages(current.messages) ?? kept,
          {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: t('已丢掉最近一段探索。', 'Dropped the latest exploration.'),
            timestamp: Date.now(),
            status: 'done',
          },
        ],
      }))
    } catch (reason) {
      update(conversation.id, current => ({
        ...current,
        messages: [...current.messages, {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: t(`回退失败：${agentErrorMessage(reason)}`, `Rewind failed: ${agentErrorMessage(reason)}`),
          timestamp: Date.now(),
          status: 'done',
        }],
      }))
    }
  }

  async function handoffContext(kernel?: AgentKernel) {
    const conversation = active()
    if (
      !conversation
      || s.runningIds.has(conversation.id)
      || s.continuity.compacting.has(conversation.id)
    ) return
    const targetKernel = normalizeAgentKernel(kernel ?? conversation.kernel)
    try {
      const sessionId = String(await invokeCommand('handoff_coding_session', {
        conversationId: conversation.id,
        kernel: targetKernel,
      })).trim()
      if (!sessionId) return
      const handed: Conversation = {
        ...conversation,
        id: sessionId,
        kernel: targetKernel,
        title: `${t('接力', 'Handoff')} · ${conversation.title}`.slice(0, 40),
        createdAt: Date.now(),
        messages: [{
          id: crypto.randomUUID(),
          role: 'assistant',
          content: t('已整理上一会话并接到新任务。', 'Compacted the previous conversation and continued in a new task.'),
          timestamp: Date.now(),
          status: 'done',
        }],
      }
      s.conversations = [handed, ...s.conversations]
      s.activeId = sessionId
      persist(handed)
    } catch (reason) {
      update(conversation.id, current => ({
        ...current,
        messages: [...current.messages, {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: t(`接力失败：${agentErrorMessage(reason)}`, `Handoff failed: ${agentErrorMessage(reason)}`),
          timestamp: Date.now(),
          status: 'done',
        }],
      }))
    }
  }

  async function compactContext() {
    const conversationId = s.activeId
    if (!conversationId || s.continuity.compacting.has(conversationId)) return
    // Manual /compact is not gated at 80%. Running turns are aborted by Pi
    // compact itself; leftover GUI running flags must not swallow the click.
    s.continuity = applyCodingContinuityEvent(
      s.continuity,
      conversationId,
      { type: 'runtime.compaction_started' },
    )
    await nextTick()
    try {
      const compacted = await invokeCommand<CodingCompactionResult>('compact_coding_session', {
        conversationId,
      })
      patchTurnStatus(conversationId, state => (
        applySessionUsageAfterCompaction(state, compacted?.estimatedTokensAfter)
      ))
      persistSessionContextUsage(conversationId)
      s.continuity = applyCodingContinuityEvent(
        s.continuity,
        conversationId,
        { type: 'runtime.compaction_completed' },
      )
    } catch (reason) {
      s.continuity = applyCodingContinuityEvent(
        s.continuity,
        conversationId,
        {
          type: 'runtime.compaction_completed',
          error: codingCompactionErrorMessage(reason),
        },
      )
      dismissCompactionErrorLater(conversationId)
    }
  }

  async function controlGoal(action: 'pause' | 'resume' | 'clear') {
    const conversationId = s.activeId
    if (!conversationId || s.runningIds.has(conversationId)) return
    const conversation = s.conversations.find(item => item.id === conversationId)
    if (!conversation) return
    if (action === 'resume') {
      s.runningIds = new Set(s.runningIds).add(conversationId)
    }
    try {
      await invokeCommand('send_message', {
        conversationId,
        prompt: `/goal ${action}`,
        workspacePath: conversation.workspacePath ?? '',
        modelMode: conversation.modelMode ?? '',
        modelProvider: conversation.modelProvider ?? '',
        modelId: conversation.modelId ?? '',
        thinkingLevel: conversation.thinkingLevel ?? '',
        modelSourcePreference: conversation.modelSourcePreference ?? 'auto',
        executionMode: conversation.executionMode ?? DEFAULT_CODING_EXECUTION_MODE,
        approvalPolicy: conversation.approvalPolicy ?? DEFAULT_CODING_APPROVAL_POLICY,
        mcpServers: conversation.mcpServers ?? [],
        mcpConfigDigest: conversation.mcpConfigDigest ?? '',
        attachments: [],
      })
    } catch (reason) {
      finishRun(conversationId)
      update(conversationId, current => ({
        ...current,
        messages: [...current.messages, {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: t(`目标操作失败：${agentErrorMessage(reason)}`, `Goal action failed: ${agentErrorMessage(reason)}`),
          timestamp: Date.now(),
          status: 'done',
        }],
      }))
    }
  }

  async function respondApproval(
    requestId: string,
    approved: boolean,
    scope: 'once' | 'conversation' = 'once',
    choice?: string,
  ) {
    const conversation = s.conversations.find(item => (
      item.messages.some(message => (
        message.approvalRequestId === requestId
        && message.approvalState === 'pending'
      ))
    ))
    if (!conversation) return
    const conversationGrant = approved && scope === 'conversation'
    try {
      await invokeCommand('respond_tool_approval', {
        conversationId: conversation.id,
        requestId,
        approved,
        scope: conversationGrant ? 'conversation' : '',
        choice: String(choice ?? '').trim(),
      })
      const selected = askApprovalChoice(choice)
      update(conversation.id, current => ({
        ...current,
        messages: current.messages.map(message => (
          message.approvalRequestId === requestId
            ? {
                ...message,
                status: 'done',
                approvalState: approved ? 'approved' : 'denied',
                approvalChoiceId: selected.id || message.approvalChoiceId,
                approvalReason: selected.otherText
                  || (selected.id
                    ? ''
                    : approved
                      ? conversationGrant
                        ? t('已允许本对话后续同类操作', 'Allowed similar actions for this conversation')
                        : t('已允许本次操作', 'Allowed this action')
                      : t('已拒绝本次操作', 'Denied this action')),
              }
            : message
        )),
      }))
    } catch (reason) {
      update(conversation.id, current => ({
        ...current,
        messages: current.messages.map(message => (
          message.approvalRequestId === requestId
            ? {
                ...message,
                status: 'done',
                approvalState: 'expired',
                approvalReason: t(`审批失败：${agentErrorMessage(reason)}`, `Approval failed: ${agentErrorMessage(reason)}`),
              }
            : message
        )),
      }))
    }
  }

  async function listen() {
    disposeEvents = await listenEvent<AgentEvent>('engine-event', event => {
      const {
        sessionId,
        type,
        text = '',
        toolName,
        toolCallId,
        durationMs,
        error,
        done,
        tools,
        extensions,
        skills,
        executionMode,
        approvalPolicy,
        capabilities,
        requestId,
        input,
        approved,
        grantable,
        justification,
        choice,
        reason,
        goal,
        subagentTasks,
        resumed,
        aborted,
        steering,
        followUp,
        modelSource,
        usage,
        compaction,
        contextComposition,
        sessions,
      } = event.payload
      if (!sessionId && (type === 'engine.stopped' || type === 'engine.protocol_error')) {
        // Scope the stop to the sessions the stopped engine instance actually
        // served. Without that identity there is nothing safe to notify: a
        // broadcast marks unrelated sessions as stopped.
        const affected = Array.isArray(sessions)
          ? sessions
              .map(value => String(value ?? '').trim())
              .filter(value => value && s.conversations.some(item => item.id === value))
          : []
        if (!affected.length) return
        const affectedSet = new Set(affected)
        for (const id of affectedSet) activeTurnPolicies.delete(id)
        for (const compactingId of [...s.continuity.compacting]) {
          if (!affectedSet.has(compactingId)) continue
          s.continuity = applyCodingContinuityEvent(
            s.continuity,
            compactingId,
            {
              type: 'runtime.compaction_completed',
              error: t('Agent 进程已停止，本次整理已中断。', 'The Agent process stopped. This compaction was interrupted.'),
            },
          )
          dismissCompactionErrorLater(compactingId)
        }
        const message = type === 'engine.protocol_error'
          ? t(`Agent 通信异常：${agentRuntimeErrorMessage(error)}`, `Agent communication error: ${agentRuntimeErrorMessage(error)}`)
          : error
            ? t(`Agent 已停止：${agentRuntimeErrorMessage(error)}`, `Agent stopped: ${agentRuntimeErrorMessage(error)}`)
            : t('Agent 已停止。', 'Agent stopped.')
        s.conversations = s.conversations.map(conversation => (
          affected.includes(conversation.id)
            ? {
                ...conversation,
                messages: [
                  ...settleRunningToolMessages(conversation.messages).map(item => (
                    item.approvalState === 'pending'
                      ? {
                          ...item,
                          status: 'done' as const,
                          approvalState: 'expired' as const,
                          approvalReason: t('Agent 进程已结束，本次审批已失效', 'The Agent process ended, so this approval is no longer valid'),
                        }
                      : item
                  )),
                  {
                    id: crypto.randomUUID(),
                    role: 'assistant' as const,
                    content: message,
                    timestamp: Date.now(),
                    status: 'done' as const,
                  },
                ],
              }
            : conversation
        ))
        const nextRunning = new Set(s.runningIds)
        const nextAborting = new Set(s.abortingIds)
        for (const id of affectedSet) {
          clearTurnRunClock(id)
          clearAbortStalled(id)
          nextRunning.delete(id)
          nextAborting.delete(id)
        }
        s.runningIds = nextRunning
        s.abortingIds = nextAborting
        // Only the conversations the stopped engine served are affected. A queue that
        // belongs to another engine keeps its steering and its follow-up untouched: a Pi
        // sidecar going away must not turn a DSH turn's queued guidance into "the turn
        // ended, nothing was delivered".
        const keptQueues = new Map<string, CodingMessageQueue>(s.messageQueues)
        const stalledQueues = new Set<string>(s.stalledQueueIds)
        for (const id of affectedSet) {
          const queue = keptQueues.get(id)
          if (!queue || !queue.steering.length) {
            keptQueues.delete(id)
            stalledQueues.delete(id)
            continue
          }
          keptQueues.set(id, { steering: queue.steering, followUp: [] })
          stalledQueues.add(id)
        }
        s.messageQueues = keptQueues
        s.stalledQueueIds = stalledQueues
        for (const id of affected) scheduleSave(id)
        return
      }
      if (!sessionId) return
      if (isTurnActivityEvent(type)) {
        // The engine owns the truth: an in-turn event proves this session is still
        // running even if another engine's stop cleared the marker earlier.
        if (!s.runningIds.has(sessionId)) {
          s.runningIds = new Set(s.runningIds).add(sessionId)
        }
        patchTurnStatus(sessionId, state => (
          state.runStartedAt === undefined ? applySessionRunStarted(state) : state
        ))
      }
      if (type === 'usage.recorded' && usage) {
        patchTurnStatus(sessionId, state => applySessionUsageRecorded(state, {
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          cacheReadTokens: usage.cacheReadTokens,
          cacheWriteTokens: usage.cacheWriteTokens,
          reasoningTokens: usage.reasoningTokens,
          totalTokens: usage.totalTokens,
          model: usage.model,
          provider: usage.provider,
          recordId: usage.recordId,
        } satisfies Partial<SessionTurnUsage>))
      }
      const composition = readContextCompositionFromEvent({
        type,
        contextComposition,
        usage,
        estimatedTokens: event.payload.estimatedTokens,
        contextWindow: event.payload.contextWindow,
        categories: event.payload.categories,
      })
      if (composition) {
        patchTurnStatus(sessionId, state => applySessionContextComposition(state, composition))
      }
      if ((type === 'usage.recorded' && usage) || composition) {
        persistSessionContextUsage(sessionId)
      }
      if ((type === 'usage.recorded' && usage) || type === 'context.composition') {
        return
      }
      if (type === 'runtime.subagent_tasks') {
        s.conversations = s.conversations.map(conversation => (
          conversation.id === sessionId
            ? { ...conversation, subagentTasks: normalizeSubagentTasks(subagentTasks) }
            : conversation
        ))
        return
      }
      if (type === 'destructive.blocked') {
        // The guard refused a deletion without asking. The reader must see that the command
        // did nothing and why - as a status line, never as a message in the transcript.
        const reason = String(
          (event.payload as unknown as { reason?: string; notice?: string })?.reason
          ?? (event.payload as unknown as { notice?: string })?.notice
          ?? '',
        ).trim()
        // The engine speaks English for these refusals. Mixing that into a Chinese status
        // line reads badly, so an untranslated reason is summarised instead of pasted.
        const localized = /[\u4e00-\u9fff]/.test(reason) ? reason : ''
        pushEngineNotice(localized
          ? t(`已拦截一条删除命令：${localized} —— 未执行。`, `Refused a delete command: ${localized} - nothing ran.`)
          : t('已拦截一条删除命令 —— 未执行。', 'Refused a delete command - nothing ran.'))
        return
      }
      if (type === 'session.queue_updated') {
        const previousQueue = s.messageQueues.get(sessionId)
          ?? { steering: [], followUp: [] }
        const nextQueue = projectCodingMessageQueue(steering, followUp)
        const appliedSteeringCount = Math.max(
          0,
          previousQueue.steering.length - nextQueue.steering.length,
        )
        setMessageQueue(
          sessionId,
          nextQueue,
        )
        if (!nextQueue.steering.length) markQueueStalled(sessionId, false)
        if (appliedSteeringCount > 0) {
          let remaining = appliedSteeringCount
          s.conversations = s.conversations.map(conversation => (
            conversation.id === sessionId
              ? {
                  ...conversation,
                  messages: conversation.messages.map(message => {
                    if (remaining <= 0 || message.role !== 'user' || message.status !== 'queued') {
                      return message
                    }
                    remaining -= 1
                    return { ...message, status: 'done' }
                  }),
                }
              : conversation
          ))
        }
      }
      s.conversations = s.conversations.map(conversation => {
        if (conversation.id !== sessionId) return conversation
        const messages = [...conversation.messages]
        const last = messages.at(-1)

        if (
          type === 'session.ready'
          || type === 'session.policy_updated'
          || type === 'session.turn_policy'
          || type === 'session.turn_policy_cleared'
        ) {
          s.continuity = applyCodingContinuityEvent(
            s.continuity,
            sessionId,
            { type, resumed },
          )
          const turnPolicyActive = projectAgentTurnPolicy(
            type,
            activeTurnPolicies.has(sessionId),
          )
          if (turnPolicyActive) activeTurnPolicies.add(sessionId)
          else activeTurnPolicies.delete(sessionId)
          return {
            ...conversation,
            agentTools: projectAgentTools(
              type,
              tools,
              conversation.agentTools,
              turnPolicyActive,
            ),
            agentExtensions: extensions ?? conversation.agentExtensions,
            agentSkills: skills ?? conversation.agentSkills,
            executionMode: executionMode ?? conversation.executionMode,
            approvalPolicy: approvalPolicy ?? conversation.approvalPolicy,
            agentCapabilities: capabilities ?? conversation.agentCapabilities,
          }
        }
        if (type === 'session.model_source') {
          return {
            ...conversation,
            modelSource: modelSource === 'account' || modelSource === 'personal'
              ? modelSource
              : conversation.modelSource,
          }
        }
        if (type === 'session.goal_updated') {
          return {
            ...conversation,
            agentGoal: normalizeGoal(goal),
          }
        }
        if (type === 'session.queue_updated') return conversation
        if (type === 'session.steer_rejected') {
          messages.push({
            id: crypto.randomUUID(),
            role: 'assistant',
            content: t(`引导未加入当前回合：${agentErrorMessage(error)}`, `Guidance was not added to this turn: ${agentErrorMessage(error)}`),
            timestamp: Date.now(),
            status: 'done',
          })
        } else if (type === 'assistant.started') {
          s.runningIds = new Set(s.runningIds).add(sessionId)
          patchTurnStatus(sessionId, state => (
            state.runStartedAt === undefined
              ? applySessionRunStarted(state)
              : state
          ))
          return conversation
        }
        if (type === 'approval.requested' && requestId) {
          messages.push({
            id: crypto.randomUUID(),
            role: 'tool',
            content: text,
            timestamp: Date.now(),
            toolName,
            status: 'running',
            approvalRequestId: requestId,
            approvalInput: input,
            approvalState: 'pending',
            approvalGrantable: grantable === true,
            approvalJustification: justification
              ? { purpose: justification.purpose, safety: justification.safety }
              : undefined,
          })
        } else if (type === 'approval.resolved' && requestId) {
          const approvalIndex = messages.findIndex(message => (
            message.approvalRequestId === requestId
          ))
          if (approvalIndex >= 0) {
            const conversationGrant = approved
              && reason === 'approved for this conversation'
            messages[approvalIndex] = {
              ...messages[approvalIndex],
              status: 'done',
              approvalState: approved ? 'approved' : 'denied',
              approvalChoiceId: (() => {
                const selected = askApprovalChoice(typeof choice === 'string' ? choice : '')
                return selected.id || messages[approvalIndex].approvalChoiceId
              })(),
              approvalReason: (() => {
                const selected = askApprovalChoice(typeof choice === 'string' ? choice : '')
                if (selected.otherText) return selected.otherText
                return reason === 'choice selected'
                  ? ''
                  : reason === 'approved for this conversation'
                    ? t('已允许本对话后续同类操作', 'Allowed similar actions for this conversation')
                    : reason || (approved
                      ? conversationGrant
                        ? t('已允许本对话后续同类操作', 'Allowed similar actions for this conversation')
                        : t('已允许本次操作', 'Allowed this action')
                      : t('已拒绝本次操作', 'Denied this action'))
              })(),
            }
          }
        } else if (
          type === 'assistant.thinking_started'
          || type === 'assistant.thinking_delta'
          || type === 'assistant.thinking_completed'
        ) {
          const nextMessages = applyAssistantThinkingEvent(
            withoutBlankAssistantMessages(messages),
            {
              type,
              text: text,
              durationMs,
            },
          )
          messages.splice(0, messages.length, ...nextMessages)
        } else if (type === 'assistant.delta') {
          const delta = String(text ?? '')
          if (last?.role === 'assistant' && last.status === 'running') {
            if (delta) {
              const settled = settleLiveThinking(messages)
              const current = settled.at(-1) ?? last
              messages.splice(0, messages.length, ...settled)
              messages[messages.length - 1] = { ...current, content: current.content + delta }
            }
          } else if (delta.trim()) {
            messages.push({
              id: crypto.randomUUID(),
              role: 'assistant',
              content: delta,
              timestamp: Date.now(),
              status: 'running',
            })
          }
        } else if (type === 'assistant.segment_completed') {
          if (last?.role === 'assistant' && last.status === 'running') {
            const content = String(text || last.content)
            if (!content.trim()) messages.pop()
            else messages[messages.length - 1] = { ...last, content, status: 'done' }
          } else if (String(text ?? '').trim()) {
            messages.push({
              id: crypto.randomUUID(),
              role: 'assistant',
              content: text,
              timestamp: Date.now(),
              status: 'done',
            })
          }
        } else if (type === 'assistant.completed') {
          // Ignore empty aborted shells (legacy bridge synthesized message_done
          // with reason=aborted and no content). Real abort settles via turn_settled.
          const abortedEmpty = !String(text ?? '').trim()
            && /abort/i.test(String(reason ?? ''))
          if (abortedEmpty) {
            if (last?.role === 'assistant' && last.status === 'running' && !last.content.trim()) {
              messages.pop()
            } else if (last?.role === 'assistant' && last.status === 'running') {
              messages[messages.length - 1] = { ...last, status: 'done' }
            }
          } else if (last?.role === 'assistant' && last.status === 'running') {
            const content = String(text || last.content)
            if (!content.trim()) messages.pop()
            else messages[messages.length - 1] = { ...last, content, status: 'done' }
          } else if (String(text ?? '').trim()) {
            messages.push({
              id: crypto.randomUUID(),
              role: 'assistant',
              content: text,
              timestamp: Date.now(),
              status: 'done',
            })
          }
        } else if (type === 'assistant.settled') {
          if (last?.role === 'assistant' && last.status === 'running') {
            if (!last.content.trim()) messages.pop()
            else messages[messages.length - 1] = { ...last, status: 'done' }
          }
          const settledTools = settleRunningToolMessages(messages)
          const cleaned = withoutBlankAssistantMessages(settledTools)
          if (cleaned !== messages) {
            messages.splice(0, messages.length, ...cleaned)
          }
          const settledQueue = s.messageQueues.get(sessionId)
          if (settledQueue?.steering.length) {
            // The turn ended before Pi consumed these steering messages. Keep
            // them visible so the reader can withdraw and resend instead of
            // losing them silently.
            setMessageQueue(sessionId, { steering: settledQueue.steering, followUp: [] })
            markQueueStalled(sessionId, true)
          } else {
            setMessageQueue(sessionId, { steering: [], followUp: [] })
            markQueueStalled(sessionId, false)
          }
          finishRun(sessionId)
        } else if (type === 'tool.started' || type === 'tool.completed') {
          const toolText = type === 'tool.completed'
            ? agentToolResultMessage(text, error)
            : text
          const nextMessages = applyCodingToolEvent(
            withoutBlankAssistantMessages(messages),
            {
              type,
              text: toolText,
              toolName,
              toolCallId,
              durationMs,
              done,
            },
          )
          messages.splice(0, messages.length, ...nextMessages)
        } else if (type === 'engine.error') {
          const erroredQueue = s.messageQueues.get(sessionId)
          if (erroredQueue?.steering.length) {
            setMessageQueue(sessionId, { steering: erroredQueue.steering, followUp: [] })
            markQueueStalled(sessionId, true)
          } else {
            setMessageQueue(sessionId, { steering: [], followUp: [] })
            markQueueStalled(sessionId, false)
          }
          finishRun(sessionId)
          const settledTools = settleRunningToolMessages(messages)
          const cleaned = withoutBlankAssistantMessages(settledTools)
          if (cleaned !== messages) {
            messages.splice(0, messages.length, ...cleaned)
          }
          const bubble = agentEngineErrorBubble(error)
          for (let index = 0; index < messages.length; index++) {
            if (messages[index].approvalState === 'pending') {
              messages[index] = {
                ...messages[index],
                status: 'done',
                approvalState: 'expired',
                approvalReason: bubble.approvalReason,
              }
            }
          }
          if (!bubble.stopped || messages[messages.length - 1]?.content !== bubble.content) {
            messages.push({
              id: crypto.randomUUID(),
              role: 'assistant',
              content: bubble.content,
              timestamp: Date.now(),
              status: 'done',
            })
          }
        }
        if (type === 'runtime.compaction_started' || type === 'runtime.compaction_completed') {
          const compactError = error ? codingCompactionErrorMessage(error) : ''
          s.continuity = applyCodingContinuityEvent(
            s.continuity,
            sessionId,
            { type, aborted, error: compactError },
          )
          if (type === 'runtime.compaction_completed' && compactError) {
            dismissCompactionErrorLater(sessionId)
          }
          if (type === 'runtime.compaction_completed' && !compactError) {
            patchTurnStatus(sessionId, state => (
              applySessionUsageAfterCompaction(state, compaction?.estimatedTokensAfter)
            ))
            const lastContextUsage = sessionContextUsageRecord(sessionId)
            return lastContextUsage
              ? { ...conversation, lastContextUsage }
              : conversation
          }
          // Overflow recovery failed after Pi auto-compact: tell the user once.
          // Successful auto-compact stays silent (no “上下文已满” toast/message).
          if (
            type === 'runtime.compaction_completed'
            && compactError
            && new RegExp(
              `${t('自动整理上下文失败', 'Automatic context compaction failed')}|overflow recovery failed|auto-compaction failed`,
              'i',
            ).test(String(error ?? compactError))
          ) {
            messages.push({
              id: crypto.randomUUID(),
              role: 'assistant',
              content: compactError,
              timestamp: Date.now(),
              status: 'done',
            })
            return { ...conversation, messages }
          }
          return conversation
        }
        return { ...conversation, messages }
      })
      scheduleSave(sessionId)
    })
  }

  function dispose() {
    stopWatchActiveId()
    disposeEvents?.()
    disposeEvents = undefined
    activeTurnPolicies.clear()
    for (const timer of saveTimers.values()) window.clearTimeout(timer)
    saveTimers.clear()
    for (const timer of compactionErrorTimers.values()) window.clearTimeout(timer)
    compactionErrorTimers.clear()
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
    if (idleReconcileTimer) window.clearInterval(idleReconcileTimer)
  }

  return {
    store,
    dispose,
    get conversations() { return s.conversations },
    set conversations(value) { s.conversations = value },
    get activeId() { return s.activeId },
    set activeId(value) { s.activeId = value },
    get active() { return active() },
    get workspacePath() { return workspacePath() },
    get activeRunning() { return activeRunning() },
    get runningConversationIds() { return runningConversationIds() },
    get activeAborting() { return activeAborting() },
    get activeAbortStalled() { return activeAbortStalled() },
    get activeMessageQueue() { return activeMessageQueue() },
    get activeQueuedGuidanceStalled() { return activeQueuedGuidanceStalled() },
    get engineNotice() { return s.engineNotice },
    get engineNoticeRepeat() { return s.engineNoticeRepeat },
    get selectedKernel() { return selectedKernel() },
    get selectedModelMode() { return selectedModelMode() },
    get selectedModelProvider() { return selectedModelProvider() },
    get selectedModelId() { return selectedModelId() },
    get selectedThinkingLevel() { return selectedThinkingLevel() },
    get selectedModelSourcePreference() { return selectedModelSourcePreference() },
    get selectedExecutionMode() { return selectedExecutionMode() },
    get selectedApprovalPolicy() { return selectedApprovalPolicy() },
    get selectedMCPServers() { return selectedMCPServers() },
    get selectedMCPConfigDigest() { return selectedMCPConfigDigest() },
    get conversationActionError() { return s.conversationActionError },
    get pendingComposerDraft() { return s.pendingComposerDraft },
    get activeSessionReady() { return activeSessionReady() },
    get activeResumed() { return activeResumed() },
    get activeCompacting() { return activeCompacting() },
    get activeCompactedAt() { return activeCompactedAt() },
    get activeCompactionError() { return activeCompactionError() },
    get activeTurnStatus() { return activeTurnStatus() },
    load,
    listen,
    send,
    editAndResend,
    branchFromAssistant,
    abort,
    settleRunsForRuntimeRecovery,
    compactContext,
    rewindContext,
    handoffContext,
    controlGoal,
    respondApproval,
    archive,
    remove,
    rename,
    setConversationPinned,
    movePinnedConversation,
    reorderPinnedConversation,
    cancelQueuedGuidance,
    editQueuedGuidance,
    startNew,
    ensureConversation,
    setWorkspace,
    clearWorkspace,
    setKernel,
    setModelSelection,
    setThinkingLevel,
    setModelSourcePreference,
    setCodingPolicy,
    setMCPSelection,
    startWorkspaceTask,
    stageComposerDraft,
    consumeComposerDraft,
  }
}


export function useConversations() {
  return createConversationsRuntime()
}

export type ConversationsRuntime = ReturnType<typeof createConversationsRuntime>
