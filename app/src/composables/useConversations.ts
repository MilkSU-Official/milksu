import { computed, onBeforeUnmount, ref } from 'vue'
import { invokeCommand, listenEvent } from '@/desktop'
import type { CodingCompactionResult } from '@/codingEnvironmentTypes'
import {
  applyCodingContinuityEvent,
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
import { redactProviderCredentials } from '@/lib/redaction'
import { normalizeDomainTaskContext } from '@/lib/domainTaskContext'
import type {
  CodingApprovalPolicy,
  CodingAttachment,
  CodingCapability,
  CodingExecutionMode,
  CodingGoalState,
  CodingProductActionRequest,
  Conversation,
  Message,
} from '@/types'

const BROWSER_USE_MCP_SERVER = 'milksu-playwright-user'
const DEFAULT_CODING_CONVERSATION_TITLE = '新编码任务'
type ComposerScopeToken = 'browser-use' | 'computer-use'

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
  reason?: string
  goal?: CodingGoalState
  resumed?: boolean
  aborted?: boolean
  steering?: string[]
  followUp?: string[]
  modelSource?: 'account' | 'personal'
}

interface RuntimeTurnDispatch {
  prompt: string
  attachments: CodingAttachment[]
  scopeToken?: ComposerScopeToken
  productAction?: CodingProductActionRequest
}

export interface CodingMessageQueue {
  steering: string[]
  followUp: string[]
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
  /** When false/omitted, attach session + draft only — never auto-start Pi. */
  autoSend?: boolean
}

export interface PendingComposerDraft {
  prompt: string
  visibleText: string
}

export function normalizeConversation(raw: Record<string, unknown>): Conversation {
  const messages = (raw.messages as Record<string, unknown>[] | undefined) ?? []
  return {
    id: String(raw.id ?? ''),
    title: String(raw.title ?? '未命名对话'),
    createdAt: Number(raw.createdAt ?? 0),
    workspacePath: typeof raw.workspacePath === 'string' ? raw.workspacePath : undefined,
    modelMode: ['auto', 'manual'].includes(String(raw.modelMode))
      ? raw.modelMode as Conversation['modelMode']
      : undefined,
    modelProvider: typeof raw.modelProvider === 'string' ? raw.modelProvider : undefined,
    modelId: typeof raw.modelId === 'string' ? raw.modelId : undefined,
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
    ctfJobId: typeof raw.ctfJobId === 'string' ? raw.ctfJobId : undefined,
    ctfMode: ['coach', 'copilot', 'delegate'].includes(String(raw.ctfMode))
      ? raw.ctfMode as Conversation['ctfMode']
      : undefined,
    ctfRole: ['solver', 'tool-builder', 'strategist'].includes(String(raw.ctfRole))
      ? raw.ctfRole as Conversation['ctfRole']
      : undefined,
    domainTaskContext: normalizeDomainTaskContext(raw.domainTaskContext),
    messages: messages.map(message => {
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
        approvalReason: approvalState === 'expired'
          ? '应用或 Agent 已重启，本次审批已失效'
          : typeof message.approvalReason === 'string'
            ? message.approvalReason
            : undefined,
        attachments: normalizeAttachments(message.attachments),
      }
    }),
  }
}

export function agentErrorMessage(value: unknown) {
  const firstLine = String(value ?? 'Agent engine failed').split(/\r?\n/, 1)[0].trim()
  const message = redactProviderCredentials(
    firstLine.replace(/^(?:Error:\s*)+/i, '').trim(),
  )
  if (/no API key is configured|No API key for/i.test(message)) {
    return '当前模型没有可用的 API Key，请在“授权与模型”中保存并验证。'
  }
  if (/Model not found/i.test(message)) {
    return '当前模型不受 PI 运行时支持，请在“授权与模型”中更换模型并验证。'
  }
  if (
    /ECONNREFUSED|ECONNRESET|ENOTFOUND|ETIMEDOUT|network is unreachable|connection refused|fetch failed|dial tcp/i
      .test(message)
  ) {
    return '模型或 Agent 网络连接失败。请检查网络、Provider Base URL、本地代理或服务状态；工作区、审批和恢复点已保留，可以稍后继续。'
  }
  if (/produced no model or tool activity/i.test(message)) {
    return '模型长时间没有产生文本或工具进展，本回合已停止。工作区和证据都已保留，点击继续即可从断点恢复。'
  }
  return message || 'Agent engine failed'
}

