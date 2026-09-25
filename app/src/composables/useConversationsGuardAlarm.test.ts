import { describe, expect, it } from 'vitest'
import { createConversationsRuntime } from './useConversations'

// 6a-1：受限文件夹被拦后的「常驻问题状态」状态机。读者口径：
// ① 只要被拦就标记（不分单次/停轮）；② 开新一回合才清除；③ 点「知道了」清除。
function runtime() {
  return createConversationsRuntime({ live: false })
}

describe('被拦对话的常驻问题状态', () => {
  it('标记后：内存里有、派生值认得出（只要被拦就标记）', () => {
    const rt = runtime()
    rt.markProblemTurn('c1', '这个对话被拦了一次写入。', 'A write was blocked.')
    expect(rt.conversationHasProblem('c1')).toBe(true)
    expect(rt.problemConversationIds.has('c1')).toBe(true)
  })

  it('只标记被拦的那个对话，别的对话不受影响', () => {
    const rt = runtime()
    rt.markProblemTurn('c1', '被拦：受限文件夹。', 'Blocked: protected folder.')
    expect(rt.conversationHasProblem('c1')).toBe(true)
    expect(rt.conversationHasProblem('c2')).toBe(false)
    expect(rt.problemConversationIds.has('c2')).toBe(false)
  })

  it('开新一回合（clearProblemTurn）后不再显示', () => {
    const rt = runtime()
    rt.markProblemTurn('c1', '被拦：受限文件夹。', 'Blocked: protected folder.')
    rt.clearProblemTurn('c1')
    expect(rt.conversationHasProblem('c1')).toBe(false)
    expect(rt.problemConversationIds.has('c1')).toBe(false)
  })

  it('点「知道了」（dismissProblemTurn）后不再显示', () => {
    const rt = runtime()
    rt.markProblemTurn('c1', '被拦：受限文件夹。', 'Blocked: protected folder.')
    try {
      rt.dismissProblemTurn('c1')
    } catch {
      // 单测环境里命令通道可能不存在：清除本身必须照做。
    }
    expect(rt.conversationHasProblem('c1')).toBe(false)
    expect(rt.problemConversationIds.has('c1')).toBe(false)
  })
})
