// @vitest-environment jsdom
// 停滞看门狗的系统通知：进入停滞态的**边沿**要发一条**独立的第四类 stalled**（模型疑似挂死，可重试或停止），
// 而不是复用 needs-decision（那是“等你拍板”）。也要有自己的 stalled 开关（默认关）。
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
  return { id, title, createdAt: 1, workspacePath: '', messages: [] }
}

function emit(sessionId: string, payload: Record<string, unknown>) {
  handlers.get('engine-event')?.({ payload: { sessionId, ...payload } })
}

describe('useConversations 停滞通知', () => {
  let invoke: ReturnType<typeof vi.fn>

  beforeEach(() => {
    handlers.clear()
    invokeCommand.mockClear()
    invoke = vi.fn()
    // 测试 setup 把 window.milksu 定义成只读 getter，这里按需覆盖成可控的桩。
    Object.defineProperty(window, 'milksu', { configurable: true, value: { invoke } })
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-17T00:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  async function runtimeWithStalledTurn() {
    const conversations = createConversationsRuntime()
    stored = [storedConversation('conversation-1', '卡住的会话')]
    await conversations.load()
    await conversations.listen()
    conversations.activeId = 'conversation-1'
    // stalled 是新增类型、**默认关** ⇒ 先显式打开；各用例再按需要覆盖。
    conversations.setTaskNotifySource(() => ({ needsInput: true, failed: true, completed: false, stalled: true }))
    // 回合开始 = 停滞事件的锚点（turnKey 与本地去重键都用它）。
    emit('conversation-1', { type: 'assistant.started' })
    return conversations
  }

  it('停滞边沿发一条 kind=stalled，写明类型与时长，turnKey 用回合起点', async () => {
    const conversations = await runtimeWithStalledTurn()
    conversations.notifyTurnStall({
      conversationId: 'conversation-1',
      stallKind: 'model-stalled',
      quietMs: 130_000,
    })
    expect(invoke).toHaveBeenCalledTimes(1)
    const [method, args] = invoke.mock.calls[0] as [string, Record<string, unknown>]
    expect(method).toBe('NotifyTask')
    // 独立第四类：线格式就是 stalled（不再是 needs-decision）。
    expect(args.kind).toBe('stalled')
    expect(args.conversationId).toBe('conversation-1')
    expect(args.conversationTitle).toBe('卡住的会话')
    expect(String(args.summary)).toContain('模型请求疑似挂死')
    expect(String(args.summary)).toContain('2 分钟')
    expect(String(args.summary)).toContain('可回到会话选择重试或停止')
    // turnKey 与回合起点同源（非空）。
    expect(String(args.turnKey ?? '')).not.toBe('')
    // 会话级前台压制：正在看的会话（activeId）必须随 args 透传给外壳（否则退回窗口级 ✗）。
    expect(args.activeConversationId).toBe('conversation-1')
  })

  it('engine-gone 用另一句措辞（进程心跳没了，不是请求静默）', async () => {
    const conversations = await runtimeWithStalledTurn()
    conversations.notifyTurnStall({
      conversationId: 'conversation-1',
      stallKind: 'engine-gone',
      quietMs: 50_000,
    })
    const args = invoke.mock.calls[0]?.[1] as Record<string, unknown>
    expect(String(args.summary)).toContain('引擎进程疑似挂死')
  })

  it('持续停滞不重复发：同一回合里再次进入停滞只发一次', async () => {
    const conversations = await runtimeWithStalledTurn()
    conversations.notifyTurnStall({ conversationId: 'conversation-1', stallKind: 'model-stalled', quietMs: 130_000 })
    conversations.notifyTurnStall({ conversationId: 'conversation-1', stallKind: 'model-stalled', quietMs: 200_000 })
    // 就算类型从 engine-gone 翻成 model-stalled，也还是同一个回合、同一次停滞。
    conversations.notifyTurnStall({ conversationId: 'conversation-1', stallKind: 'engine-gone', quietMs: 210_000 })
    expect(invoke).toHaveBeenCalledTimes(1)
  })

  it('stalled 开关关时不发（用自己的开关，不复用 needs_input）', async () => {
    const conversations = await runtimeWithStalledTurn()
    conversations.setTaskNotifySource(() => ({ needsInput: true, failed: true, completed: false, stalled: false }))
    conversations.notifyTurnStall({
      conversationId: 'conversation-1',
      stallKind: 'model-stalled',
      quietMs: 130_000,
    })
    expect(invoke).not.toHaveBeenCalled()
  })

  it('stalled 开着时，就算 needsInput 关也照发（两类目的不同，互不影响）', async () => {
    const conversations = await runtimeWithStalledTurn()
    conversations.setTaskNotifySource(() => ({ needsInput: false, failed: true, completed: false, stalled: true }))
    conversations.notifyTurnStall({
      conversationId: 'conversation-1',
      stallKind: 'model-stalled',
      quietMs: 130_000,
    })
    expect(invoke).toHaveBeenCalledTimes(1)
    expect((invoke.mock.calls[0]?.[1] as Record<string, unknown>).kind).toBe('stalled')
  })

  it('不是停滞类型 / 空会话 ⇒ 不发（防误调）', async () => {
    const conversations = await runtimeWithStalledTurn()
    conversations.notifyTurnStall({ conversationId: 'conversation-1', stallKind: '' as never, quietMs: 1 })
    conversations.notifyTurnStall({ conversationId: '', stallKind: 'model-stalled', quietMs: 1 })
    expect(invoke).not.toHaveBeenCalled()
  })

  it('sidecar 的预算软告警（turn.stall_warning）让看门狗立刻举牌，并存下告警详情', async () => {
    const conversations = await runtimeWithStalledTurn()
    // 心跳在：引擎进程还活着，只是请求超过了它自己的预算。
    emit('conversation-1', { type: 'turn.heartbeat' })
    emit('conversation-1', {
      type: 'turn.stall_warning',
      stallStage: 'ttfb',
      budgetMs: 17_900,
      payloadBytes: 3_313_500,
    })
    // 还没到任何本地静默阈值，但告警本身就是权威信号。
    expect(conversations.activeStallKind).toBe('model-stalled')
    expect(conversations.activeEngineWarning?.budgetMs).toBe(17_900)
    expect(conversations.activeEngineWarning?.payloadBytes).toBe(3_313_500)

    // 真实事件到来 ⇒ 告警过期，停滞判定回落。
    emit('conversation-1', { type: 'assistant.started' })
    expect(conversations.activeStallKind).toBe('')
    expect(conversations.activeEngineWarning).toBeNull()
  })
})
