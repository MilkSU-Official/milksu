// @vitest-environment jsdom
// R4 桌面可见性：引擎韧性批次五个新事件（model.retry / model.stall / turn.active /
// session.recovery / session.message_queued）从桌面事件流进渲染器状态的接线。
// 事件形状 = Go normalizeBridgeEvent 的输出（internal/engine/supervisor.go 五个新 case）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { modelRetryLabel } from '@/lib/agentEngineSignals'

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

function storedConversation(id: string, title = id, kernel?: string) {
  return {
    id,
    title,
    createdAt: 1,
    workspacePath: '',
    ...(kernel ? { kernel } : {}),
    messages: [],
  }
}

function emit(sessionId: string, payload: Record<string, unknown>) {
  handlers.get('engine-event')?.({ payload: { sessionId, ...payload } })
}

describe('useConversations 引擎韧性事件', () => {
  beforeEach(() => {
    handlers.clear()
    invokeCommand.mockClear()
    Object.defineProperty(window, 'milksu', { configurable: true, value: { invoke: vi.fn() } })
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-17T00:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  async function runtime(kernel: 'pi' | 'dsh' = 'pi', running = true) {
    const { useConversations } = await import('@/composables/useConversations')
    const conversations = useConversations()
    stored = [storedConversation('conversation-1', '韧性会话', kernel)]
    await conversations.load()
    await conversations.listen()
    conversations.activeId = 'conversation-1'
    if (running) emit('conversation-1', { type: 'assistant.started' })
    return conversations
  }

  it('model.retry start 挂横幅带倒计时，end 只熄秒数不收横幅；engine.error 才收', async () => {
    const conversations = await runtime()
    emit('conversation-1', {
      type: 'model.retry',
      phase: 'start',
      attempt: 2,
      maxRetries: 5,
      notice: '网络波动，重试中 2/5',
      noticeEnglish: 'Network trouble, retrying 2/5',
      errorMessage: 'fetch failed',
      retryAt: Date.now() + 3_000,
    })
    expect(conversations.activeModelRetry).toMatchObject({
      attempt: 2,
      maxRetries: 5,
      notice: '网络波动，重试中 2/5',
      errorMessage: 'fetch failed',
      inFlight: false,
    })
    // 退避节奏明说在文案里（β.192 真机验收：裸数字「2.0s」被读成重试间隔过短）。
    expect(modelRetryLabel(conversations.activeModelRetry!)).toContain('3 秒后重试')

    // 倒计时归零、下一次尝试开始（phase:end）：横幅保留，只熄秒数。
    // 旧语义在此删条目 ⇒ 读者在下一次尝试的静默里以为死机而重复发送。
    emit('conversation-1', { type: 'model.retry', phase: 'end', attempt: 2 })
    expect(conversations.activeModelRetry).not.toBeNull()
    expect(conversations.activeModelRetry).toMatchObject({
      attempt: 2,
      inFlight: true,
      retryAt: 0,
    })
    const inFlightLabel = modelRetryLabel(conversations.activeModelRetry!)
    expect(inFlightLabel).toContain('正在重试…')
    expect(inFlightLabel).not.toContain('秒后')

    // 最终错误 ⇒ 收横幅；条目是真删（不是被 running 门挡住）——新回合 running 回来也不诈尸。
    emit('conversation-1', { type: 'engine.error', error: 'x' })
    expect(conversations.activeModelRetry).toBeNull()
    emit('conversation-1', { type: 'assistant.started' })
    expect(conversations.activeModelRetry).toBeNull()
  })

  it('回合成功收尾也收横幅：assistant.completed（消息落定）先收，下一回合不诈尸', async () => {
    const conversations = await runtime()
    emit('conversation-1', {
      type: 'model.retry',
      phase: 'start',
      attempt: 1,
      maxRetries: 5,
      retryAt: Date.now() + 2_000,
    })
    emit('conversation-1', { type: 'model.retry', phase: 'end', attempt: 1 })
    expect(conversations.activeModelRetry).not.toBeNull()
    // 重试的那条消息落定 = 出结果 ⇒ 横幅收起（多段回合里早于 assistant.settled）。
    emit('conversation-1', { type: 'assistant.completed', text: '好的' })
    expect(conversations.activeModelRetry).toBeNull()
    // 排队消息续跑的第二轮（新回合）⇒ 上一轮的横幅状态不能再上屏。
    emit('conversation-1', { type: 'assistant.settled' })
    emit('conversation-1', { type: 'assistant.started' })
    expect(conversations.activeModelRetry).toBeNull()
  })

  it('同一会话多轮退避无缝衔接：end→start 整条替换，倒计时从新 retryAt 重走', async () => {
    const conversations = await runtime()
    emit('conversation-1', {
      type: 'model.retry',
      phase: 'start',
      attempt: 1,
      maxRetries: 5,
      notice: '网络波动，重试中 1/5',
      noticeEnglish: 'Network trouble, retrying 1/5',
      errorMessage: 'fetch failed',
      retryAt: Date.now() + 2_000,
    })
    emit('conversation-1', { type: 'model.retry', phase: 'end', attempt: 1 })
    expect(conversations.activeModelRetry).toMatchObject({ attempt: 1, inFlight: true })
    // 第二次尝试又失败、排程第二轮退避：横幅全程不消失，计数与倒计时无缝换新。
    emit('conversation-1', {
      type: 'model.retry',
      phase: 'start',
      attempt: 2,
      maxRetries: 5,
      notice: '网络波动，重试中 2/5',
      noticeEnglish: 'Network trouble, retrying 2/5',
      errorMessage: 'fetch failed',
      retryAt: Date.now() + 4_000,
    })
    expect(conversations.activeModelRetry).toMatchObject({ attempt: 2, inFlight: false })
    expect(modelRetryLabel(conversations.activeModelRetry!)).toContain('2/5，4 秒后重试')
    await vi.advanceTimersByTimeAsync(1_000)
    expect(modelRetryLabel(conversations.activeModelRetry!)).toContain('3 秒后重试')
    // 倒计时走完但 end 事件还没到 ⇒ 不报「0 秒后重试」，按正在重试兜底。
    await vi.advanceTimersByTimeAsync(3_000)
    expect(modelRetryLabel(conversations.activeModelRetry!)).toContain('正在重试…')
    expect(modelRetryLabel(conversations.activeModelRetry!)).not.toContain('秒后')
  })

  it('引擎实例停止（回合被中断）收横幅：engine.stopped 这条路不走 finishRun，同处清条目', async () => {
    const conversations = await runtime()
    emit('conversation-1', {
      type: 'model.retry',
      phase: 'start',
      attempt: 1,
      maxRetries: 5,
      retryAt: Date.now() + 2_000,
    })
    expect(conversations.activeModelRetry).not.toBeNull()
    // session-less 引擎停止：把该实例服务的会话全部结算（含重试横幅条目）。
    emit('', { type: 'engine.stopped', sessions: ['conversation-1'] })
    expect(conversations.activeModelRetry).toBeNull()
    // 条目已删：新回合 running 回来不诈尸。
    emit('conversation-1', { type: 'assistant.started' })
    expect(conversations.activeModelRetry).toBeNull()
  })

  // β.194 真机事故回归（横幅 2/5 后消失、整轮不回）：死端点退避静默中段，一条**无害回执事件**
  // （runtime.background_task_controlled——refresh_coding_background_tasks 的回执，不走会话
  // 事件流，所以引擎侧毫秒级探针看不到它）落到事件处理尾部的 reconcileParentRun；本地启发式
  // （STALE_PARENT_RUN_MS=2s）把「引擎管着的安静」当「卡死的运行」⇒ finishRun 清 running + 删
  // 重试横幅条目 ⇒ activeModelRetry 的 running 门永假，之后 model.retry 3/5…5/5 到了也回不来。
  it('退避静默中回执事件不清 running/横幅：重试窗口内本地清扫不抢跑，终局照常收', async () => {
    const conversations = await runtime()
    emit('conversation-1', {
      type: 'model.retry',
      phase: 'start',
      attempt: 2,
      maxRetries: 5,
      notice: '网络波动，重试中 2/5',
      noticeEnglish: 'Network trouble, retrying 2/5',
      errorMessage: 'fetch failed',
      retryAt: Date.now() + 3_000,
    })
    expect(conversations.activeRunning).toBe(true)
    expect(conversations.activeModelRetry).toMatchObject({ attempt: 2, maxRetries: 5 })

    // 真机形状（CDP v7/v8 毫秒级证据）：回合开始 2.28s、attempt-2 静默中段回执到达。
    await vi.advanceTimersByTimeAsync(2_300)
    emit('conversation-1', { type: 'runtime.background_task_controlled', requestId: 'r1', tasks: [] })
    expect(conversations.activeRunning).toBe(true)
    expect(conversations.activeModelRetry).toMatchObject({ attempt: 2, maxRetries: 5 })

    // 12s 空闲对账（IDLE_RECONCILE_MS 同族触发）再来一次：窗口仍在 ⇒ 还是不清。
    await vi.advanceTimersByTimeAsync(12_000)
    emit('conversation-1', { type: 'runtime.background_task_controlled', requestId: 'r2', tasks: [] })
    expect(conversations.activeRunning).toBe(true)
    expect(conversations.activeModelRetry).toMatchObject({ attempt: 2, maxRetries: 5 })

    // 终局（最终错误）照常收：running 清掉、条目真删（新回合不诈尸）。
    emit('conversation-1', { type: 'engine.error', error: 'all retries failed' })
    expect(conversations.activeRunning).toBe(false)
    expect(conversations.activeModelRetry).toBeNull()
    emit('conversation-1', { type: 'assistant.started' })
    expect(conversations.activeModelRetry).toBeNull()
  })

  // β.196 真机事故回归（kunbot 中继 3.5-4s+ 首字节静默、连接没断所以无重试无横幅）：
  // 静默期消息列表无运行中气泡（liveWorkingCount=0 天然成立）、runStartedAt 超 2 秒，
  // 任何一条落到事件处理尾部的杂事件（runtime.background_task_controlled 回执，后台任务
  // 轮询周期性产生）都满足旧清扫判据 ⇒ running 被提前掐死，等待指示消失、界面像「没回复」，
  // 首字节到达后消息诈尸冒出。修复口径：无工作项证据的静默归引擎说了算，杂事件清不动它。
  it('慢 TTFB 静默（无重试窗口）：回执杂事件不清 running，首字节上屏后终局照常收', async () => {
    const conversations = await runtime()
    expect(conversations.activeRunning).toBe(true)
    // kunbot 形状：回合开始 3.8 秒仍无首字节（不流式：无消息、无工作项、无重试横幅）。
    await vi.advanceTimersByTimeAsync(3_800)
    emit('conversation-1', { type: 'runtime.background_task_controlled', requestId: 'r1', tasks: [] })
    expect(conversations.activeRunning).toBe(true)
    // 静默拉长（12s 空闲对账同族窗口）再来一条回执：还是清不动。
    await vi.advanceTimersByTimeAsync(12_000)
    emit('conversation-1', { type: 'runtime.background_task_controlled', requestId: 'r2', tasks: [] })
    expect(conversations.activeRunning).toBe(true)
    // 首字节到达：消息正常上屏（running 的 assistant 行），等待指示没被提前掐掉。
    emit('conversation-1', { type: 'assistant.delta', text: '终于开始回复' })
    expect(conversations.activeRunning).toBe(true)
    const last = conversations.active?.messages.at(-1)
    expect(last?.role).toBe('assistant')
    expect(last?.status).toBe('running')
    expect(String(last?.content)).toContain('终于开始回复')
    // 引擎终局照常收尾：running 只在这里死。
    emit('conversation-1', { type: 'assistant.completed', text: '终于开始回复' })
    emit('conversation-1', { type: 'assistant.settled' })
    expect(conversations.activeRunning).toBe(false)
    expect(conversations.active?.messages.at(-1)?.status).toBe('done')
  })

  // 旧口径「2 秒无残留即回收」就是 β.196 误杀本身，这条测试改钉新口径：无证据的运行
  // 标记不再被本地计时器收割，真卡死的回合由停滞看门狗承接（running 活着它才举得动牌：
  // decideTurnStall 首行以 running 为门），引擎终局与读者动作照常收。
  it('无工作项证据的运行标记不再被计时器收割：真卡死由停滞看门狗承接', async () => {
    const conversations = await runtime()
    await vi.advanceTimersByTimeAsync(20_000)
    emit('conversation-1', { type: 'runtime.background_task_controlled', requestId: 'r1', tasks: [] })
    expect(conversations.activeRunning).toBe(true)
    // 回执把进展时钟也刷新了（它算一条事件）：静默从它之后重新算。超 quietMs=18s ⇒
    // 界面说「等待中」，但 running 还在（没被清扫拆掉）。
    await vi.advanceTimersByTimeAsync(19_000)
    expect(conversations.streamStale).toBe(true)
    expect(conversations.activeRunning).toBe(true)
    // 静默到 engineGoneMs=45s 且心跳从未到 ⇒ 看门狗举起 engine-gone（停止/重启出口由它
    // 提供）。running 若在 2 秒时被清扫掐掉，这块告警面就永远亮不出来了。
    await vi.advanceTimersByTimeAsync(27_000)
    expect(conversations.activeStallKind).toBe('engine-gone')
    expect(conversations.activeRunning).toBe(true)
    // 引擎终局照常收。
    emit('conversation-1', { type: 'engine.error', error: 'engine died' })
    expect(conversations.activeRunning).toBe(false)
  })

  // 真机的另一半触发面：12 秒空闲对账定时器（live 运行时才有）自己也会走到同一条清扫。
  it('12 秒空闲对账（live 对账定时器）不清无证据的运行标记', async () => {
    const { createConversationsRuntime } = await import('@/composables/useConversations')
    const conversations = createConversationsRuntime({ live: true })
    stored = [storedConversation('conversation-1', '韧性会话')]
    await conversations.load()
    await conversations.listen()
    conversations.activeId = 'conversation-1'
    emit('conversation-1', { type: 'assistant.started' })
    await vi.advanceTimersByTimeAsync(12_500)
    expect(conversations.activeRunning).toBe(true)
    await vi.advanceTimersByTimeAsync(12_000)
    expect(conversations.activeRunning).toBe(true)
    emit('conversation-1', { type: 'assistant.settled' })
    expect(conversations.activeRunning).toBe(false)
    conversations.dispose()
  })

  // 清扫的正当职责照常（d6e3fe42 章程）：parent 记账。工作项在场时杂事件不清；
  // roster 在跑集合从非空变空的边沿（引擎 roster 事件即证据）立即收 parent 运行位与
  // 工具行，不等 ACP whenIdle / assistant.settled。
  it('parent 记账照常：工作项在场时杂事件不清，roster 清空边沿即收', async () => {
    const conversations = await runtime('dsh')
    expect(conversations.activeRunning).toBe(true)
    emit('conversation-1', { type: 'tool.started', toolName: 'subagent', toolCallId: 'cf-1', text: '环境巡检' })
    emit('conversation-1', {
      type: 'runtime.subagent_tasks',
      subagentTasks: [{ id: 'cf-1', role: '环境巡检', status: 'running', toolCallId: 'cf-1' }],
    })
    // 在跑窗口里的杂事件：不清（liveWorkingCount=1）。
    emit('conversation-1', { type: 'runtime.background_task_controlled', requestId: 'r1', tasks: [] })
    expect(conversations.activeRunning).toBe(true)
    // roster 全部完成：边沿即收，subagent 工具行一并收尾。
    emit('conversation-1', {
      type: 'runtime.subagent_tasks',
      subagentTasks: [{ id: 'cf-1', role: '环境巡检', status: 'succeeded', toolCallId: 'cf-1' }],
    })
    expect(conversations.activeRunning).toBe(false)
    const messages = conversations.active?.messages ?? []
    expect(messages.some(message => message.status === 'running' && !message.approvalRequestId)).toBe(false)
  })

  // 风险外推的实测面：DSH 把 subagent 工具行豁免出阻塞残留（它算 Working），roster 事件
  // 没到之前，旧清扫对这种静默只剩计时器判据（runStartedAt 超 2 秒即烧，工具行被一并
  // settleRunningToolMessages 收尾）。新口径：无工作项证据就烧不动。
  it('DSH subagent 工具静默（roster 未到）：无证据时计时器不烧，工具行不提前收尾', async () => {
    const conversations = await runtime('dsh')
    emit('conversation-1', { type: 'tool.started', toolName: 'subagent', toolCallId: 'cf-1', text: '环境巡检' })
    await vi.advanceTimersByTimeAsync(3_000)
    emit('conversation-1', { type: 'runtime.background_task_controlled', requestId: 'r1', tasks: [] })
    expect(conversations.activeRunning).toBe(true)
    expect(conversations.active?.messages.find(message => message.toolCallId === 'cf-1')?.status).toBe('running')
    // roster 到场（在跑）：证据记上，照常不清。
    emit('conversation-1', {
      type: 'runtime.subagent_tasks',
      subagentTasks: [{ id: 'cf-1', role: '环境巡检', status: 'running', toolCallId: 'cf-1' }],
    })
    expect(conversations.activeRunning).toBe(true)
    emit('conversation-1', {
      type: 'runtime.subagent_tasks',
      subagentTasks: [{ id: 'cf-1', role: '环境巡检', status: 'succeeded', toolCallId: 'cf-1' }],
    })
    expect(conversations.activeRunning).toBe(false)
  })

  // 普通长工具静默（pi）：工具执行不发进度超过 2 秒。工具行本身就是运行中消息残留
  // （parentHasBlockingToolResidue），清扫本来就进不来；钉住这条保护不回退。
  it('长工具静默（pi）：工具执行期间杂事件不清 running，工具行不提前收尾', async () => {
    const conversations = await runtime()
    emit('conversation-1', { type: 'tool.started', toolName: 'bash', toolCallId: 'call-1', text: '跑一个长命令' })
    await vi.advanceTimersByTimeAsync(5_000)
    emit('conversation-1', { type: 'runtime.background_task_controlled', requestId: 'r1', tasks: [] })
    expect(conversations.activeRunning).toBe(true)
    expect(conversations.active?.messages.find(message => message.toolCallId === 'call-1')?.status).toBe('running')
    emit('conversation-1', { type: 'tool.completed', toolName: 'bash', toolCallId: 'call-1', text: 'done', done: true })
    emit('conversation-1', { type: 'assistant.settled' })
    expect(conversations.activeRunning).toBe(false)
    expect(conversations.active?.messages.find(message => message.toolCallId === 'call-1')?.status).toBe('done')
  })

  // 工作项证据按回合锚定（runStartedAt）：上一回合的 subagent 证据不渗进下一回合的纯聊天静默期。
  it('工作项证据按回合锚定：上一回合的证据不渗进下一回合的静默期', async () => {
    const conversations = await runtime('dsh')
    // 第一回合：subagent 跑完，roster 边沿收尾（证据用完即清）。
    emit('conversation-1', { type: 'tool.started', toolName: 'subagent', toolCallId: 'cf-1', text: '环境巡检' })
    emit('conversation-1', {
      type: 'runtime.subagent_tasks',
      subagentTasks: [{ id: 'cf-1', role: '环境巡检', status: 'running', toolCallId: 'cf-1' }],
    })
    emit('conversation-1', {
      type: 'runtime.subagent_tasks',
      subagentTasks: [{ id: 'cf-1', role: '环境巡检', status: 'succeeded', toolCallId: 'cf-1' }],
    })
    expect(conversations.activeRunning).toBe(false)
    // 第二回合：纯聊天（无 roster、无消息残留），静默超 2 秒 + 杂事件 ⇒ 不清。
    emit('conversation-1', { type: 'assistant.started' })
    await vi.advanceTimersByTimeAsync(3_000)
    emit('conversation-1', { type: 'runtime.background_task_controlled', requestId: 'r2', tasks: [] })
    expect(conversations.activeRunning).toBe(true)
    // 首字节与终局照常。
    emit('conversation-1', { type: 'assistant.delta', text: '第二回合的回复' })
    emit('conversation-1', { type: 'assistant.settled' })
    expect(conversations.activeRunning).toBe(false)
  })

  // 重试窗口与证据记账的衔接：roster 清空边沿落在重试窗口里会被 β.194 门挡住（窗口内
  // 一律不扫）；证据照记（事实先于政策），窗口关闭（消息落定收横幅）后计时器凭证据补收。
  it('重试窗口里消耗的 roster 边沿：窗口内不扫，窗口关闭后计时器凭证据补收', async () => {
    const conversations = await runtime('dsh')
    // 重试窗口开（横幅在场）。
    emit('conversation-1', {
      type: 'model.retry',
      phase: 'start',
      attempt: 1,
      maxRetries: 5,
      retryAt: Date.now() + 2_000,
    })
    expect(conversations.activeModelRetry).not.toBeNull()
    // 窗口里 subagent 在跑：证据记上，但清扫被门挡住。
    emit('conversation-1', { type: 'tool.started', toolName: 'subagent', toolCallId: 'cf-1', text: '环境巡检' })
    emit('conversation-1', {
      type: 'runtime.subagent_tasks',
      subagentTasks: [{ id: 'cf-1', role: '环境巡检', status: 'running', toolCallId: 'cf-1' }],
    })
    expect(conversations.activeRunning).toBe(true)
    // roster 清空边沿落在窗口里：门挡住（不清 running，β.194 语义保持）。
    emit('conversation-1', {
      type: 'runtime.subagent_tasks',
      subagentTasks: [{ id: 'cf-1', role: '环境巡检', status: 'succeeded', toolCallId: 'cf-1' }],
    })
    expect(conversations.activeRunning).toBe(true)
    // 窗口关闭（重试成功、消息落定收横幅）：此刻还在宽限内（runStartedAt 未超 2 秒），
    // 尾部对账清不动；过了宽限再来一条杂事件 ⇒ 计时器凭证据补收，工具行一并收尾。
    emit('conversation-1', { type: 'assistant.completed', text: '重试成功' })
    expect(conversations.activeModelRetry).toBeNull()
    expect(conversations.activeRunning).toBe(true)
    await vi.advanceTimersByTimeAsync(2_100)
    emit('conversation-1', { type: 'runtime.background_task_controlled', requestId: 'r1', tasks: [] })
    expect(conversations.activeRunning).toBe(false)
    expect(conversations.active?.messages.find(message => message.toolCallId === 'cf-1')?.status).toBe('done')
  })

  it('畸形 phase（既非 start 也非 end）⇒ 按旧口径收横幅，不猜语义', async () => {
    const conversations = await runtime()
    emit('conversation-1', {
      type: 'model.retry',
      phase: 'start',
      attempt: 1,
      maxRetries: 5,
      retryAt: Date.now() + 2_000,
    })
    emit('conversation-1', { type: 'model.retry', phase: '???', attempt: 1 })
    expect(conversations.activeModelRetry).toBeNull()
  })

  it('model.retry 算进展：重试开始即刷新停滞时钟，退避静默不误判停滞', async () => {
    const conversations = await runtime()
    // 静默 20s（超过 quietMs=18s）⇒ 界面已说「等待中」。
    await vi.advanceTimersByTimeAsync(20_000)
    expect(conversations.streamStale).toBe(true)
    // 重试开始：引擎刚说过话（管理中的静默），停滞时钟清零 + 心跳喂上。
    emit('conversation-1', { type: 'model.retry', phase: 'start', attempt: 1, maxRetries: 5 })
    expect(conversations.streamStale).toBe(false)
    expect(conversations.activeEngineAlive).toBe(true)
    // 退避期内安静 17s（仍在 quietMs 内）⇒ 不算停滞。
    await vi.advanceTimersByTimeAsync(17_000)
    expect(conversations.streamStale).toBe(false)
    // 长退避（60s，超过 quietMs 但未到 modelStallMs=120s）：真实引擎在此期间会继续发
    // turn.heartbeat（进程活着、请求在重试）⇒ 不举「停滞/进程没了」牌。
    await vi.advanceTimersByTimeAsync(60_000)
    emit('conversation-1', { type: 'turn.heartbeat' })
    expect(conversations.activeStallKind).toBe('')
  })

  it('turn.active 作为心跳源：回合边界证明引擎活着', async () => {
    const conversations = await runtime()
    emit('conversation-1', { type: 'turn.active', phase: 'start' })
    expect(conversations.activeEngineAlive).toBe(true)
    emit('conversation-1', { type: 'turn.active', phase: 'end' })
    expect(conversations.activeEngineAlive).toBe(true)
    // 心跳宽限（15s）过了才算不活着——但 turn.active 不推进进展时钟。
    await vi.advanceTimersByTimeAsync(20_000)
    expect(conversations.activeEngineAlive).toBe(false)
    expect(conversations.streamStale).toBe(true)
  })

  it('session.recovery 挂恢复横幅、把会话标回进行中并清失败横幅', async () => {
    const conversations = await runtime()
    // 崩溃：回合失败，running 清掉，失败横幅挂起。
    emit('conversation-1', { type: 'engine.error', error: 'fetch failed' })
    emit('conversation-1', { type: 'assistant.settled' })
    expect(conversations.activeRunning).toBe(false)
    expect(conversations.activeProblemTurn).not.toBeNull()
    // 引擎重开附着、run 仍在飞行 ⇒ 恢复可见。
    emit('conversation-1', {
      type: 'session.recovery',
      notice: '从断点恢复中',
      noticeEnglish: 'Resuming from where the engine left off',
    })
    expect(conversations.activeEngineRecovery?.notice).toBe('从断点恢复中')
    // running 位回到真实状态（agentRecovery 的恢复按钮以 running 为门 ⇒ 不双横幅）。
    expect(conversations.activeRunning).toBe(true)
    expect(conversations.activeProblemTurn).toBeNull()
    // 恢复的回合收尾 ⇒ 恢复横幅随之收起。
    emit('conversation-1', { type: 'assistant.settled' })
    expect(conversations.activeEngineRecovery).toBeNull()
  })

  it('session.message_queued 挂排队提示；被回合消费即收', async () => {
    const conversations = await runtime()
    emit('conversation-1', {
      type: 'session.message_queued',
      submissionId: 'sub-1',
      position: 2,
      total: 3,
      text: '排队消息',
      notice: '排队中第 2 位',
    })
    expect(conversations.activeQueuedMessage).toMatchObject({
      position: 2,
      total: 3,
      text: '排队消息',
    })
    // queue_update：followUp 里还有它 ⇒ 保持。
    emit('conversation-1', { type: 'session.queue_updated', steering: [], followUp: ['别的消息', '排队消息'] })
    expect(conversations.activeQueuedMessage).not.toBeNull()
    // 消费掉（followUp 里没了）⇒ 收横幅。
    emit('conversation-1', { type: 'session.queue_updated', steering: [], followUp: ['别的消息'] })
    expect(conversations.activeQueuedMessage).toBeNull()
  })

  it('session.message_queued 的回合结束兜底：running 清掉即收', async () => {
    const conversations = await runtime()
    emit('conversation-1', {
      type: 'session.message_queued',
      position: 1,
      total: 1,
      text: '排队消息',
    })
    expect(conversations.activeQueuedMessage).not.toBeNull()
    emit('conversation-1', { type: 'assistant.settled' })
    expect(conversations.activeQueuedMessage).toBeNull()
  })

  it('model.stall 复用停滞告警面：自带「连接无响应 x 秒」并立刻举牌', async () => {
    const conversations = await runtime()
    // 引擎进程还活着（心跳在）。
    emit('conversation-1', { type: 'turn.heartbeat' })
    emit('conversation-1', {
      type: 'model.stall',
      stallStage: 'generation',
      stalledSeconds: 90,
      hardKillSeconds: 180,
      notice: '连接无响应 90 秒',
      noticeEnglish: 'No response from the model connection for 90s',
    })
    expect(conversations.activeStallKind).toBe('model-stalled')
    expect(conversations.activeEngineWarning).toMatchObject({
      notice: '连接无响应 90 秒',
      stalledSeconds: 90,
      hardKillSeconds: 180,
    })
    // 真实事件到来 ⇒ 告警过期。
    emit('conversation-1', { type: 'assistant.started' })
    expect(conversations.activeEngineWarning).toBeNull()
    expect(conversations.activeStallKind).toBe('')
  })
})