function missingPiSession(value: unknown) {
  return /PI session not found|PI Sidecar is not running/i.test(String(value ?? ''))
}

export function agentRuntimeErrorMessage(value: unknown) {
  const raw = String(value ?? '')
  const normalized = agentErrorMessage(value)
  if (/具体路径|explicit path|可解析的具体路径/i.test(raw)) {
    return '请告诉我一个具体的本地目录路径，例如 ~/code/project；确认后我会把它授权给当前会话。'
  }
  if (/filesystem root|whole user directory|整个用户目录|磁盘根目录/i.test(raw)) {
    return '不能把整个磁盘或用户主目录授权给 Agent，请指定一个具体的项目目录。'
  }
  if (/must have a primary workspace|还没有工作区/i.test(raw)) {
    return '当前会话还没有工作区。请先选择或创建一个项目，再授权其他目录。'
  }
  if (/CTF Agent directory scope/i.test(raw)) {
    return 'CTF 会话不能扩大 Coding 目录权限；请在 Coding 中打开对应项目。'
  }
  if (/project access is (?:not|no longer) authorized|目录权限.*(?:未授权|已撤销)/i.test(raw)) {
    return '当前会话没有这个目录的权限。请明确授权具体路径后再试。'
  }
  if (/supports at most 8 additional project directories|limited to 8 additional directories/i.test(raw)) {
    return '当前会话最多可授权 8 个额外目录；请先撤销不再需要的目录。'
  }
  if (/resolve Coding Agent project|open Coding Agent project|project must be a directory/i.test(raw)) {
    return 'MilkSU 无法打开该目录。请确认路径存在、指向文件夹，并且当前用户可以访问。'
  }
  if (/Access to this API has been restricted|--allow-fs-(?:read|write)|ERR_ACCESS_DENIED/i.test(raw)) {
    return '本地 Agent 权限组件启动失败。当前任务已保留，请重试；如果仍然失败，可以在设置中导出诊断。'
  }
  if (/\b401\b|unauthori[sz]ed|invalid api key|authentication failed/i.test(raw)) {
    return '当前模型凭据已失效或无权访问。请重新登录，或在设置中更新模型凭据后重试。'
  }
  if (/baseUrl.*required|required.*baseUrl/i.test(raw)) {
    return '当前模型连接尚未准备好。请刷新模型配置后重试；任务和工作区状态已保留。'
  }
  if (/context_length_exceeded|maximum context length|context (?:window|length)|token limit exceeded|too many tokens|上下文(?:窗口|过长|长度)/i.test(raw)) {
    return '当前对话上下文已满。本轮已停止，整理上下文后可以从断点继续。'
  }
  if (/abort(?:ed)?|cancel(?:led|ed)|interrupted|context canceled|用户已中断|用户取消/i.test(raw)) {
    return '本轮已停止，已经完成的修改和工具结果都已保留。'
  }
  if (
    /no API key is configured|No API key for|Model not found|ECONNREFUSED|ECONNRESET|ENOTFOUND|ETIMEDOUT|network is unreachable|connection refused|fetch failed|dial tcp|produced no model or tool activity/i
      .test(raw)
  ) {
    return normalized
  }
  return 'Agent 遇到本地运行时异常。当前任务已保留，请重试；如果仍然失败，可以在设置中导出诊断。'
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
  return redactProviderCredentials(text || raw) || '工具执行失败。'
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

export function useConversations() {
  const conversations = ref<Conversation[]>([])
  const activeId = ref<string | null>(null)
  const pendingWorkspacePath = ref('')
  const pendingModelMode = ref<'auto' | 'manual' | undefined>()
  const pendingModelProvider = ref<string | undefined>()
  const pendingModelId = ref<string | undefined>()
  const pendingModelSourcePreference = ref<'auto' | 'account' | 'personal'>('auto')
  const pendingExecutionMode = ref<CodingExecutionMode>(DEFAULT_CODING_EXECUTION_MODE)
  const pendingApprovalPolicy = ref<CodingApprovalPolicy>(DEFAULT_CODING_APPROVAL_POLICY)
  const pendingMCPServers = ref<string[]>([])
  const pendingMCPConfigDigest = ref('')
  const runningIds = ref(new Set<string>())
  const abortingIds = ref(new Set<string>())
  const messageQueues = ref(new Map<string, CodingMessageQueue>())
  const continuity = ref<CodingContinuityState>(createCodingContinuityState())
  const active = computed(() => conversations.value.find(item => item.id === activeId.value) ?? null)
  const workspacePath = computed(() => active.value?.workspacePath ?? pendingWorkspacePath.value)
  const activeRunning = computed(() => (
    activeId.value ? runningIds.value.has(activeId.value) : false
  ))
  const activeAborting = computed(() => (
    activeId.value ? abortingIds.value.has(activeId.value) : false
  ))
  const activeMessageQueue = computed<CodingMessageQueue>(() => (
    activeId.value
      ? messageQueues.value.get(activeId.value) ?? { steering: [], followUp: [] }
      : { steering: [], followUp: [] }
  ))
  const activeResumed = computed(() => (
    activeId.value ? continuity.value.resumed.has(activeId.value) : false
  ))
  const activeSessionReady = computed(() => (
    activeId.value ? continuity.value.ready.has(activeId.value) : false
  ))
  const activeCompacting = computed(() => (
    activeId.value ? continuity.value.compacting.has(activeId.value) : false
  ))
  const activeCompactedAt = computed(() => (
    activeId.value ? continuity.value.compactedAt.get(activeId.value) : undefined
  ))
  const activeCompactionError = computed(() => (
    activeId.value ? continuity.value.errors.get(activeId.value) : undefined
  ))
  const selectedModelMode = computed(() => active.value?.modelMode ?? pendingModelMode.value)
  const selectedModelProvider = computed(() => active.value?.modelProvider ?? pendingModelProvider.value)
  const selectedModelId = computed(() => active.value?.modelId ?? pendingModelId.value)
  const selectedModelSourcePreference = computed(() => (
    active.value?.modelSourcePreference ?? pendingModelSourcePreference.value
  ))
  const selectedExecutionMode = computed(() => (
    active.value?.executionMode ?? pendingExecutionMode.value
  ))
  const selectedApprovalPolicy = computed(() => (
    active.value?.approvalPolicy ?? pendingApprovalPolicy.value
  ))
  const selectedMCPServers = computed(() => (
    active.value?.mcpServers ?? pendingMCPServers.value
  ))
  const selectedMCPConfigDigest = computed(() => (
    active.value?.mcpConfigDigest ?? pendingMCPConfigDigest.value
  ))
  const saveTimers = new Map<string, number>()
  const activeTurnPolicies = new Set<string>()
  const titleGenerationAttemptedIds = new Set<string>()
  let disposeEvents: (() => void) | undefined

  function persist(conversation: Conversation) {
    void invokeCommand('save_conversation', { conversation }).catch(console.error)
  }

  function scheduleSave(conversationId: string) {
    const existingTimer = saveTimers.get(conversationId)
    if (existingTimer) window.clearTimeout(existingTimer)
    const timer = window.setTimeout(() => {
      saveTimers.delete(conversationId)
      const conversation = conversations.value.find(item => item.id === conversationId)
      if (conversation) persist(conversation)
    }, 400)
    saveTimers.set(conversationId, timer)
  }

  async function load() {
    const stored = await invokeCommand<Record<string, unknown>[]>('list_conversations')
    conversations.value = stored.map(normalizeConversation)
  }

  function update(id: string, updater: (conversation: Conversation) => Conversation) {
    conversations.value = conversations.value.map(conversation => (
      conversation.id === id ? updater(conversation) : conversation
    ))
    const updated = conversations.value.find(conversation => conversation.id === id)
    if (updated) persist(updated)
  }

  function finishRun(id: string) {
    const next = projectCodingRunFinished(
      runningIds.value,
      abortingIds.value,
      id,
    )
    runningIds.value = next.running
    abortingIds.value = next.aborting
  }

  async function invokeRuntimeTurn(
    conversationId: string,
    dispatch: RuntimeTurnDispatch,
  ) {
    const conversation = conversations.value.find(item => item.id === conversationId)
    if (!conversation) throw new Error('Coding conversation is unavailable')
    await invokeCommand('save_conversation', { conversation })
    await invokeCommand('send_message', {
      conversationId,
      prompt: dispatch.prompt,
      workspacePath: conversation.workspacePath ?? '',
      modelMode: conversation.modelMode ?? '',
      modelProvider: conversation.modelProvider ?? '',
      modelId: conversation.modelId ?? '',
      modelSourcePreference: conversation.modelSourcePreference ?? 'auto',
      executionMode: conversation.executionMode ?? DEFAULT_CODING_EXECUTION_MODE,
      approvalPolicy: conversation.approvalPolicy ?? DEFAULT_CODING_APPROVAL_POLICY,
      mcpServers: turnMCPServers(conversation.mcpServers, dispatch.scopeToken),
      mcpConfigDigest: conversation.mcpConfigDigest ?? '',
      attachments: dispatch.attachments,
      productAction: dispatch.productAction,
    })
  }

  function setMessageQueue(id: string, queue: CodingMessageQueue) {
    const next = new Map(messageQueues.value)
    if (queue.steering.length || queue.followUp.length) next.set(id, queue)
    else next.delete(id)
    messageQueues.value = next
  }

  async function remove(id: string) {
    await invokeCommand('delete_conversation', { id })
    conversations.value = conversations.value.filter(conversation => conversation.id !== id)
    titleGenerationAttemptedIds.delete(id)
    continuity.value = removeCodingContinuitySession(continuity.value, id)
    activeTurnPolicies.delete(id)
    setMessageQueue(id, { steering: [], followUp: [] })
    finishRun(id)
    if (activeId.value === id) activeId.value = null
  }

  const pendingComposerDraft = ref<PendingComposerDraft | null>(null)

  function stageComposerDraft(prompt: string, visibleText = prompt) {
    const nextPrompt = String(prompt ?? '').trim()
    if (!nextPrompt) {
      pendingComposerDraft.value = null
      return
    }
    pendingComposerDraft.value = {
      prompt: nextPrompt,
      visibleText: String(visibleText ?? '').trim() || nextPrompt,
    }
  }

  function consumeComposerDraft() {
    const draft = pendingComposerDraft.value
    pendingComposerDraft.value = null
    return draft
  }

  function startNew() {
    activeId.value = null
    pendingWorkspacePath.value = ''
    pendingModelMode.value = undefined
    pendingModelProvider.value = undefined
    pendingModelId.value = undefined
    pendingModelSourcePreference.value = 'auto'
    pendingExecutionMode.value = DEFAULT_CODING_EXECUTION_MODE
    pendingApprovalPolicy.value = DEFAULT_CODING_APPROVAL_POLICY
    pendingMCPServers.value = []
    pendingMCPConfigDigest.value = ''
    pendingComposerDraft.value = null
  }

  function ensureConversation(
    title = DEFAULT_CODING_CONVERSATION_TITLE,
    options: {
      domainTaskContext?: Conversation['domainTaskContext']
      conversationId?: string
      workspacePath?: string
    } = {},
  ) {
    const requestedId = String(options.conversationId ?? '').trim()
    const hasWorkspaceOverride = Object.prototype.hasOwnProperty.call(options, 'workspacePath')
    const workspaceOverride = String(options.workspacePath ?? '').trim() || undefined
    const clearsCTFContext = options.domainTaskContext?.kind === 'cve'
    if (requestedId) {
      const existing = conversations.value.find(item => item.id === requestedId)
      if (existing) {
        activeId.value = existing.id
        update(existing.id, conversation => ({
          ...conversation,
          title: title.trim().slice(0, 40) || conversation.title,
          workspacePath: hasWorkspaceOverride ? workspaceOverride : conversation.workspacePath,
          domainTaskContext: options.domainTaskContext ?? conversation.domainTaskContext,
          ctfJobId: clearsCTFContext ? undefined : conversation.ctfJobId,
          ctfMode: clearsCTFContext ? undefined : conversation.ctfMode,
          ctfRole: clearsCTFContext ? undefined : conversation.ctfRole,
        }))
        return existing.id
      }
    }
    if (activeId.value && !requestedId) {
      if (options.domainTaskContext) {
        update(activeId.value, conversation => ({
          ...conversation,
          domainTaskContext: options.domainTaskContext,
        }))
      }
      return activeId.value
    }
    const conversationId = requestedId || crypto.randomUUID()
    const conversation: Conversation = {
      id: conversationId,
      title: title.trim().slice(0, 40) || DEFAULT_CODING_CONVERSATION_TITLE,
      createdAt: Date.now(),
      workspacePath: hasWorkspaceOverride
        ? workspaceOverride
        : pendingWorkspacePath.value || undefined,
      modelMode: pendingModelMode.value,
      modelProvider: pendingModelProvider.value,
      modelId: pendingModelId.value,
      modelSourcePreference: pendingModelSourcePreference.value === 'auto'
        ? undefined
        : pendingModelSourcePreference.value,
      executionMode: pendingExecutionMode.value,
      approvalPolicy: pendingApprovalPolicy.value,
      mcpServers: pendingMCPServers.value.length ? pendingMCPServers.value : undefined,
      mcpConfigDigest: pendingMCPServers.value.length
        ? pendingMCPConfigDigest.value
        : undefined,
      domainTaskContext: options.domainTaskContext,
      messages: [],
    }
    conversations.value = [conversation, ...conversations.value]
    activeId.value = conversationId
    persist(conversation)
    return conversationId
  }

  function setWorkspace(path: string) {
    const normalized = path.trim()
    if (!normalized) return
    if (!activeId.value) {
      pendingWorkspacePath.value = normalized
      pendingMCPServers.value = []
      pendingMCPConfigDigest.value = ''
      return
    }
    update(activeId.value, conversation => ({
      ...conversation,
      workspacePath: normalized,
      mcpServers: undefined,
      mcpConfigDigest: undefined,
    }))
  }

  function setModelSelection(
    mode: 'auto' | 'manual',
    provider?: string,
    model?: string,
  ) {
    const normalizedProvider = provider?.trim() || undefined
    const normalizedModel = model?.trim() || undefined
    if (!activeId.value) {
      pendingModelMode.value = mode
      pendingModelProvider.value = mode === 'manual' ? normalizedProvider : undefined
      pendingModelId.value = mode === 'manual' ? normalizedModel : undefined
      return
    }
    update(activeId.value, conversation => ({
      ...conversation,
      modelMode: mode,
      modelProvider: mode === 'manual' ? normalizedProvider : undefined,
      modelId: mode === 'manual' ? normalizedModel : undefined,
    }))
  }

  function setModelSourcePreference(preference: 'auto' | 'account' | 'personal') {
    if (!activeId.value) {
      pendingModelSourcePreference.value = preference
      return
    }
    if (!activeId.value) return
    update(activeId.value, conversation => ({
      ...conversation,
      modelSourcePreference: preference === 'auto' ? undefined : preference,
    }))
  }

  function setCodingPolicy(
    executionMode: CodingExecutionMode,
    approvalPolicy: CodingApprovalPolicy,
  ) {
    if (!activeId.value) {
      pendingExecutionMode.value = executionMode
      pendingApprovalPolicy.value = approvalPolicy
      return
    }
    update(activeId.value, conversation => ({
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
    if (!activeId.value) {
      pendingMCPServers.value = normalizedServers
      pendingMCPConfigDigest.value = normalizedServers.length ? normalizedDigest : ''
      return
    }
    update(activeId.value, conversation => ({
      ...conversation,
      mcpServers: normalizedServers.length ? normalizedServers : undefined,
      mcpConfigDigest: normalizedServers.length ? normalizedDigest : undefined,
    }))
  }

  async function startWorkspaceTask(task: WorkspaceTask) {
    const autoSend = task.autoSend === true
    const existing = conversations.value.find(item => item.id === task.conversationId)
    if (existing) {
      activeId.value = existing.id
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
      if (autoSend) {
        if (!runningIds.value.has(existing.id)) {
          await send(task.prompt)
        }
      } else {
        stageComposerDraft(task.prompt, task.visibleText)
      }
      return
    }

    const conversation: Conversation = {
      id: task.conversationId,
      title: task.title,
      createdAt: Date.now(),
      workspacePath: task.workspacePath,
      ctfJobId: task.jobId,
      ctfMode: task.policy.mode,
      ctfRole: task.role,
      domainTaskContext: task.domainTaskContext,
      messages: [],
    }
    conversations.value = [conversation, ...conversations.value]
    activeId.value = conversation.id
    pendingWorkspacePath.value = ''
    persist(conversation)
    if (autoSend) {
      await send(task.prompt)
    } else {
      stageComposerDraft(task.prompt, task.visibleText)
    }
  }

  async function send(
    text: string,
    visibleText = text,
    attachments: CodingAttachment[] = [],
    scopeToken?: ComposerScopeToken,
    productAction?: CodingProductActionRequest,
  ) {
    const prompt = text.trim()
    if (!prompt) return false
    const visiblePrompt = visibleText.trim() || prompt
    const runningConversationId = activeId.value
    const steering = Boolean(
      runningConversationId && runningIds.value.has(runningConversationId),
    )
    if (steering && attachments.length) return false
    const message: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: visiblePrompt,
      timestamp: Date.now(),
      status: steering ? 'queued' : undefined,
      attachments: attachments.length ? attachments : undefined,
    }
    const fallbackTitle = fallbackConversationTitle(visiblePrompt)
    let conversationId = activeId.value
    if (!conversationId) {
      conversationId = crypto.randomUUID()
      const conversation: Conversation = {
        id: conversationId,
        title: fallbackTitle,
        createdAt: Date.now(),
        workspacePath: pendingWorkspacePath.value || undefined,
        modelMode: pendingModelMode.value,
        modelProvider: pendingModelProvider.value,
        modelId: pendingModelId.value,
        modelSourcePreference: pendingModelSourcePreference.value === 'auto'
          ? undefined
          : pendingModelSourcePreference.value,
        executionMode: pendingExecutionMode.value,
        approvalPolicy: pendingApprovalPolicy.value,
        mcpServers: pendingMCPServers.value.length ? pendingMCPServers.value : undefined,
        mcpConfigDigest: pendingMCPServers.value.length
          ? pendingMCPConfigDigest.value
          : undefined,
        messages: [message],
      }
      conversations.value = [conversation, ...conversations.value]
      activeId.value = conversationId
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

    if (steering) {
      try {
        await invokeCommand('steer_message', {
          conversationId,
          prompt,
        })
        const currentQueue = messageQueues.value.get(conversationId)
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
              content: `引导未加入当前回合：${agentErrorMessage(reason)}`,
              timestamp: Date.now(),
              status: 'done',
            }],
          }))
          return false
        }
      }
    }

    runningIds.value = new Set(runningIds.value).add(conversationId)
    try {
      let conversation = conversations.value.find(item => item.id === conversationId)
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
          conversation = conversations.value.find(item => item.id === conversationId)
        }
      }
      if (conversation) await invokeCommand('save_conversation', { conversation })
      const dispatch: RuntimeTurnDispatch = {
        prompt,
        attachments,
        scopeToken,
        productAction,
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
          content: `Agent 未启动：${agentRuntimeErrorMessage(reason)}`,
          timestamp: Date.now(),
          status: 'done',
        }],
      }))
      return false
    }
  }

  async function removeQueuedGuidance(index: number, edit: boolean) {
    const conversationId = activeId.value
    if (!conversationId || !Number.isInteger(index) || index < 0) return false
    const currentQueue = messageQueues.value.get(conversationId)
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
    const conversation = conversations.value.find(item => item.id === conversationId)
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
      const current = conversations.value.find(item => item.id === conversationId)
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

  async function abort(id: string) {
    const requested = projectCodingAbortRequest(
      runningIds.value,
      abortingIds.value,
      id,
    )
    if (!requested.accepted) return
    runningIds.value = requested.running
    abortingIds.value = requested.aborting
    try {
      // AbortMessage only submits the interrupt to the Sidecar. Keep the task
      // visibly running until its terminal engine event proves Pi is idle.
      await invokeCommand('abort_message', { conversationId: id })
    } catch (reason) {
      const nextAborting = new Set(abortingIds.value)
      nextAborting.delete(id)
      abortingIds.value = nextAborting
      update(id, conversation => ({
        ...conversation,
        messages: [...conversation.messages, {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: `停止 Agent 失败：${agentErrorMessage(reason)}`,
          timestamp: Date.now(),
          status: 'done',
        }],
      }))
    }
  }

  async function compactContext() {
    const conversationId = activeId.value
    if (
      !conversationId
      || runningIds.value.has(conversationId)
      || continuity.value.compacting.has(conversationId)
    ) return
    continuity.value = applyCodingContinuityEvent(
      continuity.value,
      conversationId,
      { type: 'runtime.compaction_started' },
    )
    try {
      await invokeCommand<CodingCompactionResult>('compact_coding_session', {
        conversationId,
      })
      continuity.value = applyCodingContinuityEvent(
        continuity.value,
        conversationId,
        { type: 'runtime.compaction_completed' },
      )
    } catch (reason) {
      continuity.value = applyCodingContinuityEvent(
        continuity.value,
        conversationId,
        {
          type: 'runtime.compaction_completed',
          error: codingCompactionErrorMessage(reason),
        },
      )
    }
  }

  async function controlGoal(action: 'pause' | 'resume' | 'clear') {
    const conversationId = activeId.value
    if (!conversationId || runningIds.value.has(conversationId)) return
    const conversation = conversations.value.find(item => item.id === conversationId)
    if (!conversation) return
    if (action === 'resume') {
      runningIds.value = new Set(runningIds.value).add(conversationId)
    }
    try {
      await invokeCommand('send_message', {
        conversationId,
        prompt: `/goal ${action}`,
        workspacePath: conversation.workspacePath ?? '',
        modelMode: conversation.modelMode ?? '',
        modelProvider: conversation.modelProvider ?? '',
        modelId: conversation.modelId ?? '',
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
          content: `目标操作失败：${agentErrorMessage(reason)}`,
          timestamp: Date.now(),
          status: 'done',
        }],
      }))
    }
  }

  async function respondApproval(requestId: string, approved: boolean) {
    const conversation = conversations.value.find(item => (
      item.messages.some(message => (
        message.approvalRequestId === requestId
        && message.approvalState === 'pending'
      ))
    ))
    if (!conversation) return
    try {
      await invokeCommand('respond_tool_approval', {
        conversationId: conversation.id,
        requestId,
        approved,
      })
      update(conversation.id, current => ({
        ...current,
        messages: current.messages.map(message => (
          message.approvalRequestId === requestId
            ? {
                ...message,
                status: 'done',
                approvalState: approved ? 'approved' : 'denied',
                approvalReason: approved ? '已允许本次操作' : '已拒绝本次操作',
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
                approvalReason: `审批失败：${agentErrorMessage(reason)}`,
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
        reason,
        goal,
        resumed,
        aborted,
        steering,
        followUp,
        modelSource,
      } = event.payload
      if (!sessionId && (type === 'engine.stopped' || type === 'engine.protocol_error')) {
        activeTurnPolicies.clear()
        const affected = [...runningIds.value]
        for (const compactingId of continuity.value.compacting) {
          continuity.value = applyCodingContinuityEvent(
            continuity.value,
            compactingId,
            {
              type: 'runtime.compaction_completed',
              error: 'Agent 进程已停止，本次整理已中断。',
            },
          )
        }
        const message = type === 'engine.protocol_error'
          ? `Agent 通信异常：${agentRuntimeErrorMessage(error)}`
          : `Agent 已停止${error ? `：${agentRuntimeErrorMessage(error)}` : '。'}`
        conversations.value = conversations.value.map(conversation => (
          affected.includes(conversation.id)
            ? {
                ...conversation,
                messages: [
                  ...conversation.messages.map(item => (
                    item.approvalState === 'pending'
                      ? {
                          ...item,
                          status: 'done' as const,
                          approvalState: 'expired' as const,
                          approvalReason: 'Agent 进程已结束，本次审批已失效',
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
        runningIds.value = new Set()
        abortingIds.value = new Set()
        messageQueues.value = new Map()
        for (const id of affected) scheduleSave(id)
        return
      }
      if (!sessionId) return
      if (type === 'session.queue_updated') {
        const previousQueue = messageQueues.value.get(sessionId)
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
        if (appliedSteeringCount > 0) {
          let remaining = appliedSteeringCount
          conversations.value = conversations.value.map(conversation => (
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
      conversations.value = conversations.value.map(conversation => {
        if (conversation.id !== sessionId) return conversation
        const messages = [...conversation.messages]
        const last = messages.at(-1)

        if (
          type === 'session.ready'
          || type === 'session.policy_updated'
          || type === 'session.turn_policy'
          || type === 'session.turn_policy_cleared'
        ) {
          continuity.value = applyCodingContinuityEvent(
            continuity.value,
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
            content: `引导未加入当前回合：${agentErrorMessage(error)}`,
            timestamp: Date.now(),
            status: 'done',
          })
        } else if (type === 'assistant.started') {
          runningIds.value = new Set(runningIds.value).add(sessionId)
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
          })
        } else if (type === 'approval.resolved' && requestId) {
          const approvalIndex = messages.findIndex(message => (
            message.approvalRequestId === requestId
          ))
          if (approvalIndex >= 0) {
            messages[approvalIndex] = {
              ...messages[approvalIndex],
              status: 'done',
              approvalState: approved ? 'approved' : 'denied',
              approvalReason: reason || (approved
                ? '已允许本次操作'
                : '已拒绝本次操作'),
            }
          }
        } else if (type === 'assistant.delta') {
          if (last?.role === 'assistant' && last.status === 'running') {
            messages[messages.length - 1] = { ...last, content: last.content + text }
          } else {
            messages.push({
              id: crypto.randomUUID(),
              role: 'assistant',
              content: text,
              timestamp: Date.now(),
              status: 'running',
            })
          }
        } else if (type === 'assistant.segment_completed') {
          if (last?.role === 'assistant' && last.status === 'running') {
            messages[messages.length - 1] = { ...last, content: text || last.content, status: 'done' }
          } else if (text) {
            messages.push({
              id: crypto.randomUUID(),
              role: 'assistant',
              content: text,
              timestamp: Date.now(),
              status: 'done',
            })
          }
        } else if (type === 'assistant.completed') {
          if (last?.role === 'assistant' && last.status === 'running') {
            messages[messages.length - 1] = { ...last, content: text || last.content, status: 'done' }
          } else {
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
            messages[messages.length - 1] = { ...last, status: 'done' }
          }
          setMessageQueue(sessionId, { steering: [], followUp: [] })
          finishRun(sessionId)
        } else if (type === 'tool.started' || type === 'tool.completed') {
          const toolText = type === 'tool.completed'
            ? agentToolResultMessage(text, error)
            : text
          if (
            last?.role === 'tool'
            && last.toolName === toolName
            && last.status === 'running'
            && (!toolCallId || !last.toolCallId || last.toolCallId === toolCallId)
          ) {
            messages[messages.length - 1] = {
              ...last,
              content: toolText
                ? [last.content, toolText].filter(Boolean).join('\n\n')
                : last.content,
              toolCallId: toolCallId || last.toolCallId,
              durationMs: type === 'tool.completed'
                ? durationMs
                : last.durationMs,
              status: type === 'tool.completed' || done ? 'done' : 'running',
            }
          } else {
            messages.push({
              id: crypto.randomUUID(),
              role: 'tool',
              content: toolText,
              timestamp: Date.now(),
              toolName,
              toolCallId,
              durationMs: type === 'tool.completed' ? durationMs : undefined,
              status: type === 'tool.completed' || done ? 'done' : 'running',
            })
          }
        } else if (type === 'engine.error') {
          setMessageQueue(sessionId, { steering: [], followUp: [] })
          finishRun(sessionId)
          for (let index = 0; index < messages.length; index++) {
            if (messages[index].approvalState === 'pending') {
              messages[index] = {
                ...messages[index],
                status: 'done',
                approvalState: 'expired',
                approvalReason: 'Agent 运行失败，本次审批已失效',
              }
            }
          }
          messages.push({
            id: crypto.randomUUID(),
            role: 'assistant',
            content: `Agent 运行失败：${agentRuntimeErrorMessage(error)}`,
            timestamp: Date.now(),
            status: 'done',
          })
        }
        if (type === 'runtime.compaction_started' || type === 'runtime.compaction_completed') {
          continuity.value = applyCodingContinuityEvent(
            continuity.value,
            sessionId,
            { type, aborted, error: error ? codingCompactionErrorMessage(error) : '' },
          )
          return conversation
        }
        return { ...conversation, messages }
      })
      scheduleSave(sessionId)
    })
  }

  onBeforeUnmount(() => {
    disposeEvents?.()
    activeTurnPolicies.clear()
    for (const timer of saveTimers.values()) window.clearTimeout(timer)
    saveTimers.clear()
  })

  return {
    conversations,
    activeId,
    active,
    workspacePath,
    activeRunning,
    activeAborting,
    activeMessageQueue,
    selectedModelMode,
    selectedModelProvider,
    selectedModelId,
    selectedModelSourcePreference,
    selectedExecutionMode,
    selectedApprovalPolicy,
    selectedMCPServers,
    selectedMCPConfigDigest,
    load,
    listen,
    send,
    abort,
    compactContext,
    controlGoal,
    respondApproval,
    remove,
    cancelQueuedGuidance,
    editQueuedGuidance,
    startNew,
    ensureConversation,
    setWorkspace,
    setModelSelection,
    setModelSourcePreference,
    setCodingPolicy,
    setMCPSelection,
    startWorkspaceTask,
    pendingComposerDraft,
    stageComposerDraft,
    consumeComposerDraft,
    activeSessionReady,
    activeResumed,
    activeCompacting,
    activeCompactedAt,
    activeCompactionError,
  }
}
