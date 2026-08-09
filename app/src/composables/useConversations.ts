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
import type {
  CodingApprovalPolicy,
  CodingAttachment,
  CodingCapability,
  CodingExecutionMode,
  CodingGoalState,
  Conversation,
  Message,
} from '@/types'

const BROWSER_USE_MCP_SERVER = 'milksu-playwright-user'
type ComposerScopeToken = 'browser-use' | 'computer-use'

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
  policy: {
    mode: 'coach' | 'copilot' | 'delegate'
  }
  role: 'solver' | 'tool-builder' | 'strategist'
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
  const pendingExecutionMode = ref<CodingExecutionMode>(DEFAULT_CODING_EXECUTION_MODE)
  const pendingApprovalPolicy = ref<CodingApprovalPolicy>(DEFAULT_CODING_APPROVAL_POLICY)
  const pendingMCPServers = ref<string[]>([])
  const pendingMCPConfigDigest = ref('')
  const runningIds = ref(new Set<string>())
  const abortingIds = ref(new Set<string>())
  const continuity = ref<CodingContinuityState>(createCodingContinuityState())
  const active = computed(() => conversations.value.find(item => item.id === activeId.value) ?? null)
  const workspacePath = computed(() => active.value?.workspacePath ?? pendingWorkspacePath.value)
  const activeRunning = computed(() => (
    activeId.value ? runningIds.value.has(activeId.value) : false
  ))
  const activeAborting = computed(() => (
    activeId.value ? abortingIds.value.has(activeId.value) : false
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

  async function remove(id: string) {
    await invokeCommand('delete_conversation', { id })
    conversations.value = conversations.value.filter(conversation => conversation.id !== id)
    continuity.value = removeCodingContinuitySession(continuity.value, id)
    activeTurnPolicies.delete(id)
    finishRun(id)
    if (activeId.value === id) activeId.value = null
  }

  function startNew() {
    activeId.value = null
    pendingWorkspacePath.value = ''
    pendingModelMode.value = undefined
    pendingModelProvider.value = undefined
    pendingModelId.value = undefined
    pendingExecutionMode.value = DEFAULT_CODING_EXECUTION_MODE
    pendingApprovalPolicy.value = DEFAULT_CODING_APPROVAL_POLICY
    pendingMCPServers.value = []
    pendingMCPConfigDigest.value = ''
  }

  function ensureConversation(title = '新编码任务') {
    if (activeId.value) return activeId.value
    const conversationId = crypto.randomUUID()
    const conversation: Conversation = {
      id: conversationId,
      title: title.trim().slice(0, 40) || '新编码任务',
      createdAt: Date.now(),
      workspacePath: pendingWorkspacePath.value || undefined,
      modelMode: pendingModelMode.value,
      modelProvider: pendingModelProvider.value,
      modelId: pendingModelId.value,
      executionMode: pendingExecutionMode.value,
      approvalPolicy: pendingApprovalPolicy.value,
      mcpServers: pendingMCPServers.value.length ? pendingMCPServers.value : undefined,
      mcpConfigDigest: pendingMCPServers.value.length
        ? pendingMCPConfigDigest.value
        : undefined,
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
    const existing = conversations.value.find(item => item.id === task.conversationId)
    if (existing) {
      activeId.value = existing.id
      if (existing.workspacePath !== task.workspacePath || existing.title !== task.title) {
        update(existing.id, conversation => ({
          ...conversation,
          title: task.title,
          workspacePath: task.workspacePath,
          ctfJobId: task.jobId,
          ctfMode: task.policy.mode,
          ctfRole: task.role,
        }))
      } else if (
        existing.ctfJobId !== task.jobId
        || existing.ctfMode !== task.policy.mode
        || existing.ctfRole !== task.role
      ) {
        update(existing.id, conversation => ({
          ...conversation,
          ctfJobId: task.jobId,
          ctfMode: task.policy.mode,
          ctfRole: task.role,
        }))
      }
      if (!runningIds.value.has(existing.id)) {
        await send(task.prompt)
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
      messages: [],
    }
    conversations.value = [conversation, ...conversations.value]
    activeId.value = conversation.id
    pendingWorkspacePath.value = ''
    persist(conversation)
    await send(task.prompt)
  }

  async function send(
    text: string,
    visibleText = text,
    attachments: CodingAttachment[] = [],
    scopeToken?: ComposerScopeToken,
  ) {
    const prompt = text.trim()
    if (!prompt) return false
    const visiblePrompt = visibleText.trim() || prompt
    const message: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: visiblePrompt,
      timestamp: Date.now(),
      attachments: attachments.length ? attachments : undefined,
    }
    let conversationId = activeId.value
    if (!conversationId) {
      conversationId = crypto.randomUUID()
      const conversation: Conversation = {
        id: conversationId,
        title: visiblePrompt.slice(0, 40),
        createdAt: Date.now(),
        workspacePath: pendingWorkspacePath.value || undefined,
        modelMode: pendingModelMode.value,
        modelProvider: pendingModelProvider.value,
        modelId: pendingModelId.value,
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
        messages: [...conversation.messages, message],
      }))
    }

    runningIds.value = new Set(runningIds.value).add(conversationId)
    try {
      const conversation = conversations.value.find(item => item.id === conversationId)
      const requestedMCPServers = turnMCPServers(conversation?.mcpServers, scopeToken)
      await invokeCommand('send_message', {
        conversationId,
        prompt,
        workspacePath: conversation?.workspacePath ?? '',
        modelMode: conversation?.modelMode ?? '',
        modelProvider: conversation?.modelProvider ?? '',
        modelId: conversation?.modelId ?? '',
        executionMode: conversation?.executionMode ?? DEFAULT_CODING_EXECUTION_MODE,
        approvalPolicy: conversation?.approvalPolicy ?? DEFAULT_CODING_APPROVAL_POLICY,
        mcpServers: requestedMCPServers,
        mcpConfigDigest: conversation?.mcpConfigDigest ?? '',
        attachments,
      })
      return true
    } catch (reason) {
      finishRun(conversationId)
      update(conversationId, conversation => ({
        ...conversation,
        messages: [...conversation.messages, {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: `Agent 未启动：${agentErrorMessage(reason)}`,
          timestamp: Date.now(),
          status: 'done',
        }],
      }))
      return false
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
          ? `Agent 通信异常：${agentErrorMessage(error)}`
          : `Agent 已停止${error ? `：${agentErrorMessage(error)}` : '。'}`
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
        for (const id of affected) scheduleSave(id)
        return
      }
      if (!sessionId) return
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
        if (type === 'session.goal_updated') {
          return {
            ...conversation,
            agentGoal: normalizeGoal(goal),
          }
        }
        if (type === 'assistant.started') {
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
          finishRun(sessionId)
        } else if (type === 'assistant.settled') {
          if (last?.role === 'assistant' && last.status === 'running') {
            messages[messages.length - 1] = { ...last, status: 'done' }
          }
          finishRun(sessionId)
        } else if (type === 'tool.started' || type === 'tool.completed') {
          if (
            last?.role === 'tool'
            && last.toolName === toolName
            && last.status === 'running'
            && (!toolCallId || !last.toolCallId || last.toolCallId === toolCallId)
          ) {
            messages[messages.length - 1] = {
              ...last,
              content: text
                ? [last.content, text].filter(Boolean).join('\n\n')
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
              content: text,
              timestamp: Date.now(),
              toolName,
              toolCallId,
              durationMs: type === 'tool.completed' ? durationMs : undefined,
              status: type === 'tool.completed' || done ? 'done' : 'running',
            })
          }
        } else if (type === 'engine.error') {
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
            content: `Agent 运行失败：${agentErrorMessage(error)}`,
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
    selectedModelMode,
    selectedModelProvider,
    selectedModelId,
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
    startNew,
    ensureConversation,
    setWorkspace,
    setModelSelection,
    setCodingPolicy,
    setMCPSelection,
    startWorkspaceTask,
    activeSessionReady,
    activeResumed,
    activeCompacting,
    activeCompactedAt,
    activeCompactionError,
  }
}
