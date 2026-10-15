// @vitest-environment jsdom
// 「引擎重启」的两端接线：读者点按钮 ⇒ 后端重启命令真的发出；引擎重启事件 ⇒ 同 sidecar
// 的其它会话被结算，而不是永远停在「正在跑」。重启只由读者触发，这里也钉住「不自动重启」。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createConversationsRuntime } from '@/composables/useConversations'

type EventHandler = (event: { payload: unknown }) => void

const handlers = new Map<string, EventHandler>()
let stored: Record<string, unknown>[] = []

const invokeCommand = vi.fn(async (command: string, _args?: unknown) => {
  if (command === 'list_conversations') return stored
  if (command === 'get_coding_project_memory') return { recents: [], lastWorkspacePath: '' }
  return null
})

vi.mock('@/desktop', () => ({
  invokeCommand: (command: string, args?: unknown) => invokeCommand(command, args),
  listenEvent: vi.fn(async (name: string, handler: EventHandler) => {
    handlers.set(name, handler)
    return () => handlers.delete(name)
  }),
}))

function storedConversation(id: string, title = id) {
  return { id, title, createdAt: 1, workspacePath: '/tmp/engine-restart', messages: [] }
}

function emit(sessionId: string, payload: Record<string, unknown>) {
  handlers.get('engine-event')?.({ payload: { sessionId, ...payload } })
}

async function runtimeWithConversation() {
  const conversations = createConversationsRuntime()
  stored = [storedConversation('conversation-1', '卡住的会话')]
  await conversations.load()
  await conversations.listen()
  conversations.activeId = 'conversation-1'
  emit('conversation-1', { type: 'assistant.started' })
  return conversations
}

describe('useConversations 引擎重启', () => {
  beforeEach(() => {
    handlers.clear()
    invokeCommand.mockClear()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-17T00:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('读者点重启才发 restart_engine 命令，并本地结算这个回合', async () => {
    const conversations = await runtimeWithConversation()
    expect(conversations.activeRunning).toBe(true)
    await conversations.restartEngine('conversation-1')
    expect(invokeCommand).toHaveBeenCalledWith('restart_engine', { conversationId: 'conversation-1' })
    // 本地结算先发生：读者点完不该还卡在「正在跑」。
    expect(conversations.activeRunning).toBe(false)
  })

  it('引擎重启事件结算同一个 sidecar 服务的其它会话，并写清楚原因', async () => {
    const conversations = await runtimeWithConversation()
    emit('conversation-1', { type: 'engine.restarted', done: true })
    expect(conversations.activeRunning).toBe(false)
    const conversation = conversations.conversations.find(item => item.id === 'conversation-1')
    const last = conversation?.messages.at(-1)
    expect(last?.role).toBe('assistant')
    expect(String(last?.content)).toContain('引擎已重启')
  })
})
