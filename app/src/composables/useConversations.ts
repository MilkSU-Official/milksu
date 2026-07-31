import { computed, onBeforeUnmount, ref } from 'vue'
import { invokeCommand, listenEvent } from '@/desktop'
import type { Conversation, Message } from '@/types'

interface AgentEvent {
  sessionId?: string
  type: string
  text?: string
  toolName?: string
  error?: string
  done?: boolean
  tools?: string[]
  extensions?: string[]
  skills?: string[]
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

function normalizeConversation(raw: Record<string, unknown>): Conversation {
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
    agentTools: Array.isArray(raw.agentTools)
      ? raw.agentTools.map(String)
      : undefined,
    agentExtensions: Array.isArray(raw.agentExtensions)
      ? raw.agentExtensions.map(String)
      : undefined,
    agentSkills: Array.isArray(raw.agentSkills)
      ? raw.agentSkills.map(String)
      : undefined,
    ctfJobId: typeof raw.ctfJobId === 'string' ? raw.ctfJobId : undefined,
    ctfMode: ['coach', 'copilot', 'delegate'].includes(String(raw.ctfMode))
      ? raw.ctfMode as Conversation['ctfMode']
      : undefined,
    ctfRole: ['solver', 'tool-builder', 'strategist'].includes(String(raw.ctfRole))
      ? raw.ctfRole as Conversation['ctfRole']
      : undefined,
    messages: messages.map(message => ({
      id: String(message.id ?? crypto.randomUUID()),
      role: message.role as Message['role'],
      content: String(message.content ?? ''),
      timestamp: Number(message.timestamp ?? Date.now()),
      toolName: message.toolName as string | undefined,
      status: (message.status as Message['status']) ?? 'done',
    })),
  }
}

function agentErrorMessage(value: unknown) {
  const firstLine = String(value ?? 'Agent engine failed').split(/\r?\n/, 1)[0].trim()
  const message = firstLine.replace(/^(?:Error:\s*)+/i, '').trim()
  if (/no API key is configured|No API key for/i.test(message)) {
    return '当前模型没有可用的 API Key，请在“授权与模型”中保存并验证。'
  }
  if (/Model not found/i.test(message)) {
    return '当前模型不受 PI 运行时支持，请在“授权与模型”中更换模型并验证。'
  }
  if (/produced no model or tool activity/i.test(message)) {
    return '模型长时间没有产生文本或工具进展，本回合已停止。工作区和证据都已保留，点击继续即可从断点恢复。'
  }
  return message || 'Agent engine failed'
}

