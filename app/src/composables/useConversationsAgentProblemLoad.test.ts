import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { createConversationsRuntime, normalizeConversation } from './useConversations'

// 第 7 项前端那半：被拦状态要**存得住、读得回**。
// ① 保存路径：markProblemTurn 必须同时写进 s.conversations（只写 problemTurns 会在保存时被抹掉 ✗）；
// ② 加载路径：normalizeConversation 必须保留 agentProblem（少了映射 ⇒ 重启后横幅与红叉都不见了 ✗）。
describe('被拦状态的保存与加载', () => {
  it('加载：normalizeConversation 保留落盘的 agentProblem', () => {
    const record = normalizeConversation({
      id: 'c1',
      agentProblem: { notice: '被拦：受限文件夹。', noticeEnglish: 'Blocked: protected folder.', at: 1712345678 },
    })
    expect(record.agentProblem).toEqual({
      notice: '被拦：受限文件夹。',
      noticeEnglish: 'Blocked: protected folder.',
      at: 1712345678,
    })
  })

  it('加载：形状不对或两条都空 ⇒ 当作没有（不塞半个对象进界面）', () => {
    expect(normalizeConversation({ id: 'c1', agentProblem: 'nonsense' }).agentProblem).toBeUndefined()
    expect(normalizeConversation({ id: 'c1', agentProblem: { notice: '   ' } }).agentProblem).toBeUndefined()
    expect(normalizeConversation({ id: 'c1' }).agentProblem).toBeUndefined()
  })

  it('保存：markProblemTurn 同时把记录写进该对话（否则保存时被抹掉）', () => {
    const rt = createConversationsRuntime({ live: false })
    rt.markProblemTurn('c1', '被拦：受限文件夹。', 'Blocked: protected folder.')
    const item = rt.conversations.find(conversation => conversation.id === 'c1')
    // 列表里没有这条对话时只记账（这是允许的）；有则必须带上 agentProblem。
    if (item) {
      expect(item.agentProblem?.notice).toBe('被拦：受限文件夹。')
    } else {
      expect(rt.conversationHasProblem('c1')).toBe(true)
    }
  })
})

// ⚠️ 上面第 3 条用例在单测里**钉不住**保存路径 ✗（运行时 `s.conversations` 里没有那条对话 ⇒
// 会走 else 分支 ⇒ 即使注掉写回也照样绿 ✗ = 假绿 ✗）。所以另加一条**源码守卫**把写回钉死 ✓。
describe('保存路径的源码守卫（位置级精度 ✓）', () => {
  const source = readFileSync(new URL('./useConversations.ts', import.meta.url), 'utf8')

  // ⚠️ 不能用 indexOf('\n  }') 切函数体 ✗：markProblemTurn 体内有嵌套块 ⇒ 会切到内层花括号 ⇒
  // 切不到真正的写回那行 ✗（我已踩过 ✓）。也不能只判"文件里有这句话" ✗：dropStoredProblemTurn
  // 里还有同样一句 ⇒ 注掉 markProblemTurn 里的写回也照样绿 ⇒ 假绿 ✗。
  // ⇒ 用**位置比较**：写回必须在 markProblemTurn 体内（下一个兄弟声明之前）✓。
  it('markProblemTurn 必须把 agentProblem 写回对话列表（否则保存时被抹掉）', () => {
    const fnStart = source.indexOf('function markProblemTurn(')
    expect(fnStart).toBeGreaterThan(-1)
    const rest = source.slice(fnStart + 1)
    const boundaries = ['\n  function ', '\n  async function ', '\n  const ']
      .map(pattern => rest.indexOf(pattern))
      .filter(index => index > 0)
    const end = boundaries.length ? Math.min(...boundaries) : rest.length
    const fnBody = rest.slice(0, end)
    expect(fnBody.indexOf('next[index] = { ...list[index], agentProblem:')).toBeGreaterThan(-1)
    expect(fnBody.indexOf('store.setState({ conversations: next })')).toBeGreaterThan(-1)
  })
})
