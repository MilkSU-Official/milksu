// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Handler = (event: { payload: unknown }) => void
let refreshOverride: Array<{ id: string; name: string; kind: string; status: string; startedAt: number }> | null = null
const handlers = new Map<string, Handler>()

vi.mock('@/desktop', () => ({
  invokeCommand: vi.fn(async (command: string) => {
    if (command === 'refresh_coding_background_tasks' && refreshOverride) return { backgroundTasks: refreshOverride }
    if (command === 'list_conversations') return []
    if (command === 'get_coding_project_memory') return { recents: [], lastWorkspacePath: '' }
    return null
  }),
  listenEvent: vi.fn(async (name: string, handler: Handler) => {
    handlers.set(name, handler)
    return () => handlers.delete(name)
  }),
}))

const TASK_NAME = '打包探针'

function emitEngineEvent(payload: Record<string, unknown>) {
  handlers.get('engine-event')?.({ payload })
}

async function loadRuntime() {
  const { useConversations } = await import('@/composables/useConversations')
  const conversations = useConversations()
  await conversations.load()
  await conversations.listen()
  conversations.activeId = 'conversation-1'
  // 真实驱动：rewindContext() 在 `runningIds.has(id)` 时调 finishRun（:3339）⇒ 这就是回合结束的汇合点。
  conversations.store.setState({
    conversations: [{
      id: 'conversation-1',
      title: '探针',
      kernel: 'pi',
      messages: [{ id: 'm1', role: 'user', content: '开始打包', timestamp: 1, status: 'done' }],
    }],
  } as never)
  return conversations
}

