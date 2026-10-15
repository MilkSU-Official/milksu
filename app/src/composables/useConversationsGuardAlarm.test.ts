// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { invokeCommand } from '@/desktop'
import { createConversationsRuntime, normalizeConversation } from '@/composables/useConversations'

type Handler = (event: { payload: unknown }) => void
const handlers = new Map<string, Handler>()

vi.mock('@/desktop', () => ({
  invokeCommand: vi.fn(async (command: string) => {
    if (command === 'list_conversations') return []
    if (command === 'get_coding_project_memory') return { recents: [], lastWorkspacePath: '' }
    return null
  }),
  listenEvent: vi.fn(async (name: string, handler: Handler) => {
    handlers.set(name, handler)
    return () => handlers.delete(name)
  }),
}))

async function loadRuntime() {
  const conversations = createConversationsRuntime()
  await conversations.load()
  await conversations.listen()
  conversations.activeId = 'conversation-1'
  return conversations
}

// 引擎守卫的示警必须能上屏（这就是 cross-layer 的 app 半边：名字对、字段对、真的显示）。
describe('engine guard alarms reach the reader', () => {
  beforeEach(async () => {
    handlers.clear()
    const { applyUiLocale } = await import('@/lib/uiLocale')
    applyUiLocale('zh')
  })

  it('shows the Chinese notice of a guard.alarm in a Chinese interface', async () => {
    const conversations = await loadRuntime()
    handlers.get('engine-event')?.({ payload: {
      sessionId: 'conversation-1',
      type: 'guard.alarm',
      notice: '这一步思考陷入重复，已跳过。',
      noticeEnglish: 'This thinking step started repeating, so it was skipped.',
    } })
    expect(conversations.engineNotice).toContain('这一步思考陷入重复')
  })

  it('shows the English notice in an English interface', async () => {
    const { applyUiLocale } = await import('@/lib/uiLocale')
    const conversations = await loadRuntime()
    applyUiLocale('en')
    handlers.get('engine-event')?.({ payload: {
      sessionId: 'conversation-1',
      type: 'guard.alarm',
      notice: '这一步思考陷入重复，已跳过。',
      noticeEnglish: 'This thinking step started repeating, so it was skipped.',
    } })
    expect(conversations.engineNotice).toContain('This thinking step started repeating')
  })



  it('别的对话的告警不会串到当前对话的横幅', async () => {
    const conversations = await loadRuntime()
    handlers.get('engine-event')?.({ payload: {
      sessionId: 'conversation-2',
      type: 'guard.alarm',
      notice: '已拦截：另一个会话的事。',
      noticeEnglish: 'Blocked: another conversation.',
    } })
    // 当前对话（conversation-1）不该出现横幅；出事的是 conversation-2。
    expect(conversations.activeProblemTurn).toBeNull()
    expect(conversations.conversationHasProblem('conversation-1')).toBe(false)
    expect(conversations.conversationHasProblem('conversation-2')).toBe(true)
  })



  // 守卫示警 ⇒ 该对话标记为「遇到问题」（顶部常驻横幅 + 侧栏红叉；读者口径：
  // 该对话开新一回合就消）。
  it('守卫示警 ⇒ 该对话标记为「遇到问题」（顶部横幅 + 侧栏红叉）', async () => {
    const conversations = await loadRuntime()
    handlers.get('engine-event')?.({ payload: {
      sessionId: 'conversation-1',
      type: 'guard.alarm',
      notice: '已停止本轮：agent 连续 3 次试图写入受限路径（…）。',
      noticeEnglish: 'Stopped this turn: …',
    } })
    expect(conversations.activeProblemTurn?.notice).toContain('已停止本轮')
    expect(conversations.conversationHasProblem('conversation-1')).toBe(true)
    expect(conversations.problemConversationIds).toContain('conversation-1')
  })

  // 口径：**只要守卫示警就上顶部横幅 + 侧栏红叉**，不分等级。
  it('普通的守卫示警：同样上顶部横幅 + 红叉', async () => {
    const conversations = await loadRuntime()
    handlers.get('engine-event')?.({ payload: {
      sessionId: 'conversation-1',
      type: 'guard.alarm',
      notice: '已拦截：这一步被守卫拦下。',
      noticeEnglish: 'Blocked: this step was stopped by the guard.',
    } })
    expect(conversations.activeProblemTurn?.notice).toContain('已拦截')
    expect(conversations.conversationHasProblem('conversation-1')).toBe(true)
    expect(conversations.problemConversationIds).toContain('conversation-1')
  })



  it('该对话开新一回合 ⇒ 标记消除；别的对话不受影响', async () => {
    const conversations = await loadRuntime()
    handlers.get('engine-event')?.({ payload: {
      sessionId: 'conversation-1',
      type: 'guard.alarm',
      notice: '已停止本轮：…',
      noticeEnglish: 'Stopped this turn: …',
    } })
    expect(conversations.activeProblemTurn).not.toBeNull()
    // 别的对话也先亮着：不能被“当前对话开新回合”误清。
    handlers.get('engine-event')?.({ payload: {
      sessionId: 'conversation-2',
      type: 'guard.alarm',
      notice: '已停止本轮：…',
      noticeEnglish: 'Stopped this turn: …',
    } })
    handlers.get('engine-event')?.({ payload: { sessionId: 'conversation-1', type: 'assistant.started' } })
    expect(conversations.activeProblemTurn).toBeNull()
    expect(conversations.conversationHasProblem('conversation-1')).toBe(false)
    expect(conversations.conversationHasProblem('conversation-2')).toBe(true)
  })

  // 读者补充：「Agent 运行失败」也会让对话停住 ⇒ 同样要亮红叉 + 顶部常驻横幅。
  it('「Agent 运行失败」也算这一轮没能正常继续 ⇒ 亮红叉 + 顶部横幅', async () => {
    const conversations = await loadRuntime()
    handlers.get('engine-event')?.({ payload: {
      sessionId: 'conversation-1',
      type: 'engine.error',
      error: 'terminated',
      done: true,
    } })
    expect(conversations.conversationHasProblem('conversation-1')).toBe(true)
    expect(conversations.activeProblemTurn?.notice).toContain('运行失败')
  })

  it('用户主动停下的那种（aborted/cancelled）不算问题', async () => {
    const conversations = await loadRuntime()
    handlers.get('engine-event')?.({ payload: {
      sessionId: 'conversation-1',
      type: 'engine.error',
      error: 'aborted',
      done: true,
    } })
    expect(conversations.conversationHasProblem('conversation-1')).toBe(false)
    expect(conversations.activeProblemTurn).toBeNull()
  })

  // 读者要求：横幅上要有「知道了」按钮，点了立刻消除；同时“发下一条消息也消”照旧。
  it('点「知道了」⇒ 问题标记立刻消除（侧栏红叉同时灭）', async () => {
    const conversations = await loadRuntime()
    handlers.get('engine-event')?.({ payload: {
      sessionId: 'conversation-1',
      type: 'guard.alarm',
      notice: '已停止本轮：…',
      noticeEnglish: 'Stopped this turn: …',
    } })
    expect(conversations.conversationHasProblem('conversation-1')).toBe(true)
    conversations.dismissProblemTurn()
    expect(conversations.activeProblemTurn).toBeNull()
    expect(conversations.conversationHasProblem('conversation-1')).toBe(false)
  })


  // 读者要求：复读告警也要上顶栏 + 红叉（不再只是一条容易错过的提示）。
  it('思考复读告警 ⇒ 上顶栏 + 红叉', async () => {
    const conversations = await loadRuntime()
    handlers.get('engine-event')?.({ payload: {
      sessionId: 'conversation-1',
      type: 'guard.alarm',
      notice: '检测到这一步的思考在复读（连续 8 行完全相同）。这一步中途无法中止，只能先把情况告诉你。',
      noticeEnglish: 'This thinking step is repeating itself (8 identical lines in a row).',
    } })
    expect(conversations.activeProblemTurn?.notice).toContain('复读')
    expect(conversations.conversationHasProblem('conversation-1')).toBe(true)
  })


  /** 一个"重启后从记录里读回来"的对话：只有落盘的 agentProblem，没有任何事件。 */
  function storedProblemConversation() {
    return {
      id: 'conversation-1',
      title: 'blocked before restart',
      createdAt: 1,
      kernel: 'dsh',
      messages: [],
      agentProblem: { notice: '已停止本轮：…', noticeEnglish: 'Stopped this turn: …', at: 1 },
    }
  }

  // 落盘路径（读者要的"重启后仍保留"）：事件早就过去了 ⇒ 界面必须靠记录里的 agentProblem
  // 显示横幅 + 红叉。（Work 那笔只加了 Go 侧测试，这条前端回归是我补的。）
  it('重启后：记录里带着 agentProblem ⇒ 横幅 + 红叉仍然显示（不靠任何事件）', async () => {
    const conversations = await loadRuntime()
    conversations.conversations = [storedProblemConversation()]
    expect(conversations.activeProblemTurn?.notice).toContain('已停止本轮')
    expect(conversations.conversationHasProblem('conversation-1')).toBe(true)
    expect(conversations.problemConversationIds).toContain('conversation-1')
  })

  it('点「知道了」⇒ 调引擎命令清落盘记录，本地也立刻清', async () => {
    const conversations = await loadRuntime()
    conversations.conversations = [storedProblemConversation()]
    const invoke = vi.mocked(invokeCommand)
    invoke.mockClear()
    conversations.dismissProblemTurn()
    expect(conversations.activeProblemTurn).toBeNull()
    expect(conversations.conversationHasProblem('conversation-1')).toBe(false)
    // 不清落盘那份 ⇒ 重开 App 横幅会回来 ✗（读者点的是"知道了"）。
    expect(invoke).toHaveBeenCalledWith('clear_conversation_problem', { conversationId: 'conversation-1' })
  })


  // 真机抓到的坑（19:32:03 落盘 ✓、19:32:10 前端保存后没了 ✗）：前端用**整份对话对象**
  // 调 save_conversation ⇒ 对象里不带 agentProblem 就会把引擎刚落盘的那份抹掉。
  it('收到拦截时，对话对象本身也要带上 agentProblem（否则前端保存会抹掉落盘）', async () => {
    const conversations = await loadRuntime()
    conversations.conversations = [{
      id: 'conversation-1',
      title: 't',
      createdAt: 1,
      kernel: 'dsh',
      messages: [],
    }]
    handlers.get('engine-event')?.({ payload: {
      sessionId: 'conversation-1',
      type: 'guard.alarm',
      notice: '已拦截：这一步被守卫拦下。',
      noticeEnglish: 'Blocked: this step was stopped by the guard.',
    } })
    const record = conversations.conversations.find(item => item.id === 'conversation-1')
    expect(record?.agentProblem?.notice).toContain('已拦截')
    expect(record?.agentProblem?.noticeEnglish).toContain('Blocked')
  })


  // 真机抓到的断点：`normalizeConversation` 是**逐字段挑**的，漏了 agentProblem ⇒
  // 重启加载后字段没了，前端再保存回去 ⇒ 记录也空了（横幅/红叉全丢）。
  it('映射层：normalizeConversation 必须带上 agentProblem（断过就在这里）', () => {
    const record = normalizeConversation({
      id: 'conversation-1',
      title: 't',
      agentProblem: { notice: '已拦截：…', noticeEnglish: 'Blocked: …', at: 1 },
    })
    expect(record.agentProblem?.notice).toContain('已拦截')
    expect(record.agentProblem?.noticeEnglish).toContain('Blocked')
    // 形状不对 / 两条都空 ⇒ 当作没有，别塞半个对象进界面。
    expect(normalizeConversation({ id: 'x' }).agentProblem).toBeUndefined()
    expect(normalizeConversation({ id: 'x', agentProblem: { notice: '   ' } }).agentProblem).toBeUndefined()
  })

})
