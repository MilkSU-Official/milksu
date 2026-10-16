// @vitest-environment jsdom
// 权限向导自动触发的 store 接线（β.191 真机死循环修复）：agent 在对话里调
// milksu_workspace 的 lock_computer_use_window 撞权限守卫 ⇒ engine-event 的
// tool.completed 投影出全局信号，ChatPage 据此自动开三态向导。
// 事件形状 = Go normalizeBridgeEvent 的输出（internal/engine/supervisor.go 的
// tool_call_end case：IsError ⇒ error 与 text 同为守卫原文）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

const guardText = '请先明确授予 MilkSU 辅助功能与屏幕录制权限，再启动可见会话'

function emit(sessionId: string, payload: Record<string, unknown>) {
  handlers.get('engine-event')?.({ payload: { sessionId, ...payload } })
}

async function runtime() {
  // 直接建 runtime（不经 useConversations 包装）：这是 composable 测试，不需要 React，
  // 也免得「在普通函数里调 hook」的 lint 误报。
  const { createConversationsRuntime } = await import('@/composables/useConversations')
  const conversations = createConversationsRuntime()
  stored = [{ id: 'conversation-1', title: '撞墙会话', createdAt: 1, workspacePath: '', messages: [] }]
  await conversations.load()
  await conversations.listen()
  conversations.activeId = 'conversation-1'
  return conversations
}

describe('useConversations 锁窗权限守卫信号', () => {
  beforeEach(() => {
    handlers.clear()
    invokeCommand.mockClear()
    Object.defineProperty(window, 'milksu', { configurable: true, value: { invoke: vi.fn() } })
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-14T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('milksu_workspace 的 tool.completed 守卫失败 ⇒ 记信号；工具结果消息照常落地', async () => {
    const conversations = await runtime()
    emit('conversation-1', {
      type: 'tool.completed',
      toolName: 'milksu_workspace',
      toolCallId: 'call-1',
      text: guardText,
      error: guardText,
    })
    expect(conversations.computerUsePermissionGuard).toEqual({
      conversationId: 'conversation-1',
      notice: guardText,
      at: Date.now(),
    })
    // 不 return：失败的锁窗调用仍是 transcript 里的一条工具结果（对话保持自己的状态）。
    const messages = conversations.active?.messages ?? []
    expect(messages.some(message => String(message.content).includes(guardText))).toBe(true)
  })

  it('去抖：同会话窗口内反复撞墙只记第一次', async () => {
    const conversations = await runtime()
    emit('conversation-1', {
      type: 'tool.completed', toolName: 'milksu_workspace', text: guardText, error: guardText,
    })
    const firstAt = conversations.computerUsePermissionGuard?.at
    expect(firstAt).toBeDefined()
    await vi.advanceTimersByTimeAsync(10_000)
    emit('conversation-1', {
      type: 'tool.completed', toolName: 'milksu_workspace', text: guardText, error: guardText,
    })
    expect(conversations.computerUsePermissionGuard?.at).toBe(firstAt)
    // 出窗后再撞 ⇒ 重新记（还在等授权，向导该再弹）。
    await vi.advanceTimersByTimeAsync(30_000)
    emit('conversation-1', {
      type: 'tool.completed', toolName: 'milksu_workspace', text: guardText, error: guardText,
    })
    expect(conversations.computerUsePermissionGuard?.at).toBe(Date.now())
  })

  it('非权限类失败与别的工具不记信号', async () => {
    const conversations = await runtime()
    emit('conversation-1', {
      type: 'tool.completed',
      toolName: 'milksu_workspace',
      error: 'Computer Use is already attached to another visible Coding task',
    })
    expect(conversations.computerUsePermissionGuard).toBeNull()
    emit('conversation-1', {
      type: 'tool.started', toolName: 'milksu_workspace', text: guardText,
    })
    expect(conversations.computerUsePermissionGuard).toBeNull()
    emit('conversation-1', {
      type: 'tool.completed', toolName: 'bash', error: guardText,
    })
    expect(conversations.computerUsePermissionGuard).toBeNull()
  })

  it('consume 清掉信号（ChatPage 开完向导后的收口）', async () => {
    const conversations = await runtime()
    emit('conversation-1', {
      type: 'tool.completed', toolName: 'milksu_workspace', text: guardText, error: guardText,
    })
    expect(conversations.computerUsePermissionGuard).not.toBeNull()
    conversations.consumeComputerUsePermissionGuard()
    expect(conversations.computerUsePermissionGuard).toBeNull()
  })

  it('不同会话撞墙 ⇒ 信号换成那个会话（向导知道该跟谁继续）', async () => {
    const conversations = await runtime()
    stored = [
      { id: 'conversation-1', title: '会话一', createdAt: 1, workspacePath: '', messages: [] },
      { id: 'conversation-2', title: '会话二', createdAt: 2, workspacePath: '', messages: [] },
    ]
    emit('conversation-2', {
      type: 'tool.completed', toolName: 'milksu_workspace', text: guardText, error: guardText,
    })
    expect(conversations.computerUsePermissionGuard?.conversationId).toBe('conversation-2')
  })
})