describe('background task survives the turn end', () => {
  beforeEach(async () => {
    handlers.clear()
    const { applyUiLocale } = await import('@/lib/uiLocale')
    applyUiLocale('zh')
  })

  it('reaches the real turn-end path and then says the task is still running', async () => {
    const conversations = await loadRuntime()
    conversations.store.setState({ runningIds: new Set(['conversation-1']), engineNotice: '' })
    // 真实事件：bg_task 起了一个后台任务。
    emitEngineEvent({ sessionId: 'conversation-1', type: 'background_tasks', tasks: [
      { id: 't1', name: TASK_NAME, kind: 'process', status: 'running', startedAt: 1 },
    ] })
    // 事实层留下了它（(C)① 要靠它做状态区那一行）。
    expect(conversations.store.getState().backgroundTasks['conversation-1']).toHaveLength(1)
    conversations.store.setState({ engineNotice: '' })

    // —— 第 1 步：先证明**驱动真的到达了 finishRun**（runningIds 真的收缩）——
    // settleRunsForRuntimeRecovery 就是 reap 扫描（:3325，遍历所有 runningIds 逐个 finishRun），且是导出的。
    conversations.settleRunsForRuntimeRecovery()
    expect(conversations.store.getState().runningIds.has('conversation-1')).toBe(false)

    // —— 第 2 步：再断言提示 ——
    const notice = conversations.store.getState().engineNotice
    expect(notice ?? '').not.toContain('后台仍在运行')
    expect(conversations.store.getState().backgroundTasks['conversation-1'] ?? []).toHaveLength(1)
    expect(notice ?? '').not.toContain('请不要关机')
  })

  it('says the same in English, with the count', async () => {
    const { applyUiLocale } = await import('@/lib/uiLocale')
    const conversations = await loadRuntime()
    applyUiLocale('en')
    conversations.store.setState({ runningIds: new Set(['conversation-1']), engineNotice: '' })
    emitEngineEvent({ sessionId: 'conversation-1', type: 'background_tasks', tasks: [
      { id: 't1', name: TASK_NAME, kind: 'process', status: 'running', startedAt: 1 },
      { id: 't2', name: 'verify', kind: 'process', status: 'running', startedAt: 1 },
    ] })
    conversations.store.setState({ engineNotice: '' })
    conversations.settleRunsForRuntimeRecovery()
    expect(conversations.store.getState().runningIds.has('conversation-1')).toBe(false)
    const notice = conversations.store.getState().engineNotice
    expect(notice ?? '').not.toContain('Still running in the background')
    expect(conversations.store.getState().backgroundTasks['conversation-1'] ?? []).toHaveLength(2)
  })

  // 跨层名字：侧车发 `background_tasks`，但引擎在 `runtime/src/events.ts` 的改名表里
  // 把它改写成 `runtime.background_tasks` 再交给渲染层（subagent_tasks/dsh_jobs/compaction_*
  // 都是同一张表）。只认侧车名字 ⇒ 真机上**静默收不到** ⇒ 状态区那行与回合结束提示一起消失。
  it('hears the event under the name the engine actually forwards', async () => {
    const conversations = await loadRuntime()
    conversations.store.setState({ runningIds: new Set(['conversation-1']), engineNotice: '' })
    emitEngineEvent({ sessionId: 'conversation-1', type: 'runtime.background_tasks', tasks: [
      { id: 't1', name: TASK_NAME, kind: 'process', status: 'running', startedAt: 1 },
    ] })
    expect(conversations.store.getState().backgroundTasks['conversation-1']).toHaveLength(1)
    conversations.store.setState({ engineNotice: '' })
    conversations.settleRunsForRuntimeRecovery()
    expect(conversations.store.getState().runningIds.has('conversation-1')).toBe(false)
    const notice = conversations.store.getState().engineNotice
    expect(notice ?? '').not.toContain('后台仍在运行')
    expect(conversations.store.getState().backgroundTasks['conversation-1'] ?? []).toHaveLength(1)
  })

  // 真机形状：引擎把侧车的 `tasks` 解进 `Event.BackgroundTasks`（json 标签 `backgroundTasks`）
  // 再改名转给渲染层。只读 `tasks` 时真机读数是「事件到了、count 恒为 0」。
  it('reads the task list under the name the engine forwards', async () => {
    const conversations = await loadRuntime()
    conversations.store.setState({ runningIds: new Set(['conversation-1']), engineNotice: '' })
    emitEngineEvent({ sessionId: 'conversation-1', type: 'runtime.background_tasks', backgroundTasks: [
      { id: 't1', name: TASK_NAME, kind: 'process', status: 'running', startedAt: 1 },
    ] })
    expect(conversations.store.getState().backgroundTasks['conversation-1']).toHaveLength(1)
    conversations.store.setState({ engineNotice: '' })
    conversations.settleRunsForRuntimeRecovery()
    const notice = conversations.store.getState().engineNotice
    expect(notice ?? '').not.toContain('后台仍在运行')
    expect(conversations.store.getState().backgroundTasks['conversation-1'] ?? []).toHaveLength(1)
  })

  // 任务**自己结束**时不会再有 `bg_task` 工具调用 ⇒ 侧车不发事件 ⇒ 那行会粘住 ✗。
  // 有任务在跑时轮询现成刷新命令；清零即停（有界 ✓）。
  it('polls the refresh command while a task runs, and stops once it clears', async () => {
    vi.useFakeTimers()
    try {
      const { invokeCommand } = await import('@/desktop')
      const refreshCalls = () => (invokeCommand as unknown as { mock: { calls: unknown[][] } }).mock.calls
        .filter(call => call[0] === 'refresh_coding_background_tasks')
      const calls = () => refreshCalls().length
      const conversations = await loadRuntime()
      emitEngineEvent({ sessionId: 'conversation-1', type: 'runtime.background_tasks', backgroundTasks: [
        { id: 't1', name: TASK_NAME, status: 'running' },
      ] })
      const before = calls()
      // 任务刚结束时最容易被看到"还挂着" ✗（读者看到的是上一秒的事实）⇒ 第一次查询要早，
      // 不靠 15 秒那一轮。
      await vi.advanceTimersByTimeAsync(2500)
      expect(calls()).toBeGreaterThan(before)
      await vi.advanceTimersByTimeAsync(15000)
      expect(calls()).toBeGreaterThan(before)
      // 回归保护：引擎侧 sessionID 为空会直接报 `session id is required` ✗ ⇒ 漏参时命令永远失败
      // （被静默吞掉）⇒ 状态区那行永远停在“仍在运行”。
      for (const call of refreshCalls()) {
        expect(String((call[1] as { conversationId?: string })?.conversationId ?? '')).toBe('conversation-1')
      }
      const afterFirst = calls()
      emitEngineEvent({ sessionId: 'conversation-1', type: 'runtime.background_tasks', backgroundTasks: [] })
      await vi.advanceTimersByTimeAsync(15000 * 3)
      expect(calls()).toBe(afterFirst)
      conversations.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  // 回归：轮询返回与现状**完全相同**的列表 ⇒ **一次 store 写都不许发生**
  //（每 4 秒无条件写 ⇒ 对象身份变化 ⇒ 整树重渲染 ⇒ 流式输出被拖慢）。
  it('does not write the store when a refresh returns exactly what is already known', async () => {
    const conversations = await loadRuntime()
    vi.useFakeTimers()
    try {
      const runningList = [{ id: 't1', name: '打包', kind: 'process', status: 'running', startedAt: 1 }]
      refreshOverride = runningList
      emitEngineEvent({ sessionId: 'conversation-1', type: 'background_tasks', tasks: runningList })
      await vi.advanceTimersByTimeAsync(2000)
      const before = conversations.store.getState().backgroundTasks
      const identities: unknown[] = []
      const original = conversations.store.setState.bind(conversations.store)
      conversations.store.setState = ((...args: Parameters<typeof original>) => {
        identities.push(conversations.store.getState().backgroundTasks)
        return original(...args)
      }) as typeof conversations.store.setState
      try {
        await vi.advanceTimersByTimeAsync(20000)
      } finally {
        conversations.store.setState = original as typeof conversations.store.setState
      }
      // 不但"看起来没变"，而是**对象身份与写入次数**都没变。
      expect(conversations.store.getState().backgroundTasks).toBe(before)
      expect(identities).toHaveLength(0)
    } finally {
      vi.useRealTimers()
    }
  })

  // 闸门不能变成"永远不写"：真有变化时仍要写进去。
  it('still writes when a refresh changes the running list', async () => {
    const conversations = await loadRuntime()
    vi.useFakeTimers()
    try {
      emitEngineEvent({ sessionId: 'conversation-1', type: 'background_tasks', tasks: [
        { id: 't1', name: '打包', kind: 'process', status: 'running', startedAt: 1 },
      ] })
      await vi.advanceTimersByTimeAsync(2000)
      const before = conversations.store.getState().backgroundTasks
      // 让下一次查询返回"任务已结束"⇒ 列表变化 ⇒ 必须写（并记终态）。
      refreshOverride = [{ id: 't1', name: '打包', kind: 'process', status: 'succeeded', startedAt: 1 }]
      // 多推一个间隔并冲刷微任务：轮询是 promise 链 ⇒ 只推一次可能还没落到 .then 里。
      await vi.advanceTimersByTimeAsync(10000)
      await vi.advanceTimersByTimeAsync(10000)
      await Promise.resolve()
      await Promise.resolve()
      expect(conversations.store.getState().backgroundTasks).not.toBe(before)
      expect(conversations.store.getState().backgroundTasks['conversation-1'] ?? []).toHaveLength(0)
      expect(conversations.store.getState().backgroundTaskOutcome['conversation-1'])
        .toMatchObject({ kind: 'completed' })
    } finally {
      refreshOverride = null
      vi.useRealTimers()
    }
  })
})
