import { createStore, nextTick } from '@/lib/reactStore'
import {
  outcomeForTasks,
  runningTasks,
  type BackgroundTaskOutcome,
} from '@/lib/backgroundStripDigest'
import { invokeCommand, listenEvent } from '@/desktop'
import type { CodingCompactionResult } from '@/codingEnvironmentTypes'
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
  retainAssistantAfterEmptyCompletion,
  settleLiveThinking,
  settleRunningToolMessages,
  withoutBlankAssistantMessages,
} from '@/lib/chatActivity'
import { redactProviderCredentials } from '@/lib/redaction'
import {
  normalizeSubagentTasks,
  projectSubagentBackfill,
  shouldHoldSubagentBackfill,
} from '@/lib/subagentRoster'
import { explainModelCallFailure } from '@/lib/tokenFluxError'
import {
  assistantForkPoint,
  cloneConversationForFork,
  handoffVisibleMessages,
  parseSessionHandoffResult,
} from '@/lib/conversationActions'
import { piMultitaskModelHint } from '@/lib/composerMultitask'
import { t } from '@/lib/uiLocale'
import { toast } from '@/lib/appToast'
import {
  conversationKernelLocked,
  FACTORY_DEFAULT_BUSY_SEND,
  FACTORY_DEFAULT_KERNEL,
  normalizeAgentKernel,
  normalizeBusySend,
  type AgentKernel,
  type BusySendPolicy,
} from '@/lib/agentKernel'
import {
  commandsUnavailableCopy,
  dshSlashDecision,
  parseComposerSlash,
  unknownSlashCopy,
} from '@/lib/dshHostSurface'
import {
  askApprovalChoice,
  encodeAskOtherChoice,
  pendingAskMessage,
} from '@/lib/agentAsk'
import { normalizeDomainTaskContext } from '@/lib/domainTaskContext'
import { shouldRememberCodingProject } from '@/lib/codingProjectMemory'
import { conversationWorkspaceHome, type WorkspaceHome } from '@/lib/workspaceSessionRouting'
import {
  clearComposerDraft,
  composerDraftKey,
  composerDraftPending,
  subscribeComposerDrafts,
} from '@/lib/composerDraftStore'
import { clearComposerQuotes } from '@/lib/composerQuoteStore'
import {
  isBackgroundWorkingTool,
  parentHasActiveTurnResidue,
  shouldClearParentRun,
} from '@/lib/composerRunState'
import {
  liveWorkingItems,
  workingItemsForConversation,
} from '@/lib/workingRoster'
import { modelContextWindowOverride, resolveModelContextWindow } from '@/lib/knownContextWindow'
import { installedModelContextWindows } from '@/modelCatalog'
import { decideTurnStall, resolveTurnStallConfig, type TurnStallKind } from '@/lib/turnStall'
import { decideEngineRestart, resolveEngineRestartConfig } from '@/lib/engineRestart'
import {
  completedNotifyKey,
  defaultTaskNotifySwitch,
  isAlreadySameProblem,
  notifyTaskIfNeeded,
  planBackgroundTaskNotify,
  planProblemNotify,
  shouldNotifySettledBackgroundTask,
  turnStallNotifySummary,
} from '@/lib/taskNotifyBridge'
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
  DshCommandDescriptor,
  DshJob,
  DshPlanMode,
  Message,
  ModelThinkingLevel,
  SubagentTask,
} from '@/types'

const BROWSER_USE_MCP_SERVER = 'milksu-playwright-user'
const DEFAULT_CODING_CONVERSATION_TITLE = t('新编码任务', 'New coding task')
type ComposerScopeToken = 'browser-use' | 'computer-use' | 'image'

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

function normalizeDshJobs(value: unknown): DshJob[] | undefined {
  if (!Array.isArray(value)) return undefined
  const jobs = value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const job = item as Record<string, unknown>
    const id = String(job.id ?? '').trim()
    if (!id) return []
    const status = String(job.status ?? '')
    if (!['running', 'stopping', 'completed', 'killed', 'failed'].includes(status)) return []
    return [{
      id,
      kind: String(job.kind ?? '').trim() || undefined,
      label: String(job.label ?? '').trim() || undefined,
      status: status as DshJob['status'],
      detail: String(job.detail ?? '').trim() || undefined,
      startedAt: Number(job.startedAt ?? 0) || undefined,
    }]
  })
  return jobs.length ? jobs : undefined
}

function normalizePlanMode(value: unknown): DshPlanMode | undefined {
  if (!value || typeof value !== 'object') return undefined
  const plan = value as Record<string, unknown>
  return {
    active: plan.active === true,
    pending: plan.pending === true ? true : undefined,
  }
}

function normalizeDshCommands(value: unknown): DshCommandDescriptor[] | undefined {
  if (!Array.isArray(value)) return undefined
  const commands = value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const command = item as Record<string, unknown>
    const name = String(command.name ?? '').trim().toLowerCase()
    if (!name) return []
    return [{
      name,
      description: String(command.description ?? '').trim() || undefined,
      hint: String(command.hint ?? '').trim() || undefined,
    }]
  })
  return commands.length ? commands : undefined
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
  /**
   * Which source, provider and model actually ran. A model-source failure reports them, and they
   * are closer to the truth than the conversation the renderer happens to be showing.
   */
  provider?: string
  model?: string
  message?: string
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
  jobs?: DshJob[]
  commands?: DshCommandDescriptor[]
  planMode?: DshPlanMode
  resumed?: boolean
  aborted?: boolean
  /** 预算软告警（turn.stall_warning）：阶段 ttfb/stream、软阈值与请求体积。 */
  stallStage?: string
  stallKind?: string
  budgetMs?: number
  payloadBytes?: number
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

/** 落盘的「上一轮出过事」记录（横幅 + 侧栏红叉靠它，重启后仍要显示）。
 *  形状不对 / 两条都空 ⇒ undefined（当作没有），别把半个对象塞进界面。 */