export function useConversations() {
  const conversations = ref<Conversation[]>([])
  const activeId = ref<string | null>(null)
  const pendingWorkspacePath = ref('')
  const pendingModelMode = ref<'auto' | 'manual' | undefined>()
  const pendingModelProvider = ref<string | undefined>()
  const pendingModelId = ref<string | undefined>()
  const runningIds = ref(new Set<string>())
  const active = computed(() => conversations.value.find(item => item.id === activeId.value) ?? null)
  const workspacePath = computed(() => active.value?.workspacePath ?? pendingWorkspacePath.value)
  const activeRunning = computed(() => (
    activeId.value ? runningIds.value.has(activeId.value) : false
  ))
  const selectedModelMode = computed(() => active.value?.modelMode ?? pendingModelMode.value)
  const selectedModelProvider = computed(() => active.value?.modelProvider ?? pendingModelProvider.value)
  const selectedModelId = computed(() => active.value?.modelId ?? pendingModelId.value)
  const saveTimers = new Map<string, number>()
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

  async function remove(id: string) {
    await invokeCommand('delete_conversation', { id })
    conversations.value = conversations.value.filter(conversation => conversation.id !== id)
    if (activeId.value === id) activeId.value = null
  }

  function startNew() {
    activeId.value = null
    pendingWorkspacePath.value = ''
    pendingModelMode.value = undefined
    pendingModelProvider.value = undefined
    pendingModelId.value = undefined
  }

  function setWorkspace(path: string) {
    const normalized = path.trim()
    if (!normalized) return
    if (!activeId.value) {
      pendingWorkspacePath.value = normalized
      return
    }
    update(activeId.value, conversation => ({
      ...conversation,
      workspacePath: normalized,
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

  async function send(text: string) {
    const prompt = text.trim()
    if (!prompt) return
    const message: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: prompt,
      timestamp: Date.now(),
    }
    let conversationId = activeId.value
    if (!conversationId) {
      conversationId = crypto.randomUUID()
      const conversation: Conversation = {
        id: conversationId,
        title: prompt.slice(0, 40),
        createdAt: Date.now(),
        workspacePath: pendingWorkspacePath.value || undefined,
        modelMode: pendingModelMode.value,
        modelProvider: pendingModelProvider.value,
        modelId: pendingModelId.value,
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
      await invokeCommand('send_message', {
        conversationId,
        prompt,
        workspacePath: conversation?.workspacePath ?? '',
        modelMode: conversation?.modelMode ?? '',
        modelProvider: conversation?.modelProvider ?? '',
        modelId: conversation?.modelId ?? '',
      })
    } catch (reason) {
      const nextRunning = new Set(runningIds.value)
      nextRunning.delete(conversationId)
      runningIds.value = nextRunning
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
    }
  }

  async function abort(id: string) {
    await invokeCommand('abort_message', { conversationId: id })
    const nextRunning = new Set(runningIds.value)
    nextRunning.delete(id)
    runningIds.value = nextRunning
  }

  async function listen() {
    disposeEvents = await listenEvent<AgentEvent>('engine-event', event => {
      const {
        sessionId,
        type,
        text = '',
        toolName,
        error,
        done,
        tools,
        extensions,
        skills,
      } = event.payload
      if (!sessionId && (type === 'engine.stopped' || type === 'engine.protocol_error')) {
        const affected = [...runningIds.value]
        const message = type === 'engine.protocol_error'
          ? `Agent 通信异常：${agentErrorMessage(error)}`
          : `Agent 已停止${error ? `：${agentErrorMessage(error)}` : '。'}`
        conversations.value = conversations.value.map(conversation => (
          affected.includes(conversation.id)
            ? {
                ...conversation,
                messages: [...conversation.messages, {
                  id: crypto.randomUUID(),
                  role: 'assistant' as const,
                  content: message,
                  timestamp: Date.now(),
                  status: 'done' as const,
                }],
              }
            : conversation
        ))
        runningIds.value = new Set()
        for (const id of affected) scheduleSave(id)
        return
      }
      if (!sessionId) return
      conversations.value = conversations.value.map(conversation => {
        if (conversation.id !== sessionId) return conversation
        const messages = [...conversation.messages]
        const last = messages.at(-1)

        if (type === 'session.ready') {
          return {
            ...conversation,
            agentTools: tools ?? conversation.agentTools,
            agentExtensions: extensions ?? conversation.agentExtensions,
            agentSkills: skills ?? conversation.agentSkills,
          }
        }
        if (type === 'assistant.delta') {
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
          const nextRunning = new Set(runningIds.value)
          nextRunning.delete(sessionId)
          runningIds.value = nextRunning
        } else if (type === 'tool.started' || type === 'tool.completed') {
          if (last?.role === 'tool' && last.toolName === toolName && last.status === 'running') {
            messages[messages.length - 1] = {
              ...last,
              content: text
                ? [last.content, text].filter(Boolean).join('\n\n')
                : last.content,
              status: type === 'tool.completed' || done ? 'done' : 'running',
            }
          } else {
            messages.push({
              id: crypto.randomUUID(),
              role: 'tool',
              content: text,
              timestamp: Date.now(),
              toolName,
              status: type === 'tool.completed' || done ? 'done' : 'running',
            })
          }
        } else if (type === 'engine.error') {
          const nextRunning = new Set(runningIds.value)
          nextRunning.delete(sessionId)
          runningIds.value = nextRunning
          messages.push({
            id: crypto.randomUUID(),
            role: 'assistant',
            content: `Agent 运行失败：${agentErrorMessage(error)}`,
            timestamp: Date.now(),
            status: 'done',
          })
        }
        return { ...conversation, messages }
      })
      scheduleSave(sessionId)
    })
  }

  onBeforeUnmount(() => {
    disposeEvents?.()
    for (const timer of saveTimers.values()) window.clearTimeout(timer)
    saveTimers.clear()
  })

  return {
    conversations,
    activeId,
    active,
    workspacePath,
    activeRunning,
    selectedModelMode,
    selectedModelProvider,
    selectedModelId,
    load,
    listen,
    send,
    abort,
    remove,
    startNew,
    setWorkspace,
    setModelSelection,
    startWorkspaceTask,
  }
}