function normalizeAgentProblem(value: unknown): Conversation['agentProblem'] {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  const notice = typeof raw.notice === 'string' ? raw.notice.trim() : ''
  const noticeEnglish = typeof raw.noticeEnglish === 'string' ? raw.noticeEnglish.trim() : ''
  if (!notice && !noticeEnglish) return undefined
  const at = Number(raw.at)
  return {
    notice: notice || undefined,
    noticeEnglish: noticeEnglish || undefined,
    at: Number.isFinite(at) ? at : undefined,
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
    parentConversationId: typeof raw.parentConversationId === 'string'
      && raw.parentConversationId.trim()
      ? raw.parentConversationId.trim()
      : undefined,
    multitask: raw.multitask === true ? true : undefined,
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
    // 落盘的「出过事」记录必须活过这一层：这里**逐字段挑**，漏一个字段就等于重启后丢。
    agentProblem: normalizeAgentProblem(raw.agentProblem),
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
    dshJobs: normalizeDshJobs(raw.dshJobs),
    planMode: normalizePlanMode(raw.planMode),
    dshCommands: normalizeDshCommands(raw.dshCommands),
    ctfJobId: typeof raw.ctfJobId === 'string' ? raw.ctfJobId : undefined,
    ctfMode: ['coach', 'copilot', 'delegate'].includes(String(raw.ctfMode))
      ? raw.ctfMode as Conversation['ctfMode']
      : undefined,
    ctfRole: ['solver', 'tool-builder', 'strategist'].includes(String(raw.ctfRole))
      ? raw.ctfRole as Conversation['ctfRole']
      : undefined,
    workspaceHome: ['chat', 'image', 'ctf', 'vuln', 'lab', 'reverse'].includes(String(raw.workspaceHome))
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
    /node:internal|node:events|Unhandled ['"]error['"] event|bridge\.js|Cannot find module|Uncaught Exception|TypeError:|ReferenceError:|SyntaxError:|internal module|stack trace|milksu-sidecar|cannot create effect on inactive context|at\s+\S+\.(?:js|cjs|mjs|ts|go):\d+/i
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

export function agentRuntimeErrorMessage(
  value: unknown,
  context?: { provider?: string; model?: string; source?: string },
) {
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
  // The turn-failure copy names the source, provider and model that actually ran, so an
  // account-source fallback cannot hide behind a generic "model not found" sentence.
  const modelService = explainModelCallFailure(value, context)
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

export function agentEngineErrorBubble(
  error: unknown,
  context?: { provider?: string; model?: string; source?: string; message?: string },
) {
  // The engine's own sentence is the closer source of truth than anything the UI happens to be
  // showing, and it already names the source, provider and model. Using it verbatim also avoids
  // stacking two prefixes ("Agent failed: model call failed: ...").
  const fromEngine = String(context?.message ?? '').trim()
  if (fromEngine) {
    return {
      content: fromEngine,
      approvalReason: t('Agent 运行失败，本次审批已失效', 'Agent failed, so this approval is no longer valid'),
      stopped: false,
    }
  }
  const detail = agentRuntimeErrorMessage(error, context)
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
export function isTurnActivityEvent(
  type: string,
  extras?: { kernel?: AgentKernel; toolName?: string },
) {
  if (!turnActivityEventTypes.has(type)) return false
  if (
    extras?.kernel === 'dsh'
    && (type === 'tool.started' || type === 'tool.completed' || type === 'tool.progress')
    && isBackgroundWorkingTool(extras.toolName)
  ) {
    return false
  }
  return true
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


/** 该对话的**上一轮出过事**（运行失败 / 守卫示警）。
 *  读者口径：顶部常驻横幅（放在「批准」那个位置）+ 侧栏红叉，
 *  **直到该对话开新一回合或点「知道了」**才消。 */
export interface ProblemTurn {
  notice: string
  noticeEnglish: string
  at: number
}

type ConversationsState = {
  conversations: Conversation[]
  activeId: string | null
  pendingWorkspacePath: string
  pendingWorkspaceHome: WorkspaceHome
  defaultKernel: AgentKernel
  busySend: BusySendPolicy
  pendingKernel: AgentKernel
  pendingModelMode: 'auto' | 'manual' | undefined
  pendingModelProvider: string | undefined
  pendingModelId: string | undefined
  pendingThinkingLevel: ModelThinkingLevel | undefined
  pendingModelSourcePreference: 'auto' | 'account' | 'personal'
  pendingExecutionMode: CodingExecutionMode
  pendingApprovalPolicy: CodingApprovalPolicy
  pendingMultitask: boolean
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
  problemTurns: Record<string, ProblemTurn>
  backgroundTasks: Record<string, Array<{ id: string; name: string; status: string }>>
  /** 窄带专用的**终态**（只增不改：侧栏标记与轮询读的是 backgroundTasks，绝不把终态塞进去）。 */
  backgroundTaskOutcome: Record<string, BackgroundTaskOutcome>
  runningTools: Map<string, Set<string>>
  heartbeatTick: number
  continuity: CodingContinuityState
  turnStatusById: Map<string, SessionTurnSnapshot>
  conversationActionError: string
  pendingComposerDraft: PendingComposerDraft | null
  conversationActionIds: Set<string>
}

type ParkedPendingCanvas = {
  workspacePath: string
  kernel: AgentKernel
  modelMode: ConversationsState['pendingModelMode']
  modelProvider: string | undefined
  modelId: string | undefined
  thinkingLevel: ModelThinkingLevel | undefined
  modelSourcePreference: ConversationsState['pendingModelSourcePreference']
  executionMode: CodingExecutionMode
  approvalPolicy: CodingApprovalPolicy
  multitask: boolean
  mcpServers: string[]
  mcpConfigDigest: string
}

// 任务通知开关的现读槽位：由 App 在挂载后注入（运行时读 ⇒ 改开关即时生效 ✓）。
let taskNotifySource: (() => { needsInput: boolean; failed: boolean; completed: boolean; stalled?: boolean; sound?: boolean } | undefined) | undefined

export function createConversationsRuntime(options?: {
  live?: boolean
  /**
   * 现读任务通知开关（**运行时**读，不用快照 ✗ —— 通知是状态变化时才触发的，
   * 快照会过期）。返回 undefined ⇒ 用默认 开/开/关。
   */
  readTaskNotify?: () => { needsInput: boolean; failed: boolean; completed: boolean; stalled?: boolean; sound?: boolean } | undefined
}) {
  const store = createStore<ConversationsState>({
    conversations: [],
    activeId: null,
    pendingWorkspacePath: '',
    pendingWorkspaceHome: 'chat',
    defaultKernel: FACTORY_DEFAULT_KERNEL,
    busySend: FACTORY_DEFAULT_BUSY_SEND,
    pendingKernel: FACTORY_DEFAULT_KERNEL,
    pendingModelMode: undefined,
    pendingModelProvider: undefined,
    pendingModelId: undefined,
    pendingThinkingLevel: undefined,
    pendingModelSourcePreference: 'auto',
    pendingExecutionMode: DEFAULT_CODING_EXECUTION_MODE,
    pendingApprovalPolicy: DEFAULT_CODING_APPROVAL_POLICY,
    pendingMultitask: false,
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
    problemTurns: {},
    backgroundTasks: {},
    backgroundTaskOutcome: {},
    runningTools: new Map<string, Set<string>>(),
    heartbeatTick: 0,
    continuity: createCodingContinuityState(),
    turnStatusById: new Map<string, SessionTurnSnapshot>(),
    conversationActionError: '',
    pendingComposerDraft: null,
    conversationActionIds: new Set<string>(),
  }, {
    // 第五单：流式爆发期把一帧内的多次状态写入合并成**一次** React 渲染。
    // 注意状态本身仍然同步更新（getState/各 getter 立刻可见，业务逻辑与测试断言不受影响），
    // 被合并的只是“通知订阅者重新渲染”。真机上这叫从「每个 delta 一次整页渲染」变成「每帧一次」。
    schedulePublish: (flush) => {
      if (typeof requestAnimationFrame === 'function') {
        const frame = requestAnimationFrame(flush)
        return () => cancelAnimationFrame(frame)
      }
      const timer = setTimeout(flush, 0)
      return () => clearTimeout(timer)
    },
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
    get defaultKernel() { return store.getState().defaultKernel },
    set defaultKernel(value) { store.setState({ defaultKernel: value }) },
    get busySend() { return store.getState().busySend },
    set busySend(value) { store.setState({ busySend: value }) },
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
    get pendingMultitask() { return store.getState().pendingMultitask },
    set pendingMultitask(value) { store.setState({ pendingMultitask: value }) },
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
    get problemTurns() { return store.getState().problemTurns },
    set problemTurns(value) { store.setState({ problemTurns: value }) },
    get backgroundTasks() { return store.getState().backgroundTasks },
    get backgroundTaskOutcome() { return store.getState().backgroundTaskOutcome },
    set backgroundTasks(value) { store.setState({ backgroundTasks: value }) },
    get continuity() { return store.getState().continuity },
    set continuity(value) { store.setState({ continuity: value }) },
    get turnStatusById() { return store.getState().turnStatusById },
    set turnStatusById(value) { store.setState({ turnStatusById: value }) },
    get runningTools() { return store.getState().runningTools },
    set runningTools(value) { store.setState({ runningTools: value }) },
    get heartbeatTick() { return store.getState().heartbeatTick },
    set heartbeatTick(value) { store.setState({ heartbeatTick: value }) },
    get conversationActionError() { return store.getState().conversationActionError },
    set conversationActionError(value) { store.setState({ conversationActionError: value }) },
    get pendingComposerDraft() { return store.getState().pendingComposerDraft },
    set pendingComposerDraft(value) { store.setState({ pendingComposerDraft: value }) },
    get conversationActionIds() { return store.getState().conversationActionIds },
    set conversationActionIds(value) { store.setState({ conversationActionIds: value }) },
  }
  const parkedPendingByHome: Partial<Record<WorkspaceHome, ParkedPendingCanvas>> = {}
  const heldSubagentSnapshots = new Map<string, SubagentTask[]>()

  function subagentBackfillHeld(sessionId: string) {
    const queue = s.messageQueues.get(sessionId)
    return shouldHoldSubagentBackfill({
      running: s.runningIds.has(sessionId),
      aborting: s.abortingIds.has(sessionId),
      queued: Boolean(queue?.steering.length || queue?.followUp.length),
      composing: composerDraftPending(sessionId),
    })
  }

  function releaseHeldSubagentBackfill() {
    const released: string[] = []
    let next = s.conversations
    for (const [sessionId, tasks] of heldSubagentSnapshots) {
      if (subagentBackfillHeld(sessionId)) continue
      heldSubagentSnapshots.delete(sessionId)
      released.push(sessionId)
      next = next.map(conversation => (
        conversation.id === sessionId
          ? { ...conversation, subagentTasks: tasks }
          : conversation
      ))
    }
    if (!released.length) return
    s.conversations = next
    for (const sessionId of released) reconcileParentRun(sessionId)
  }

  const stopDraftWatch = subscribeComposerDrafts(() => {
    releaseHeldSubagentBackfill()
  })
  const pendingDshGoals = new Map<string, string>()

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

  /**
   * 最后一条“问了但没答上”的用户消息。引擎没接住的那一轮仍然有它——“重试”重新派发的就是它。
   * 空的 assistant 消息（死在写任何东西之前）会被跳过，这正是事故的形状。
   */
  function lastUnansweredPrompt(conversationId: string): string {
    const conversation = s.conversations.find(item => item.id === conversationId)
    if (!conversation) return ''
    for (let index = conversation.messages.length - 1; index >= 0; index -= 1) {
      const message = conversation.messages[index]
      if (!message) continue
      if (message.role === 'assistant' && String(message.content ?? '').trim()) return ''
      if (message.role === 'user' && String(message.content ?? '').trim()) {
        return String(message.content).trim()
      }
    }
    return ''
  }

  /** 卡住回合的本地结算：清运行与停滞标记，不发消息、不派发。 */
  function settleStuckTurnLocally(id: string) {
    finishRun(id)
    clearAbortStalled(id)
    markQueueStalled(id, false)
    activeTurnPolicies.delete(id)
    clearEngineStallWarning(id)
  }

  /**
   * 本地结算先发生，再把最后一条没被回答的用户消息走正常后端路径重发。
   * 调用方负责先把 sidecar 里的旧回合停掉（abort 或重启）。派发成功返回 true。
   */
  async function redispatchStuckTurn(id: string, prompt: string): Promise<boolean> {
    noteStreamEvent(id)
    s.runningIds = new Set(s.runningIds).add(id)
    patchTurnStatus(id, state => applySessionRunStarted(state))
    try {
      await invokeRuntimeTurn(id, {
        prompt,
        attachments: [],
      })
      return true
    } catch (reason) {
      finishRun(id)
      update(id, conversation => ({
        ...conversation,
        messages: [...conversation.messages, {
          id: crypto.randomUUID(),
          role: 'assistant' as const,
          content: t(`重试未启动：${agentRuntimeErrorMessage(reason)}`, `Retry did not start: ${agentRuntimeErrorMessage(reason)}`),
          timestamp: Date.now(),
          status: 'done' as const,
        }],
      }))
      return false
    }
  }

  /**
   * 重试一个已停滞的回合：先把这个卡住的回合从路上拿走，再把最后一条没被回答的用户消息
   * 走正常后端路径重发一遍。**本地结算先发生**，所以即使 sidecar 永远不回应 abort，界面也
   * 会离开“停滞”状态。派发成功返回 true；没有东西可重发返回 false。
   */
  async function wakeStuckTurn(conversationId: string): Promise<boolean> {
    const id = String(conversationId ?? '').trim()
    if (!id) return false
    const prompt = lastUnansweredPrompt(id)
    if (!prompt) return false
    noteAbortSent(id)
    try {
      await invokeCommand('abort_message', { conversationId: id })
    } catch {
      // 尽力而为：下面的本地结算无论如何都要发生。
    }
    settleStuckTurnLocally(id)
    return redispatchStuckTurn(id, prompt)
  }

  /**
   * 读者亲手点「重启引擎」：杀掉不响应 abort 的 sidecar，本地结算这个回合，再在全新的
   * sidecar 上重发最后一条没被回答的用户消息。**不自动重启** —— 只有 UI 调用时才发生。
   * 重启会丢当前回合，所以调用方必须先把代价告诉读者。
   */
  async function restartEngine(conversationId: string): Promise<boolean> {
    const id = String(conversationId ?? '').trim()
    if (!id) return false
    const prompt = lastUnansweredPrompt(id)
    // 先记账：这个会话的引擎重启事件回来时，用它判断本地是否已经接手了结算与重发。
    restartRequestedAtById.set(id, Date.now())
    try {
      await invokeCommand('restart_engine', { conversationId: id })
    } catch {
      // 杀不掉也要走本地结算：读者已经点了，界面不能还卡在「停滞」。
    }
    settleStuckTurnLocally(id)
    if (!prompt) {
      restartRequestedAtById.delete(id)
      return true
    }
    return redispatchStuckTurn(id, prompt)
  }

  /**
   * 停滞回合的「停止」：引擎可能已经死了、永远不回应 abort，
   * 所以先本地结算（工具消息收尾、补一条系统说明、离开 running），再尽力通知引擎。
   */
  async function forceStopConversation(id: string) {
    finishRun(id)
    clearAbortStalled(id)
    activeTurnPolicies.delete(id)
    markQueueStalled(id, false)
    update(id, conversation => ({
      ...conversation,
      messages: [
        ...settleRunningToolMessages(withoutBlankAssistantMessages(conversation.messages)),
        {
          id: crypto.randomUUID(),
          role: 'assistant' as const,
          content: t(
            '本轮已强制停止（引擎未确认）',
            'This turn was force-stopped (the engine never confirmed)',
          ),
          timestamp: Date.now(),
          status: 'done' as const,
        },
      ],
    }))
    try {
      await invokeCommand('abort_message', { conversationId: id })
    } catch {
      // 尽力而为：本地结算已经发生。
    }
  }

  function markQueueStalled(id: string, stalled: boolean) {
    if (s.stalledQueueIds.has(id) === stalled) return
    const next = new Set(s.stalledQueueIds)
    if (stalled) next.add(id)
    else next.delete(id)
    s.stalledQueueIds = next
  }

  /** 把某个对话标成「上一轮出过事」：顶部常驻横幅 + 侧栏红叉（静止时才亮，见侧栏状态位）。 */
  function markProblemTurn(conversationId: string, notice: string, noticeEnglish: string) {
    const id = String(conversationId ?? '').trim()
    if (!id) return
    const at = Date.now()
    s.problemTurns = {
      ...s.problemTurns,
      [id]: { notice, noticeEnglish, at },
    }
    // **同时写进对话对象**：前端每次都用整份对象调 `save_conversation`，
    // 而对象里没有这个字段的话，会把引擎刚落盘的那份**抹掉**。
    s.conversations = s.conversations.map(item => (
      item.id === id
        ? { ...item, agentProblem: { notice, noticeEnglish, at } }
        : item
    ))
  }

  /** 清除某个对话的「上一轮出过事」标记（开新一回合时调）。 */
  function clearProblemTurn(conversationId: string) {
    const id = String(conversationId ?? '').trim()
    if (!id) return
    if (s.problemTurns[id]) {
      const next = { ...s.problemTurns }
      delete next[id]
      s.problemTurns = next
    }
    // 开新一回合时引擎也会清记录；这里同步一份，界面不用等列表刷新。
    dropStoredProblemTurn(id)
  }

  /** 顶部横幅上的「知道了」：读者点掉 ⇒ 该对话的问题标记立即消失（侧栏红叉同时灭）。 */
  function dismissProblemTurn(conversationId?: string) {
    const id = String(conversationId ?? s.activeId ?? '').trim()
    clearProblemTurn(id)
    if (!id) return
    // 落盘那份也要清，否则重开 App 横幅又回来（读者点的是「知道了」，不是「下次再说」）。
    dropStoredProblemTurn(id)
    void invokeCommand('clear_conversation_problem', { conversationId: id }).catch(() => {})
  }

  /** 把记录里的 agentProblem 就地抹掉（本地立刻一致，随后列表刷新再对齐）。 */
  function dropStoredProblemTurn(id: string) {
    const key = String(id ?? '').trim()
    if (!key) return
    let changed = false
    const next = s.conversations.map(item => {
      if (item.id !== key || !item.agentProblem) return item
      changed = true
      return { ...item, agentProblem: undefined }
    })
    if (changed) s.conversations = next
  }

  /** 落盘那份（重启后仍然在）⇒ 转成与内存同形的 ProblemTurn。 */
  function storedProblemTurn(record: Conversation | undefined) {
    const problem = record?.agentProblem
    if (!problem) return null
    const notice = String(problem.notice ?? '').trim()
    const noticeEnglish = String(problem.noticeEnglish ?? '').trim()
    if (!notice && !noticeEnglish) return null
    return { notice: notice || noticeEnglish, noticeEnglish: noticeEnglish || notice, at: Number(problem.at ?? 0) }
  }

  /** 该对话当前的标记：**内存里的即时覆盖优先**（事件刚到，列表还没刷新）⇒ 回落记录。 */
  function problemTurnFor(id: string): ProblemTurn | null {
    const key = String(id ?? '').trim()
    if (!key) return null
    return s.problemTurns[key] ?? storedProblemTurn(s.conversations.find(item => item.id === key))
  }

  const activeProblemTurn = (() => (s.activeId ? problemTurnFor(s.activeId) : null))

  /** 侧栏红叉的判据：出过事就有。 */
  function conversationHasProblem(id: string) {
    return Boolean(problemTurnFor(id))
  }

  /** 出过事的对话（侧栏红叉靠它）。开新一回合或点「知道了」即清。 */
  const problemConversationIds = (() => {
    const ids = new Set(Object.keys(s.problemTurns))
    for (const item of s.conversations) {
      if (storedProblemTurn(item)) ids.add(item.id)
    }
    return [...ids]
  })

  // ---- 后台任务（打包/verify 那类）----
  // 任务**自己结束**不会再触发工具调用 ⇒ 侧车不会再发事件 ⇒ 界面会永远停在上一次的
  // 「仍在运行」。有任务在跑时**轻量轮询**现成的刷新命令（首查 2 秒、之后 10 秒一次、
  // 连续两次查空即停 ⇒ 有界）：刷新让引擎重读登记表并回发同一个事件。
  // 轮询**每次都会触发整树重渲染**（App 把 backgroundTasks 传给 ChatPage）⇒ 既要
  // 「没变就不写」，又要保守的间隔。
  const BACKGROUND_TASK_REFRESH_MS = 10000
  // 任务刚结束时最容易被看到「还挂着」（读者看到的是上一秒的事实）⇒ 先**快查一次**。
  const BACKGROUND_TASK_REFRESH_FIRST_MS = 2000
  let backgroundTaskRefreshTimer: ReturnType<typeof setInterval> | undefined
  let backgroundTaskRefreshFirst: ReturnType<typeof setTimeout> | undefined
  // 引擎侧对「刚起来的任务」可能还没登记 ⇒ 单次「空」不能当数（否则标记被提前擦掉）。
  let backgroundRefreshEmptyStreak = 0
  function stopBackgroundTaskRefresh() {
    backgroundRefreshEmptyStreak = 0
    if (backgroundTaskRefreshTimer !== undefined) {
      clearInterval(backgroundTaskRefreshTimer)
      backgroundTaskRefreshTimer = undefined
    }
    if (backgroundTaskRefreshFirst !== undefined) {
      clearTimeout(backgroundTaskRefreshFirst)
      backgroundTaskRefreshFirst = undefined
    }
  }
  function scheduleBackgroundTaskRefresh(hasRunning: boolean, sessionId: string) {
    if (!hasRunning) {
      stopBackgroundTaskRefresh()
      return
    }
    if (backgroundTaskRefreshTimer !== undefined || backgroundTaskRefreshFirst !== undefined) return
    const runRefresh = () => {
      // ⚠️ 这个命令**必须带会话**：引擎侧 `RefreshBackgroundTasks` 在 sessionID 为空时直接返回
      // `session id is required`；没传参 ⇒ 每次都失败、又被静默吞掉 ⇒ 状态区永远停在「仍在运行」。
      const conversation = store.getState().conversations.find(item => item.id === sessionId)
      invokeCommand<{ backgroundTasks?: Array<{ id?: string; name?: string; status?: string }> }>(
        'refresh_coding_background_tasks',
        { conversationId: sessionId, workspacePath: conversation?.workspacePath ?? '' },
      ).then(status => {
        const all = status?.backgroundTasks ?? []
        const running = all
          .filter(task => String(task?.status ?? '') === 'running')
          .map(task => ({
            id: String(task?.id ?? ''),
            name: String(task?.name ?? ''),
            status: String(task?.status ?? ''),
          }))
        // 同一条口径：这一次查完，在跑集合**从非空变空** ⇒ 用完整列表算终态（窄带据此显示 15 秒）。
        const hadRunning = (store.getState().backgroundTasks[sessionId] ?? []).length > 0
        const settled = hadRunning && running.length === 0 ? outcomeForTasks(all, Date.now()) : null
        // **没变就不写**：无条件写会换掉 backgroundTasks 的对象身份 ⇒ App 把它传给 ChatPage
        // ⇒ 整棵树每次轮询都重渲染（真机回归：流式「吐不全 / 思考阶段卡死」）。
        // 逐项比较（长度、顺序、id/name/status）完全一致、且没有新终态要写 ⇒ **连一次写都不做**。
        const current = store.getState().backgroundTasks[sessionId] ?? []
        const unchanged = current.length === running.length
          && current.every((task, index) => (
            task.id === running[index]?.id
            && task.name === running[index]?.name
            && task.status === running[index]?.status
          ))
        if (!unchanged || settled) {
          // 有变化才写；语义不变（只增不改：终态仍写进 backgroundTaskOutcome）。
          markBackgroundTaskSettled({ sessionId, tasks: running, settled })
        }
        if (running.length === 0) {
          // 连续两次空才清零 ⇒ 既不误擦刚起来的任务，真结束了也能及时收。
          backgroundRefreshEmptyStreak += 1
          if (backgroundRefreshEmptyStreak >= 2) stopBackgroundTaskRefresh()
        } else {
          backgroundRefreshEmptyStreak = 0
        }
      }).catch(() => undefined)
    }
    backgroundTaskRefreshFirst = setTimeout(runRefresh, BACKGROUND_TASK_REFRESH_FIRST_MS)
    backgroundTaskRefreshTimer = setInterval(runRefresh, BACKGROUND_TASK_REFRESH_MS)
  }

  /** 已通知过的后台任务终态（键含 at ⇒ 同一次终态重放不发 ✓，新一轮终态是新键 ⇒ 会再发 ✓）。*/
  const notifiedSettledOutcomes = new Set<string>()

  /**
   * 通知用：发出**那一刻**用户正在看的会话（现读，不用快照 ✓ —— 事件与通知之间用户可能切了会话）。
   * 空 ⇒ 外壳不压制（宁可不压，不可吞掉该来的通知 ✗）。由 notifyTaskIfNeeded 透传为 args.activeConversationId。
   */
  function activeConversationIdForNotify(): string {
    return String(store.getState().activeId ?? '').trim()
  }

  function markBackgroundTaskSettled(input: {
    sessionId: string
    tasks: { id: string; name: string; status: string }[]
    settled: BackgroundTaskOutcome | null
  }) {
    const { sessionId, tasks, settled } = input
    // 通知判据里的**状态**：写之前先看"在跑集合是否非空"（两条调用路径算的 hadRunning 与此同源 ✓）。
    const hadRunning = (store.getState().backgroundTasks[sessionId] ?? []).length > 0
    store.setState(state => ({
      ...state,
      backgroundTasks: { ...state.backgroundTasks, [sessionId]: tasks },
      ...(settled
        ? { backgroundTaskOutcome: { ...state.backgroundTaskOutcome, [sessionId]: settled } }
        : {}),
    }))
    // 通知在 **reducer 之外**：settled 非空 且 写之前确实有在跑任务 ⇒ "刚从非空变空"才发。
    // 口径：只有**失败**发（成功/被取消在 planBackgroundTaskNotify 里拦下），走 failed 开关。
    if (!shouldNotifySettledBackgroundTask({ settled, hadRunning })) return
    const plan = planBackgroundTaskNotify({ conversationId: sessionId, outcome: settled, seen: notifiedSettledOutcomes })
    // 没有 outcome 就没有去重键：不往 Set 里塞空串，也没有可通知的终态。
    if (!plan.key) return
    if (!plan.notify || !plan.backgroundTask) { notifiedSettledOutcomes.add(plan.key); return }
    notifiedSettledOutcomes.add(plan.key)
    const notifyTitle = s.conversations.find(item => item.id === sessionId)?.title ?? ''
    notifyTaskIfNeeded(
      {
        conversation: { id: sessionId, title: notifyTitle },
        backgroundTask: plan.backgroundTask,
        enabled: taskNotifySource?.() ?? defaultTaskNotifySwitch(),
      },
      {
        invoke: (method, args) => (
          window as unknown as {
            milksu?: { invoke?: (method: string, args: Record<string, unknown>) => unknown }
          }
        ).milksu?.invoke?.(method, args),
        // 与本次终态去重键里的 at 同源 ⇒ 外壳键与渲染层键一致（重复投递不会被放行）。
        summary: backgroundTaskNotifySummary(settled),
        turnKey: Number(settled?.at) || 0,
        // 会话级前台压制：后台任务失败通知也要现读"正在看的会话"。
        activeConversationId: activeConversationIdForNotify(),
      },
    )
  }

  /** 后台任务的通知正文：带上任务名，且与"任务被异常终止"/"任务已完成"区分开。
   *  目前只有**失败**会走到这里（成功不发是读者口径）。 */
  function backgroundTaskNotifySummary(outcome: { firstName?: string, firstFailedName?: string, count?: number, failedCount?: number } | null): string {
    // 报第一个**失败**任务的名字，不是整批第一个任务（它可能是成功的）。
    const name = String(outcome?.firstFailedName ?? outcome?.firstName ?? '').trim()
    const failedCount = Number(outcome?.failedCount) || 0
    if (!name) return t('后台任务失败', 'Background task failed')
    // 只按**失败个数**措辞：一个失败就只报名字（拿一批的总数当"失败几个"会误导 ✗）。
    if (failedCount > 1) return t(`后台任务失败：${name} 等 ${failedCount} 个`, `Background tasks failed: ${name} and ${failedCount - 1} more`)
    return t(`后台任务失败：${name}`, `Background task failed: ${name}`)
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

  // ---- 存活与卡住指示（搬运自本地分支）----
  // 以前界面只能从“安静”推出“引擎没响应”，于是一个长时间的工具或慢模型调用就被读成
  // “连接掉了”。现在分开两件事：事件=有进展；心跳=引擎还在，但不是进展。
  // 阈值集中在一处（app/src/lib/turnStall.ts），这里只读一次快照。
  const TURN_STALL = resolveTurnStallConfig()
  const lastStreamEventByConversation = new Map<string, number>()
  const heartbeatAtByConversation = new Map<string, number>()
  // 预算软告警：sidecar 报了「请求超过它自己的预算」，但还没硬掐。真实事件到来即清掉。
  const engineWarnedAtByConversation = new Map<string, { at: number; stage: string; budgetMs: number; payloadBytes: number }>()
  // 只记**真实引擎事件**的时刻（心跳不算，本地乐观标记也不算）：abort 无响应的判据要用它。
  const engineProgressAtByConversation = new Map<string, number>()
  // 最近一次 abort_session 发出的时刻：用来判定 sidecar 是否不响应 abort。
  const abortSentAtByConversation = new Map<string, number>()
  // 读者点过「重启引擎」的时刻（按会话）：引擎重启事件回来时，用它判断这个回合是不是
  // 已经在新引擎上重发过了（新回合的起点晚于重启请求）。
  const restartRequestedAtById = new Map<string, number>()
  const ENGINE_RESTART = resolveEngineRestartConfig()

  function noteEngineStallWarning(
    conversationId: string | undefined,
    warning: { stage: string; budgetMs: number; payloadBytes: number },
  ) {
    if (!conversationId) return
    engineWarnedAtByConversation.set(conversationId, { at: Date.now(), ...warning })
    // 借心跳计数器触发一次重渲染：告警必须立刻举牌，不能等到下一帧时钟。
    s.heartbeatTick = s.heartbeatTick + 1
  }
  function clearEngineStallWarning(conversationId: string | undefined) {
    if (!conversationId) return
    engineWarnedAtByConversation.delete(conversationId)
  }
  function noteAbortSent(conversationId: string | undefined) {
    if (!conversationId) return
    abortSentAtByConversation.set(conversationId, Date.now())
  }
  function noteStreamEvent(conversationId: string, at = Date.now()) {
    if (conversationId) lastStreamEventByConversation.set(conversationId, at)
  }
  function noteTurnHeartbeat(conversationId: string | undefined, at = Date.now()) {
    if (!conversationId) return
    heartbeatAtByConversation.set(conversationId, at)
    s.heartbeatTick = s.heartbeatTick + 1
  }

  // ---- 任务通知（桌面系统通知）----
  // 该不该发、发哪一类的判定全部在 app/src/lib/taskNotifyTrigger.ts / taskNotifyBridge.ts 的
  // 纯函数里；这里只做三件事：在状态变化处调用、现读开关、记去重键。不轮询 ✗。

  /** 失败 / 完成的通知去重（第二层；第一层是状态跃迁判据）。 */
  const notifiedProblems = new Set<string>()

  /** 已通知过的"停滞"（键含会话 + 回合起点 ⇒ 同一回合里持续停滞只发一次 ✓，重试后的新回合是新键 ⇒ 会再发 ✓）。 */
  const notifiedStalls = new Set<string>()

  /** 每个会话最近一次失败的内容：判"同一份失败重复投递"用（代替本线的问题标记机制）。 */
  const failedNoticeByConversation = new Map<string, string>()

  /** 本回合没干净跑完（engine.error 来过，含读者主动中止）⇒ 完成通知要跳过这个回合。 */
  const turnNotCleanIds = new Set<string>()

  /**
   * 进入停滞态（engine-gone / model-stalled）**边沿**时发一条**第四类 stalled**通知：
   * 语义是“系统告警：模型疑似挂死，可重试或停止”，与 needs-decision（等你拍板）**目的不同**，
   * 因此单配开关（task_notify.stalled，默认关），不复用 needs_input。
   * 管道复用现成的 NotifyTask（前台压制、防抖不变），不另造一套 ✗。
   *
   * 去重按 **会话 + 回合起点**（runStartedAt）落在本地：调用方可以在停滞翻转那一刻调用，
   * 持续停滞里反复调用也不会重复投递；重试/新回合换了 runStartedAt ⇒ 新事件照发 ✓。
   */
  function notifyTurnStall(input: {
    conversationId?: string
    stallKind?: TurnStallKind
    quietMs?: number
  }): void {
    const conversationId = String(input?.conversationId ?? '').trim()
    const stallKind = input?.stallKind
    if (!conversationId) return
    if (stallKind !== 'engine-gone' && stallKind !== 'model-stalled') return
    const runStartedAt = s.turnStatusById.get(conversationId)?.runStartedAt
    const key = `${conversationId}:stall:${runStartedAt ?? 0}`
    if (notifiedStalls.has(key)) return
    notifiedStalls.add(key)
    const title = s.conversations.find(item => item.id === conversationId)?.title ?? ''
    notifyTaskIfNeeded(
      {
        // 停滞不是审批卡，也不是“等你拍板”：显式点名第四类 stalled（有自己的开关）。
        stalled: true,
        conversation: { id: conversationId, title },
        enabled: taskNotifySource?.() ?? defaultTaskNotifySwitch(),
      },
      {
        invoke: (method, args) => (
          window as unknown as {
            milksu?: { invoke?: (method: string, args: Record<string, unknown>) => unknown }
          }
        ).milksu?.invoke?.(method, args),
        summary: turnStallNotifySummary(stallKind, Number(input?.quietMs) || 0),
        // 与本地去重键里的 runStartedAt 同源 ⇒ 外壳键与渲染层键一致（重入不会因值不同而被放行）。
        turnKey: runStartedAt ?? 0,
        // 会话级前台压制：现读"正在看的会话"随 args 透传给外壳。
        activeConversationId: activeConversationIdForNotify(),
      },
    )
  }

  function notifyTerminalTurn(input: {
    conversationId: string
    turn: 'failed' | 'completed'
    /** 缺省时由桥接层按类型给读者语言的默认摘要 ✓ */
    summary?: string
    at: number
    key: string
  }) {
    const conversationId = String(input?.conversationId ?? '').trim()
    if (!conversationId) return
    if (notifiedProblems.has(input.key)) return
    notifiedProblems.add(input.key)
    const title = s.conversations.find(item => item.id === conversationId)?.title ?? ''
    notifyTaskIfNeeded(
      {
        turn: input.turn,
        // 终态事件：不要被“等你拍板”盖成 needs-input（那会让“失败”弹成“等你拍板”）。
        terminalEvent: true,
        conversation: { id: conversationId, title },
        enabled: taskNotifySource?.() ?? defaultTaskNotifySwitch(),
      },
      {
        invoke: (method, args) => (
          window as unknown as {
            milksu?: { invoke?: (method: string, args: Record<string, unknown>) => unknown }
          }
        ).milksu?.invoke?.(method, args),
        summary: input.summary,
        turnKey: input.at,
        // 会话级前台压制：现读"正在看的会话"随 args 透传给外壳。
        activeConversationId: activeConversationIdForNotify(),
      },
    )
  }

  /** 运行失败：判据（alreadySameProblem）必须由调用方在**写之前**读好再传进来。 */
  function notifyRunFailure(input: { conversationId: string, alreadySameProblem: boolean }) {
    const at = Date.now()
    const plan = planProblemNotify({
      conversationId: input.conversationId,
      alreadySameProblem: input.alreadySameProblem,
      source: 'run-failure',
      at,
      seen: notifiedProblems,
    })
    if (!plan.notify) {
      notifiedProblems.add(plan.key)
      return
    }
    notifyTerminalTurn({
      conversationId: input.conversationId,
      turn: 'failed',
      summary: t('任务被异常终止', 'Task terminated unexpectedly'),
      at,
      key: plan.key,
    })
  }

  /** 回合完成：只在“干净跑完”时调（失败 / 被中止有各自的路径与开关）。 */
  function notifyCompletedTurn(conversationId: string) {
    const at = Date.now()
    notifyTerminalTurn({
      conversationId,
      turn: 'completed',
      summary: t('任务已完成', 'Task finished'),
      at,
      key: completedNotifyKey(conversationId, at),
    })
  }

  function noteToolRunning(
    conversationId: string | undefined,
    toolCallId?: string,
    _toolName?: string,
    running = true,
  ) {
    if (!conversationId) return
    const key = String(toolCallId ?? '')
    if (!key) return
    const next = new Map(s.runningTools)
    const current = new Set(next.get(conversationId) ?? [])
    if (running) current.add(key)
    else current.delete(key)
    if (current.size) next.set(conversationId, current)
    else next.delete(conversationId)
    s.runningTools = next
  }
  function lastEventForConversation(conversationId: string | null) {
    if (!conversationId) return 0
    return lastStreamEventByConversation.get(conversationId) ?? 0
  }
  // 这三个在渲染时用 Date.now() 求值：重渲染的节奏由页面上已有的“每秒时钟”驱动，
  // 不在 store 里再造一个时钟。
  const streamStale = (() => {
    const conversationId = s.activeId
    if (!conversationId || !s.runningIds.has(conversationId)) return false
    const last = lastEventForConversation(conversationId)
    return last > 0 && Date.now() - last >= TURN_STALL.quietMs
  })
  const streamStaleSeconds = (() => {
    const last = lastEventForConversation(s.activeId)
    return last > 0 ? Math.max(0, Math.floor((Date.now() - last) / 1000)) : 0
  })
  const activeToolRunning = (() => {
    const id = s.activeId
    return Boolean(id && (s.runningTools.get(id)?.size ?? 0) > 0)
  })
  const activeEngineAlive = (() => {
    const id = s.activeId
    if (!id) return false
    // Read the tick so a heartbeat re-renders the wording even without other events.
    void s.heartbeatTick
    const at = heartbeatAtByConversation.get(id) ?? 0
    return at > 0 && Date.now() - at < TURN_STALL.heartbeatGraceMs
  })

  // ---- E 队列可见性（搬运自本地分支）----
  // 一个 sidecar 是每 (内核, 工作区) 一个进程：两个对话共用同一个 sidecar 就不能同时跑回合，
  // 后到的那个是在排队——那不是“连接丢了”。
  function sidecarKeyOf(conversation: Conversation): string {
    const workspace = String(conversation.workspacePath ?? '').trim().replace(/\/+$/, '')
    if (!workspace) return ''
    return `${normalizeAgentKernel(conversation.kernel)}\u0000${workspace}`
  }
  // 引擎真的开始答这个对话派发的回合了：至少有一个事件落在 runStartedAt 之后。
  // 派发了但还没有事件，就是还在等 sidecar —— 排队的特征。
  function turnOwnsSidecar(conversationId: string): boolean {
    const startedAt = s.turnStatusById.get(conversationId)?.runStartedAt
    if (startedAt === undefined) return false
    return lastEventForConversation(conversationId) > startedAt
  }
  // 正在占着这个对话的 sidecar 的兄弟对话。只有“真的在产生事件”的兄弟才算：
  // 光有一个 running 标记可能是本地过时的猜测。
  function engineHolderFor(conversationId: string): Conversation | null {
    const conversation = s.conversations.find(item => item.id === conversationId)
    if (!conversation) return null
    const key = sidecarKeyOf(conversation)
    if (!key) return null
    return s.conversations.find(other => (
      other.id !== conversationId
      && s.runningIds.has(other.id)
      && sidecarKeyOf(other) === key
      && turnOwnsSidecar(other.id)
    )) ?? null
  }
  // 当前对话排在谁后面；不在排队时为空串。
  const activeQueuedBehind = (() => {
    const id = s.activeId
    if (!id || !s.runningIds.has(id)) return ''
    if (turnOwnsSidecar(id)) return ''
    const holder = engineHolderFor(id)
    if (!holder) return ''
    return String(holder.title ?? '').trim() || holder.id
  })
  // ---- 停滞看门狗 ----
  // 判定链：进展时钟（最后一次引擎事件到现在的静默）> 有没有工具在跑 > 有没有在排队 >
  // 心跳是否还在。心跳只决定“进程还在吗”，不把停滞时钟清零——否则连接死了但进程还在
  // 的那种死法永远报不出来。具体阈值与纯函数在 @/lib/turnStall。
  const activeStallKind = ((): TurnStallKind => {
    const id = s.activeId
    if (!id) return ''
    const last = lastEventForConversation(id)
    return decideTurnStall({
      running: s.runningIds.has(id),
      toolRunning: activeToolRunning(),
      queuedBehind: Boolean(activeQueuedBehind()),
      engineAlive: activeEngineAlive(),
      engineWarned: engineWarnedAtByConversation.has(id),
      quietMs: last > 0 ? Date.now() - last : 0,
      hasEvent: last > 0,
      config: TURN_STALL,
    })
  })
  // 停滞时的第三个出口：sidecar 不再响应 abort（心跳已停，或 abort 满宽限仍无新事件），
  // 就给出「重启引擎」。重启只能由读者亲手点，这个判据不触发任何动作。
  const activeEngineUnresponsive = (() => {
    const id = s.activeId
    if (!id) return false
    return decideEngineRestart({
      running: s.runningIds.has(id),
      stallKind: activeStallKind(),
      abortSentAt: abortSentAtByConversation.get(id) ?? 0,
      lastEventAt: engineProgressAtByConversation.get(id) ?? 0,
      config: ENGINE_RESTART,
    })
  })
  // 当前会话最近一条预算软告警（用于把「为什么算停滞」告诉读者）；没有则为 null。
  const activeEngineWarning = (() => {
    const id = s.activeId
    if (!id) return null
    return engineWarnedAtByConversation.get(id) ?? null
  })
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
  const selectedMultitask = (() => {
    const current = active()
    if (current) return current.multitask === true
    return s.pendingMultitask === true
  })
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
  let disposeConversationList: (() => void) | undefined
  let unknownSessionReloadAt = 0

  function persist(conversation: Conversation) {
    if (s.conversationActionIds.has(conversation.id)) return Promise.resolve()
    return invokeCommand('save_conversation', { conversation }).catch(console.error)
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
      if (s.conversationActionIds.has(conversationId)) return
      const conversation = s.conversations.find(item => item.id === conversationId)
      if (conversation) persist(conversation)
    }, 400)
    saveTimers.set(conversationId, timer)
  }

  async function flushPendingSaves() {
    const ids = new Set<string>([...saveTimers.keys(), ...s.runningIds])
    if (s.activeId) ids.add(s.activeId)
    for (const timer of saveTimers.values()) window.clearTimeout(timer)
    saveTimers.clear()
    await Promise.all([...ids].map(async id => {
      if (s.conversationActionIds.has(id)) return
      const conversation = s.conversations.find(item => item.id === id)
      if (!conversation) return
      await invokeCommand('save_conversation', { conversation })
    }))
  }

  async function prepareConversationsForUpdateRestart() {
    if (s.runningIds.size) settleRunsForRuntimeRecovery()
    await flushPendingSaves()
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
    // 后台任务：推送事件只在**变化时**来 ⇒ 重启后若已有任务在跑，在它下次变化前不会有事件，
    // 那一刻「回合结束」就漏报。所以**列表就绪后主动拉一次**（只一次，不轮询）。
    // ⚠️ 必须带会话参数（引擎侧 sessionID 为空会直接报 `session id is required`）。
    // 失败静默（拉不到就不提示，别打扰读者）。
    const pullSessionId = s.activeId || s.conversations[0]?.id || ''
    if (pullSessionId) {
      const pull = s.conversations.find(item => item.id === pullSessionId)
      void invokeCommand('refresh_coding_background_tasks', {
        conversationId: pullSessionId,
        workspacePath: pull?.workspacePath ?? '',
      }).catch(() => undefined)
    }
  }

  function currentWorkspaceHome(): WorkspaceHome {
    return active()
      ? conversationWorkspaceHome(active())
      : s.pendingWorkspaceHome
  }

  function update(id: string, updater: (conversation: Conversation) => Conversation) {
    s.conversations = s.conversations.map(conversation => (
      conversation.id === id ? updater(conversation) : conversation
    ))
    const updated = s.conversations.find(conversation => conversation.id === id)
    if (updated) persist(updated)
  }

  function finishRun(id: string) {
    const finished = s.conversations.find(item => item.id === id)
    const parentId = String(finished?.parentConversationId ?? '').trim()
    const parentLiveBefore = parentId ? liveWorkingCountFor(parentId) : 0
    clearTurnRunClock(id)
    clearAbortStalled(id)
    clearEngineStallWarning(id)
    const next = projectCodingRunFinished(
      s.runningIds,
      s.abortingIds,
      id,
    )
    s.runningIds = next.running
    s.abortingIds = next.aborting
    if (parentId && parentId !== id) {
      reconcileParentRun(parentId, {
        workingJustEmptied: parentLiveBefore > 0 && liveWorkingCountFor(parentId) === 0,
      })
    }
  }

  function liveWorkingCountFor(id: string) {
    const conversation = s.conversations.find(item => item.id === id)
    return liveWorkingItems(workingItemsForConversation(
      conversation,
      s.conversations,
      s.runningIds,
    )).length
  }

  function reconcileParentRun(id: string, extras?: { workingJustEmptied?: boolean }) {
    const conversation = s.conversations.find(item => item.id === id)
    if (!conversation) return
    const kernel = normalizeAgentKernel(conversation.kernel)
    const started = s.turnStatusById.get(id)?.runStartedAt
    const liveWorkingCount = liveWorkingCountFor(id)
    const workingJustEmptied = extras?.workingJustEmptied === true
    if (!shouldClearParentRun({
      parentMarkedRunning: s.runningIds.has(id),
      compacting: s.continuity.compacting.has(id),
      aborting: s.abortingIds.has(id),
      liveWorkingCount,
      parentHasActiveTurnResidue: parentHasActiveTurnResidue(conversation.messages, kernel, {
        liveWorkingCount,
        workingJustEmptied,
      }),
      workingJustEmptied,
      msSinceRunStart: started === undefined ? Number.POSITIVE_INFINITY : Date.now() - started,
    })) return
    finishRun(id)
    update(id, current => ({
      ...current,
      messages: settleRunningToolMessages(current.messages),
    }))
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
      reconcileParentRun(conversation.id)
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

  async function spawnMultitaskChild(
    parentId: string,
    prompt: string,
    visiblePrompt: string,
    attachments: CodingAttachment[],
    scopeToken?: ComposerScopeToken,
    productAction?: CodingProductActionRequest,
  ) {
    const parent = s.conversations.find(item => item.id === parentId)
    if (!parent || normalizeAgentKernel(parent.kernel) !== 'dsh') return false
    const childId = crypto.randomUUID()
    const message: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: visiblePrompt,
      timestamp: Date.now(),
      attachments: attachments.length ? attachments : undefined,
    }
    const child: Conversation = {
      id: childId,
      title: fallbackConversationTitle(visiblePrompt),
      createdAt: Date.now(),
      workspacePath: parent.workspacePath,
      workspaceHome: parent.workspaceHome,
      kernel: 'dsh',
      parentConversationId: parent.id,
      modelMode: parent.modelMode,
      modelProvider: parent.modelProvider,
      modelId: parent.modelId,
      thinkingLevel: parent.thinkingLevel,
      modelSourcePreference: parent.modelSourcePreference,
      executionMode: parent.executionMode,
      approvalPolicy: parent.approvalPolicy,
      mcpServers: parent.mcpServers,
      mcpConfigDigest: parent.mcpConfigDigest,
      messages: [message],
    }
    s.conversations = [child, ...s.conversations]
    persist(child)
    s.runningIds = new Set(s.runningIds).add(childId)
    patchTurnStatus(childId, state => applySessionRunStarted(state))
    try {
      await invokeRuntimeTurn(childId, {
        prompt,
        attachments,
        scopeToken,
        productAction,
      })
      return true
    } catch (reason) {
      finishRun(childId)
      update(childId, conversation => ({
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

  function setMessageQueue(id: string, queue: CodingMessageQueue) {
    const next = new Map(s.messageQueues)
    if (queue.steering.length || queue.followUp.length) next.set(id, queue)
    else next.delete(id)
    s.messageQueues = next
  }

  // Delete still uses the sidebar confirmation dialog and stays open on failure.
  // Archive is immediate; a short-lived failure goes to a toast.

  // 会话被归档/删除时，顺手清掉它在本地存储里的草稿与引用：
  // 否则这些格子再也没机会被打开，会长期占着存储（读者提出过这个担心）。
  function discardComposerMemory(id: string) {
    const key = String(id ?? '').trim()
    if (!key) return
    clearComposerDraft(key)
    clearComposerQuotes(key)
  }

  function beginConversationAction(id: string) {
    if (s.conversationActionIds.has(id)) return false
    const nextIds = new Set(s.conversationActionIds)
    nextIds.add(id)
    s.conversationActionIds = nextIds
    const existingTimer = saveTimers.get(id)
    if (existingTimer) {
      window.clearTimeout(existingTimer)
      saveTimers.delete(id)
    }
    return true
  }

  function endConversationAction(id: string) {
    const remaining = new Set(s.conversationActionIds)
    remaining.delete(id)
    s.conversationActionIds = remaining
  }

  async function archive(id: string) {
    if (!beginConversationAction(id)) return
    discardComposerMemory(id)
    await abortChildSessions(id)
    await runConversationAction(t('归档', 'Archive'), 'archive_conversation', id)
    if (s.conversationActionError) toast(s.conversationActionError, { tone: 'destructive' })
  }

  async function remove(id: string) {
    if (!beginConversationAction(id)) return
    discardComposerMemory(id)
    await abortChildSessions(id)
    await runConversationAction(t('删除', 'Delete'), 'delete_conversation', id)
  }

  function childIdsFor(parentId: string) {
    return s.conversations
      .filter(item => item.parentConversationId === parentId)
      .map(item => item.id)
  }

  async function abortChildSessions(parentId: string) {
    await Promise.all(childIdsFor(parentId).map(id => abort(id)))
  }

  async function abortWorkingItem(id: string) {
    const item = s.conversations.find(conversation => conversation.id === id)
    if (item) {
      await abort(item.id)
      return
    }
    const owner = s.conversations.find(conversation => (
      (conversation.subagentTasks ?? []).some(task => (
        task.id === id || task.toolCallId === id
      ))
      || (conversation.dshJobs ?? []).some(job => job.id === id)
    ))
    if (!owner) return
    if (normalizeAgentKernel(owner.kernel) === 'dsh') {
      if ((owner.dshJobs ?? []).some(job => job.id === id)) {
        await invokeCommand('kill_dsh_job', {
          conversationId: owner.id,
          jobId: id,
        })
        return
      }
      await invokeCommand('abort_message', {
        conversationId: owner.id,
        subagentId: id,
      })
      return
    }
    await abort(owner.id)
  }

  async function abortWorkingAll(parentId?: string) {
    const rootId = parentId || s.activeId
    if (!rootId) return
    const root = s.conversations.find(item => (
      item.id === rootId || item.parentConversationId === rootId
    ))
    const target = root?.parentConversationId
      ? root.parentConversationId
      : rootId
    await abortChildSessions(target)
    const parent = s.conversations.find(item => item.id === target)
    const liveTasks = (parent?.subagentTasks ?? []).some(task => (
      task.status === 'start' || task.status === 'running'
    ))
    const liveJobs = (parent?.dshJobs ?? []).some(job => (
      job.status === 'running' || job.status === 'stopping'
    ))
    if (parent && normalizeAgentKernel(parent.kernel) === 'dsh' && liveTasks) {
      await invokeCommand('abort_message', {
        conversationId: target,
        subagentId: '*',
      })
    }
    if (parent && normalizeAgentKernel(parent.kernel) === 'dsh' && liveJobs) {
      await Promise.all((parent.dshJobs ?? [])
        .filter(job => job.status === 'running' || job.status === 'stopping')
        .map(job => invokeCommand('kill_dsh_job', {
          conversationId: target,
          jobId: job.id,
        })))
      return
    }
    if (parent && normalizeAgentKernel(parent.kernel) === 'dsh' && liveTasks) return
    if (liveTasks) await abort(target)
  }

  async function runConversationAction(action: string, command: string, id: string) {
    const snapshot = s.conversations.find(item => item.id === id)
    const wasActive = s.activeId === id
    discard(id)
    s.conversationActionError = ''
    try {
      await invokeCommand(command, { id })
    } catch (cause) {
      const causeText = cause instanceof Error ? cause.message : String(cause)
      s.conversationActionError = t(`${action}失败：${causeText}`, `${action} failed: ${causeText}`)
      if (snapshot && !s.conversations.some(item => item.id === id)) {
        s.conversations = [snapshot, ...s.conversations]
        if (wasActive && !s.activeId) s.activeId = id
      }
    } finally {
      endConversationAction(id)
    }
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

  function snapshotPendingCanvas(): ParkedPendingCanvas {
    return {
      workspacePath: s.pendingWorkspacePath,
      kernel: s.pendingKernel,
      modelMode: s.pendingModelMode,
      modelProvider: s.pendingModelProvider,
      modelId: s.pendingModelId,
      thinkingLevel: s.pendingThinkingLevel,
      modelSourcePreference: s.pendingModelSourcePreference,
      executionMode: s.pendingExecutionMode,
      approvalPolicy: s.pendingApprovalPolicy,
      multitask: s.pendingMultitask,
      mcpServers: [...s.pendingMCPServers],
      mcpConfigDigest: s.pendingMCPConfigDigest,
    }
  }

  function applyPendingCanvas(next: ParkedPendingCanvas, home: WorkspaceHome) {
    s.activeId = null
    s.pendingWorkspaceHome = home
    s.pendingWorkspacePath = next.workspacePath
    s.pendingKernel = next.kernel
    s.pendingModelMode = next.modelMode
    s.pendingModelProvider = next.modelProvider
    s.pendingModelId = next.modelId
    s.pendingThinkingLevel = next.thinkingLevel
    s.pendingModelSourcePreference = next.modelSourcePreference
    s.pendingExecutionMode = next.executionMode
    s.pendingApprovalPolicy = next.approvalPolicy
    s.pendingMultitask = next.multitask
    s.pendingMCPServers = [...next.mcpServers]
    s.pendingMCPConfigDigest = next.mcpConfigDigest
  }

  function parkCurrentPending() {
    if (s.activeId) return
    parkedPendingByHome[s.pendingWorkspaceHome] = snapshotPendingCanvas()
  }

  // 新会话一律不带项目：任务 ＋ 和「新聊天」开出来的是无项目画布，
  // 要在哪个项目里开工走显式入口（项目文件夹 ＋、项目组头选目录、交接指定工作区）。
  function applyFreshPending(home: WorkspaceHome) {
    s.activeId = null
    s.pendingWorkspaceHome = home
    s.pendingWorkspacePath = ''
    s.pendingKernel = home === 'image' ? 'pi' : s.defaultKernel
    s.pendingModelMode = undefined
    s.pendingModelProvider = undefined
    s.pendingModelId = undefined
    s.pendingThinkingLevel = undefined
    s.pendingModelSourcePreference = 'auto'
    s.pendingExecutionMode = DEFAULT_CODING_EXECUTION_MODE
    s.pendingApprovalPolicy = DEFAULT_CODING_APPROVAL_POLICY
    s.pendingMultitask = false
    s.pendingMCPServers = []
    s.pendingMCPConfigDigest = ''
    s.pendingComposerDraft = null
    clearComposerDraft(composerDraftKey(null, home))
    delete parkedPendingByHome[home]
  }

  function startNew(options: { workspaceHome?: WorkspaceHome } = {}) {
    const nextHome = options.workspaceHome ?? 'chat'
    const previousHome = currentWorkspaceHome()
    if (!s.activeId && previousHome !== nextHome) parkCurrentPending()
    applyFreshPending(nextHome)
  }

  function resumePendingHome(home: WorkspaceHome) {
    if (!s.activeId && s.pendingWorkspaceHome === home) return
    if (!s.activeId) parkCurrentPending()
    const parked = parkedPendingByHome[home]
    if (parked) {
      delete parkedPendingByHome[home]
      applyPendingCanvas(parked, home)
      return
    }
    applyFreshPending(home)
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
      multitask: s.pendingMultitask ? true : undefined,
      mcpServers: s.pendingMCPServers.length ? s.pendingMCPServers : undefined,
      mcpConfigDigest: s.pendingMCPServers.length
        ? s.pendingMCPConfigDigest
        : undefined,
      workspaceHome: options.workspaceHome
        ?? (s.pendingWorkspaceHome === 'chat' ? undefined : s.pendingWorkspaceHome),
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
    if (!normalized || currentWorkspaceHome() === 'image') return
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
      if (!s.pendingWorkspacePath && s.pendingMCPServers.length === 0 && !s.pendingMCPConfigDigest) return
      s.pendingWorkspacePath = ''
      s.pendingMCPServers = []
      s.pendingMCPConfigDigest = ''
      return
    }
    const current = s.conversations.find(item => item.id === s.activeId)
    if (!current?.workspacePath && !(current?.mcpServers?.length) && !current?.mcpConfigDigest) return
    update(s.activeId, conversation => ({
      ...conversation,
      workspacePath: undefined,
      mcpServers: undefined,
      mcpConfigDigest: undefined,
    }))
  }

  function setDefaultKernel(kernel: AgentKernel) {
    const next = normalizeAgentKernel(kernel)
    const previous = s.defaultKernel
    s.defaultKernel = next
    if (!s.activeId && s.pendingKernel === previous) s.pendingKernel = next
  }

  function setBusySend(value: BusySendPolicy | string) {
    s.busySend = normalizeBusySend(value)
  }

  function pushCommandNotice(conversationId: string, content: string) {
    update(conversationId, current => ({
      ...current,
      messages: [...current.messages, {
        id: crypto.randomUUID(),
        role: 'assistant',
        content,
        timestamp: Date.now(),
        status: 'done',
      }],
    }))
  }

  async function executeDshHostCommand(conversationId: string, line: string) {
    try {
      const result = await invokeCommand<{ text?: string; kind?: string }>('execute_dsh_command', {
        conversationId,
        line,
      })
      const text = String(result?.text ?? '').trim()
      if (text) pushCommandNotice(conversationId, text)
      return true
    } catch (reason) {
      pushCommandNotice(conversationId, t(
        `命令失败：${agentErrorMessage(reason)}`,
        `Command failed: ${agentErrorMessage(reason)}`,
      ))
      return false
    }
  }

  async function toggleDshPlanMode(active: boolean) {
    const conversationId = s.activeId
    if (!conversationId) return
    try {
      const plan = await invokeCommand<DshPlanMode>('set_dsh_plan_mode', {
        conversationId,
        active,
      })
      update(conversationId, current => ({
        ...current,
        planMode: {
          active: plan?.active === true,
          pending: plan?.pending === true ? true : undefined,
        },
      }))
    } catch (reason) {
      pushCommandNotice(conversationId, t(
        `无法切换计划：${agentErrorMessage(reason)}`,
        `Could not change plan: ${agentErrorMessage(reason)}`,
      ))
    }
  }

  async function refreshDshCommands(conversationId: string) {
    try {
      const commands = await invokeCommand<DshCommandDescriptor[]>('list_dsh_commands', {
        conversationId,
      })
      update(conversationId, current => ({
        ...current,
        dshCommands: normalizeDshCommands(commands),
        dshCommandsError: undefined,
      }))
    } catch (reason) {
      update(conversationId, current => ({
        ...current,
        dshCommands: undefined,
        dshCommandsError: agentErrorMessage(reason),
      }))
    }
  }

  function setMultitask(enabled: boolean) {
    const next = enabled === true
    if (!s.activeId) {
      s.pendingMultitask = next
      return
    }
    const current = s.conversations.find(item => item.id === s.activeId)
    if (!current) return
    update(s.activeId, conversation => ({
      ...conversation,
      multitask: next ? true : undefined,
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
    let outboundPrompt = prompt
    let outboundVisible = visibleText.trim() || prompt
    const runningConversationId = s.activeId
    const activeConversation = s.conversations.find(item => item.id === runningConversationId)
    const pendingAsk = pendingAskMessage(activeConversation?.messages)
    const answeringAsk = Boolean(pendingAsk?.approvalRequestId)
    const steering = Boolean(
      runningConversationId
      && s.runningIds.has(runningConversationId)
      && !answeringAsk,
    )
    const activeKernel = normalizeAgentKernel(
      activeConversation?.kernel ?? s.pendingKernel,
    )
    let pendingGoalObjective = ''
    if (activeKernel === 'dsh' && !steering && !answeringAsk) {
      const decision = dshSlashDecision({
        kernel: 'dsh',
        line: prompt,
        catalog: activeConversation?.dshCommands,
        listingFailed: Boolean(activeConversation?.dshCommandsError),
      })
      if (decision.kind === 'reject') {
        if (runningConversationId) {
          pushCommandNotice(runningConversationId, unknownSlashCopy(t, decision.name))
        }
        return false
      }
      if (decision.kind === 'unavailable') {
        if (runningConversationId) {
          pushCommandNotice(runningConversationId, commandsUnavailableCopy(t))
        }
        return false
      }
      if (decision.kind === 'compact') {
        await compactContext()
        return true
      }
      if (decision.kind === 'host') {
        if (runningConversationId) {
          return executeDshHostCommand(runningConversationId, decision.line)
        }
        if (decision.name === 'goal') {
          const objective = parseComposerSlash(prompt)?.rawInput.trim() || prompt
          outboundPrompt = objective
          outboundVisible = objective
          pendingGoalObjective = objective
        } else {
          const conversationId = ensureConversation()
          return executeDshHostCommand(conversationId, decision.line)
        }
      }
    }
    const visiblePrompt = outboundVisible
    if (
      steering
      && activeKernel === 'dsh'
      && activeConversation?.multitask
      && runningConversationId
    ) {
      return spawnMultitaskChild(
        runningConversationId,
        prompt,
        visiblePrompt,
        attachments,
        scopeToken,
        productAction,
      )
    }
    if (steering && activeKernel !== 'pi' && activeKernel !== 'dsh') return false
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
        multitask: s.pendingMultitask ? true : undefined,
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
    if (pendingGoalObjective) pendingDshGoals.set(conversationId, pendingGoalObjective)

    if (answeringAsk && pendingAsk?.approvalRequestId) {
      await respondApproval(
        pendingAsk.approvalRequestId,
        true,
        'once',
        encodeAskOtherChoice(prompt),
      )
      return true
    }

    const modelPrompt = (value: string) => {
      const conversation = s.conversations.find(item => item.id === conversationId)
      const kernel = normalizeAgentKernel(conversation?.kernel ?? activeKernel)
      if (answeringAsk || kernel !== 'pi' || !conversation?.multitask) return value
      return `${value}\n\n${piMultitaskModelHint(t)}`
    }

    if (steering) {
      try {
        const queueNext = activeKernel === 'dsh' && s.busySend === 'queue'
        await invokeCommand(queueNext ? 'queue_dsh_message' : 'steer_message', {
          conversationId,
          prompt: modelPrompt(prompt),
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
        prompt: modelPrompt(outboundPrompt),
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
    const original = conversation.messages[index]
    update(conversation.id, current => ({
      ...current,
      messages: current.messages.slice(0, index),
    }))
    return send(
      content,
      content,
      original.attachments ?? [],
      undefined,
      undefined,
      Math.max(0, occurrence),
    )
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

  async function forkConversation(id: string) {
    const conversation = s.conversations.find(item => item.id === id)
    if (!conversation) return null
    const point = assistantForkPoint(conversation.messages)
    let sessionId = ''
    if (point) {
      try {
        sessionId = String(await invokeCommand('fork_conversation', {
          conversationId: conversation.id,
          role: 'assistant',
          occurrence: point.occurrence,
        })).trim()
      } catch {
        sessionId = ''
      }
    }
    // Pi owns session-fork. Without a successful assistant fork point, MilkSU
    // only clones the product row (same workspace / project / home / kernel).
    const forkedId = sessionId || crypto.randomUUID()
    const firstUser = conversation.messages.find(item => item.role === 'user')
    const forked = cloneConversationForFork(conversation, {
      id: forkedId,
      title: sessionId
        ? fallbackConversationTitle(firstUser?.content ?? conversation.title)
        : conversation.title,
      messages: sessionId && point
        ? conversation.messages.slice(0, point.index + 1)
        : [],
    })
    s.conversations = [forked, ...s.conversations]
    s.activeId = forkedId
    persist(forked)
    return forkedId
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
    // 记下 abort 发出的时刻：满宽限仍无新事件就说明 sidecar 不响应 abort，给出重启入口。
    noteAbortSent(id)
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
      const handedResult = parseSessionHandoffResult(
        await invokeCommand('handoff_coding_session', {
          conversationId: conversation.id,
          kernel: targetKernel,
        }),
      )
      if (!handedResult.sessionId) return
      const sessionId = handedResult.sessionId
      const handed: Conversation = {
        ...conversation,
        id: sessionId,
        kernel: targetKernel,
        title: `${t('接力', 'Handoff')} · ${conversation.title}`.slice(0, 40),
        createdAt: Date.now(),
        messages: handoffVisibleMessages(conversation.messages, handedResult),
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
      if (normalizeAgentKernel(conversation.kernel) === 'dsh') {
        await invokeCommand('control_dsh_goal', {
          conversationId,
          action,
        })
        return
      }
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
    disposeConversationList?.()
    disposeEvents?.()
    disposeConversationList = await listenEvent('conversations-changed', () => {
      void load()
    })
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
        jobs,
        commands,
        planMode,
        resumed,
        aborted,
        steering,
        followUp,
        modelSource,
        provider,
        model,
        message,
        usage,
        compaction,
        contextComposition,
        sessions,
        stallStage,
        budgetMs,
        payloadBytes,
      } = event.payload
      // 预算软告警：sidecar 说「请求已超过它自己的预算」，但还没硬掐。它不是进展，
      // 不能走 noteStreamEvent；交给看门狗立刻举牌（不必等到本地静默阈值）。
      if (type === 'turn.stall_warning') {
        const warnedId = String(sessionId ?? '') || String(s.activeId ?? '')
        noteEngineStallWarning(warnedId, {
          stage: String(stallStage ?? 'ttfb'),
          budgetMs: Number(budgetMs) || 0,
          payloadBytes: Number(payloadBytes) || 0,
        })
        return
      }
      // 引擎重启：读者点过重启的那个会话，本地已经接手结算与重发，事件只当回执；
      // 同一个 sidecar 服务的其它会话由这条事件结算，否则它们会永远停在「正在跑」。
      if (type === 'engine.restarted') {
        const restartedId = String(sessionId ?? '').trim()
        if (!restartedId) return
        const requestedAt = restartRequestedAtById.get(restartedId)
        if (requestedAt !== undefined) {
          restartRequestedAtById.delete(restartedId)
          // 新回合的起点晚于重启请求 ⇒ 本地已经在新引擎上重发过了，事件只当回执。
          const runStartedAt = s.turnStatusById.get(restartedId)?.runStartedAt ?? 0
          if (runStartedAt >= requestedAt) return
        }
        const wasRunning = s.runningIds.has(restartedId) || s.abortingIds.has(restartedId)
        settleStuckTurnLocally(restartedId)
        if (wasRunning && s.conversations.some(item => item.id === restartedId)) {
          update(restartedId, conversation => ({
            ...conversation,
            messages: [...settleRunningToolMessages(conversation.messages), {
              id: crypto.randomUUID(),
              role: 'assistant' as const,
              content: t('引擎已重启，当前回合已中断。', 'The engine was restarted, so the current turn was interrupted.'),
              timestamp: Date.now(),
              status: 'done' as const,
            }],
          }))
          scheduleSave(restartedId)
        }
        return
      }
      // 任何事件都证明这个对话的流又活了——但心跳除外：
      // 心跳只是“引擎还在”，不是“有进展”。
      if (type !== 'turn.heartbeat') {
        const progressId = String(sessionId ?? '') || String(s.activeId ?? '')
        noteStreamEvent(progressId)
        // 真实引擎事件到了：预算告警过期，abort 也算得到了回应（进程在动）。
        if (progressId) {
          clearEngineStallWarning(progressId)
          engineProgressAtByConversation.set(progressId, Date.now())
          abortSentAtByConversation.delete(progressId)
        }
      }
      if (type === 'turn.heartbeat') {
        noteTurnHeartbeat(sessionId)
        return
      }
      if (type === 'tool.started' || type === 'tool.progress') {
        noteToolRunning(sessionId, toolCallId, toolName, true)
      } else if (type === 'tool.completed') {
        noteToolRunning(sessionId, toolCallId, toolName, false)
      }
      // 新一回合开始了 ⇒ 上一轮「出过事」的标记到此为止（读者口径）。
      // 放在入口：这条标记属于**会话**，不该依赖它此刻是否在会话列表里。
      if (type === 'assistant.started') clearProblemTurn(String(sessionId ?? ''))
      // 「Agent 运行失败」= 这一轮没能正常继续 ⇒ 顶部常驻横幅 + 侧栏红叉（开新一回合才消）。
      // 放在入口：这条标记属于**会话**，不该依赖它此刻是否在会话列表里。
      // 用户主动停下（aborted/cancelled）不算问题：那不是「没能继续」，那是他要的。
      if (type === 'engine.error') {
        const failed = agentEngineErrorBubble(error, {
          provider: String(provider ?? '').trim(),
          model: String(model ?? '').trim(),
          source: String(modelSource ?? '').trim(),
          message: String(message ?? '').trim(),
        })
        if (!failed.stopped) markProblemTurn(String(sessionId ?? ''), failed.content, failed.content)
      }
      // 守卫示警（思考复读等）同样放在入口：上屏 + 标记都不该依赖会话是否在列表里。
      if (type === 'guard.alarm') {
        // 引擎给中英两句，这里按界面语言选一句 ⇒ 读者看得见（绝不静默吞掉）。
        const payload = event.payload as unknown as { notice?: string; noticeEnglish?: string }
        const chinese = String(payload?.notice ?? '').trim()
        const english = String(payload?.noticeEnglish ?? '').trim()
        if (chinese || english) {
          pushEngineNotice(t(chinese || english, english || chinese))
          // 守卫示警也是「这一轮出了问题」（报错不能埋在对话末尾）⇒ 顶部常驻横幅 + 侧栏红叉。
          markProblemTurn(String(sessionId ?? ''), chinese || english, english || chinese)
        }
        return
      }
      if (type === 'background_tasks' || type === 'runtime.background_tasks') {
        // 后台任务（打包/verify 那类）**不在** runningIds/turnStatus 里 ⇒ 回合结束时界面会像
        // 「完事了」。这里订阅侧车已有的 `background_tasks` 事件，把事实存进状态。
        // ⚠️ 必须两个名字都认：引擎在 `supervisor.go` 里把侧车名改写成 `runtime.background_tasks`
        // （与 subagent_tasks/dsh_jobs/compaction_* 同一张改名表），只认旧名字就会**静默收不到**。
        // ⚠️ 字段名要两个都读：侧车发 `{ tasks: … }`，引擎把它解进 `Event.BackgroundTasks`
        // （json 标签是 `backgroundTasks`）再转给渲染层 ⇒ 只读 `tasks` 会永远得到空数组。
        const tasksPayload = (event.payload ?? {}) as { tasks?: unknown; backgroundTasks?: unknown }
        const rawTasks = Array.isArray(tasksPayload.tasks)
          ? tasksPayload.tasks
          : (Array.isArray(tasksPayload.backgroundTasks) ? tasksPayload.backgroundTasks : [])
        const tasks = rawTasks as Array<{ id?: unknown; name?: unknown; status?: unknown }>
        const id = String(sessionId ?? '').trim()
        if (!id) return
        // 有任务在跑 ⇒ 开轮询；全清 ⇒ 停（任务自己结束时不会再有工具调用事件）。
        scheduleBackgroundTaskRefresh(rawTasks.length > 0, id)
        const running = runningTasks(tasks)
        // 事实层（**只留在跑的**，与侧栏标记/轮询的语义一致）。
        const kept = running.map(task => ({
          id: String((task as { id?: unknown })?.id ?? ''),
          name: String(task?.name ?? ''),
          status: String(task?.status ?? ''),
        }))
        const hadRunning = (store.getState().backgroundTasks[id] ?? []).length > 0
        // 终态：**在跑集合从非空变空**那一刻，用**过滤前的完整列表**判（窄带终态行的口径）。
        const settled = hadRunning && kept.length === 0 ? outcomeForTasks(tasks, Date.now()) : null
        markBackgroundTaskSettled({ sessionId: id, tasks: kept, settled })
        return
      }
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
      if (!s.conversations.some(item => item.id === sessionId)) {
        const now = Date.now()
        if (now - unknownSessionReloadAt > 400) {
          unknownSessionReloadAt = now
          void load()
        }
      }
      const sessionKernel = normalizeAgentKernel(
        s.conversations.find(item => item.id === sessionId)?.kernel,
      )
      if (isTurnActivityEvent(type, { kernel: sessionKernel, toolName })) {
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
      if (type === 'runtime.dsh_jobs') {
        const liveBefore = liveWorkingCountFor(sessionId)
        s.conversations = s.conversations.map(conversation => (
          conversation.id === sessionId
            ? { ...conversation, dshJobs: normalizeDshJobs(jobs) }
            : conversation
        ))
        const liveAfter = liveWorkingCountFor(sessionId)
        reconcileParentRun(sessionId, {
          workingJustEmptied: liveBefore > 0 && liveAfter === 0,
        })
        return
      }
      if (type === 'runtime.dsh_commands') {
        s.conversations = s.conversations.map(conversation => (
          conversation.id === sessionId
            ? {
                ...conversation,
                dshCommands: normalizeDshCommands(commands),
                dshCommandsError: error || undefined,
              }
            : conversation
        ))
        return
      }
      if (type === 'session.plan_updated') {
        s.conversations = s.conversations.map(conversation => (
          conversation.id === sessionId
            ? { ...conversation, planMode: normalizePlanMode(planMode) }
            : conversation
        ))
        return
      }
      if (type === 'runtime.subagent_tasks') {
        const incoming = normalizeSubagentTasks(subagentTasks)
        const hold = subagentBackfillHeld(sessionId)
        if (hold) heldSubagentSnapshots.set(sessionId, incoming)
        else heldSubagentSnapshots.delete(sessionId)
        const liveBefore = liveWorkingCountFor(sessionId)
        s.conversations = s.conversations.map(conversation => {
          if (conversation.id !== sessionId) return conversation
          return {
            ...conversation,
            subagentTasks: projectSubagentBackfill(
              conversation.subagentTasks ?? [],
              incoming,
              hold,
            ).tasks,
          }
        })
        const liveAfter = liveWorkingCountFor(sessionId)
        reconcileParentRun(sessionId, {
          workingJustEmptied: liveBefore > 0 && liveAfter === 0,
        })
        return
      }
      if (type === 'destructive.blocked') {
        // The command did not run. The reader and the model both need the reason so
        // the next attempt can change; do not summarise it away.
        const reason = String(
          (event.payload as unknown as { reason?: string; notice?: string })?.reason
          ?? (event.payload as unknown as { notice?: string })?.notice
          ?? '',
        ).trim()
        pushEngineNotice(reason
          ? t(`已拦截一条删除命令：${reason} —— 未执行。`, `Refused a delete command: ${reason} - nothing ran.`)
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
      const mapped = s.conversations.map(conversation => {
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
          if (normalizeAgentKernel(conversation.kernel) === 'dsh') {
            void refreshDshCommands(sessionId)
            const pendingGoal = pendingDshGoals.get(sessionId)
            if (pendingGoal) {
              pendingDshGoals.delete(sessionId)
              void invokeCommand('control_dsh_goal', {
                conversationId: sessionId,
                action: 'create',
                objective: pendingGoal,
              }).catch(() => undefined)
            }
          }
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
          // 新回合开始 ⇒ 上一回合的"没干净跑完"标记翻篇（完成通知按回合判）。
          turnNotCleanIds.delete(String(sessionId ?? '').trim())
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
          // 审批卡到了 ⇒ 这个会话在等读者拍板：发一条 needs-input 系统通知。
          // 去重由外壳侧负责 ✓，这里不写第二套 ✗；这是状态变化处的一次调用，不轮询 ✗。
          notifyTaskIfNeeded(
            {
              conversation: { id: sessionId, title: conversation?.title, messages },
              // 开关来自设置（现读 ✗ 快照）：读不到就回落默认，不抛 ✗。
              // 来源由外壳注入（setTaskNotifySource）；没有注入时用默认。
              enabled: taskNotifySource?.() ?? defaultTaskNotifySwitch(),
            },
            {
              invoke: (method, args) => (
                window as unknown as {
                  milksu?: { invoke?: (method: string, args: Record<string, unknown>) => unknown }
                }
              ).milksu?.invoke?.(method, args),
              // 会话级前台压制：现读"正在看的会话"随 args 透传给外壳。
              activeConversationId: activeConversationIdForNotify(),
            },
          )
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
            if (!content.trim()) {
              const retained = retainAssistantAfterEmptyCompletion(last)
              if (retained) messages[messages.length - 1] = retained
              else messages.pop()
            }
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
            if (!content.trim()) {
              const retained = retainAssistantAfterEmptyCompletion(last)
              if (retained) messages[messages.length - 1] = retained
              else messages.pop()
            }
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
            if (!last.content.trim()) {
              const retained = retainAssistantAfterEmptyCompletion(last)
              if (retained) messages[messages.length - 1] = retained
              else messages.pop()
            }
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
          // 回合干净跑完 ⇒ 「任务已完成」通知（走 completed 开关，**默认关** ⇒ 默认不打扰）。
          // 失败/中止的回合已由 engine.error 路径标记 ⇒ 这里跳过，同一回合不报两次。
          const settledConversationId = String(sessionId ?? '').trim()
          if (settledConversationId && !turnNotCleanIds.has(settledConversationId)) {
            notifyCompletedTurn(settledConversationId)
          }
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
          // ImageGen failures must leave a recoverable assistant bubble. Otherwise the
          // Images rail can sit on a missing preview while the error stays buried in
          // a collapsed tool group.
          if (
            type === 'tool.completed'
            && toolName === 'milksu_imagegen'
            && String(error ?? '').trim()
          ) {
            const detail = redactProviderCredentials(String(error).trim()).slice(0, 800)
            const bubble = t(
              `生图失败：${detail}`,
              `ImageGen failed: ${detail}`,
            )
            const lastMessage = messages.at(-1)
            if (lastMessage?.role !== 'assistant' || lastMessage.content !== bubble) {
              messages.push({
                id: crypto.randomUUID(),
                role: 'assistant',
                content: bubble,
                timestamp: Date.now(),
                status: 'done',
              })
            }
          }
        } else if (type === 'session.model_source_unavailable') {
          const payload = event.payload as unknown as { notice?: string; message?: string }
          const text = String(payload?.notice ?? payload?.message ?? '').trim()
          if (text) pushEngineNotice(text)
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
          const erroredConversation = s.conversations.find(item => item.id === sessionId)
          const failedSource = String(modelSource ?? '').trim()
            || String(erroredConversation?.modelSource ?? '').trim()
          const bubble = agentEngineErrorBubble(error, {
            // The payload knows which source, provider and model actually ran; the conversation is
            // only a fallback for older engines that do not report them.
            provider: String(provider ?? '').trim() || erroredConversation?.modelProvider,
            model: String(model ?? '').trim() || erroredConversation?.modelId,
            source: failedSource,
            message: String(message ?? '').trim(),
          })
          // 任何 engine.error（含读者主动中止）⇒ 本回合不算干净跑完，完成通知要跳过它。
          turnNotCleanIds.add(String(sessionId ?? '').trim())
          if (!bubble.stopped) {
            // 运行失败 = 没能继续 ⇒ 失败类通知（读者主动停下不算失败 ✗）。
            const problemId = String(sessionId ?? '').trim()
            // 判据必须在**写之前**读：同一份失败内容重复投递（引擎重发）不再打扰；
            // 内容不同的新失败必须照发。
            const existingNotice = failedNoticeByConversation.get(problemId)
            const alreadySameProblem = isAlreadySameProblem({ existing: existingNotice ? { notice: existingNotice } : undefined, notice: bubble.content })
            failedNoticeByConversation.set(problemId, bubble.content)
            notifyRunFailure({ conversationId: problemId, alreadySameProblem })
          }
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
      const released = heldSubagentSnapshots.get(sessionId)
      if (released && !subagentBackfillHeld(sessionId)) {
        heldSubagentSnapshots.delete(sessionId)
        s.conversations = mapped.map(conversation => (
          conversation.id === sessionId
            ? { ...conversation, subagentTasks: released }
            : conversation
        ))
      } else {
        s.conversations = mapped
      }
      scheduleSave(sessionId)
      reconcileParentRun(sessionId)
    })
  }

  function dispose() {
    stopDraftWatch()
    stopWatchActiveId()
    disposeEvents?.()
    disposeEvents = undefined
    disposeConversationList?.()
    disposeConversationList = undefined
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
    get problemConversationIds() { return problemConversationIds() },
    conversationHasProblem,
    dismissProblemTurn,
    get activeProblemTurn() { return activeProblemTurn() },
    get backgroundTasks() { return s.backgroundTasks },
    get backgroundTaskOutcome() { return s.backgroundTaskOutcome },
    get activeAborting() { return activeAborting() },
    get activeAbortStalled() { return activeAbortStalled() },
    get activeMessageQueue() { return activeMessageQueue() },
    get activeQueuedGuidanceStalled() { return activeQueuedGuidanceStalled() },
    get streamStale() { return streamStale() },
    get streamStaleSeconds() { return streamStaleSeconds() },
    get activeToolRunning() { return activeToolRunning() },
    get activeEngineAlive() { return activeEngineAlive() },
    get activeQueuedBehind() { return activeQueuedBehind() },
    get activeStallKind() { return activeStallKind() },
    get activeEngineUnresponsive() { return activeEngineUnresponsive() },
    get activeEngineWarning() { return activeEngineWarning() },
    forceStopConversation,
    wakeStuckTurn,
    restartEngine,
    get engineNotice() { return s.engineNotice },
    get engineNoticeRepeat() { return s.engineNoticeRepeat },
    get busySend() { return s.busySend },
    get selectedKernel() { return selectedKernel() },
    get selectedModelMode() { return selectedModelMode() },
    get selectedModelProvider() { return selectedModelProvider() },
    get selectedModelId() { return selectedModelId() },
    get selectedThinkingLevel() { return selectedThinkingLevel() },
    get selectedModelSourcePreference() { return selectedModelSourcePreference() },
    get selectedExecutionMode() { return selectedExecutionMode() },
    get selectedApprovalPolicy() { return selectedApprovalPolicy() },
    get selectedMultitask() { return selectedMultitask() },
    get selectedMCPServers() { return selectedMCPServers() },
    get selectedMCPConfigDigest() { return selectedMCPConfigDigest() },
    get conversationActionError() { return s.conversationActionError },
    get pendingComposerDraft() { return s.pendingComposerDraft },
    get pendingWorkspaceHome() { return s.pendingWorkspaceHome },
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
    forkConversation,
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
    resumePendingHome,
    ensureConversation,
    setWorkspace,
    clearWorkspace,
    setDefaultKernel,
    setBusySend,
    toggleDshPlanMode,
    setMultitask,
    abortWorkingItem,
    abortWorkingAll,
    setKernel,
    setModelSelection,
    setThinkingLevel,
    setModelSourcePreference,
    setCodingPolicy,
    setMCPSelection,
    startWorkspaceTask,
    stageComposerDraft,
    consumeComposerDraft,
    flushPendingSaves,
    prepareConversationsForUpdateRestart,
    notifyTurnStall,
    /**
     * App 挂载后把“现读设置”的函数注进来（运行时读 ⇒ 读者改开关即时生效 ✓）。
     * 不传快照、不新开全局状态：只在运行时里留一个槽位 ✓。
     */
    setTaskNotifySource: (source?: () => { needsInput: boolean; failed: boolean; completed: boolean; stalled?: boolean; sound?: boolean } | undefined) => {
      taskNotifySource = source
    },
  }
}


export function useConversations(
  readTaskNotify?: () => { needsInput: boolean; failed: boolean; completed: boolean; stalled?: boolean; sound?: boolean } | undefined,
) {
  return createConversationsRuntime({ readTaskNotify })
}

export type ConversationsRuntime = ReturnType<typeof createConversationsRuntime>
