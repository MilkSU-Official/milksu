import { afterEach, describe, expect, it } from 'vitest'
import { composerDraftKey } from '@/lib/composerDraftStore'
import {
  clearComposerQuotes,
  readComposerQuotes,
  resetComposerQuotes,
  writeComposerQuotes,
} from '@/lib/composerQuoteStore'

afterEach(() => resetComposerQuotes())

describe('composer quotes survive a switch', () => {
  // 真机 beta.41：有引用时切换对话，切回来引用被清空（文字还在）。切换路径会顺手写一次
  // 空数组，旧规则把"空写"当成"删除"，于是读者选好的引用在切走那一刻就没了。
  it('does not let an empty write delete stored quotes', () => {
    resetComposerQuotes()
    const key = composerDraftKey('conversation-a')
    const quotes = [
      { id: 'q1', text: '第一条引用' },
      { id: 'q2', text: '第二条引用' },
    ]
    writeComposerQuotes(key, quotes)
    // 切换对话时那一笔空写
    writeComposerQuotes(key, [])

    expect(readComposerQuotes(key)).toEqual(quotes)
  })

  // 多条引用、顺序都要保持（用户切回来后看到的是原来那几条，顺序不变）。
  it('keeps every quote and its order across a switch away and back', () => {
    resetComposerQuotes()
    const a = composerDraftKey('conversation-a')
    const b = composerDraftKey('conversation-b')
    const quotesA = [
      { id: 'q1', text: 'A 的第一条' },
      { id: 'q2', text: 'A 的第二条' },
      { id: 'q3', text: 'A 的第三条' },
    ]
    writeComposerQuotes(a, quotesA)
    writeComposerQuotes(b, [{ id: 'qb', text: 'B 的引用' }])
    // 切走 A（空写）→ 切到 B → 再切回 A
    writeComposerQuotes(a, [])
    writeComposerQuotes(b, [{ id: 'qb', text: 'B 的引用' }])

    expect(readComposerQuotes(a)).toEqual(quotesA)
    expect(readComposerQuotes(b)).toEqual([{ id: 'qb', text: 'B 的引用' }])
  })

  // 逐条删除必须真的生效：写回"剩下的那几条"是合法写入，不能被保护挡回来。
  it('still honours an explicit per-item removal', () => {
    resetComposerQuotes()
    const key = composerDraftKey('conversation-a')
    writeComposerQuotes(key, [
      { id: 'q1', text: '留下的' },
      { id: 'q2', text: '要删掉的' },
    ])
    writeComposerQuotes(key, [{ id: 'q1', text: '留下的' }])
    expect(readComposerQuotes(key)).toEqual([{ id: 'q1', text: '留下的' }])
  })

  // 显式清空仍要清掉（发送、以及 archive/remove 的清理路径都走它）。
  it('still clears on an explicit clear', () => {
    resetComposerQuotes()
    const key = composerDraftKey('conversation-a')
    writeComposerQuotes(key, [{ id: 'q1', text: '引用' }])
    clearComposerQuotes(key)
    expect(readComposerQuotes(key)).toBeUndefined()
  })
})

describe('composer quote store', () => {
  // Quotes are kept per conversation, exactly like the draft, so switching away and back does not
  // lose what the reader had selected.
  it('keeps quotes per conversation and survives a switch away and back', () => {
    const first = composerDraftKey('conversation-a')
    const second = composerDraftKey('conversation-b')

    writeComposerQuotes(first, [{ id: 'q1', text: '第一条会话的引用' }])
    writeComposerQuotes(second, [{ id: 'q2', text: '第二条会话的引用' }])

    expect(readComposerQuotes(first)).toEqual([{ id: 'q1', text: '第一条会话的引用' }])
    expect(readComposerQuotes(second)).toEqual([{ id: 'q2', text: '第二条会话的引用' }])

    // Switching away and back is just reading the same key again.
    expect(readComposerQuotes(first)?.[0]?.text).toBe('第一条会话的引用')
  })

  // A pending (not yet created) conversation keys by workspace home, the same rule drafts use.
  it('keys a pending conversation by workspace home', () => {
    const key = composerDraftKey(null, 'coding')
    writeComposerQuotes(key, [{ id: 'q1', text: '待创建会话的引用' }])
    expect(readComposerQuotes(key)).toHaveLength(1)
    expect(readComposerQuotes(composerDraftKey(null, 'chat'))).toBeUndefined()
  })

  // Sending clears them; an empty list is the same as none, so no empty record lingers.
  // 这一条原来断言"空数组等于删除"。那条规则就是本次缺陷本身：切换对话会顺手写一次空数组，
  // 于是引用在切走那一刻被清掉（真机 beta.41）。改成"只有显式 clear 才清"，空写保留。
  it('clears quotes only on an explicit clear, never on an empty write', () => {
    const key = composerDraftKey('conversation-a')
    writeComposerQuotes(key, [{ id: 'q1', text: '引用' }])
    clearComposerQuotes(key)
    expect(readComposerQuotes(key)).toBeUndefined()

    writeComposerQuotes(key, [{ id: 'q1', text: '引用' }])
    writeComposerQuotes(key, [])
    expect(readComposerQuotes(key)).toEqual([{ id: 'q1', text: '引用' }])
  })

  // Copies in and out, so a caller cannot mutate the stored list by accident.
  it('hands out copies', () => {
    const key = composerDraftKey('conversation-a')
    const input = [{ id: 'q1', text: '引用' }]
    writeComposerQuotes(key, input)
    input[0]!.text = '被改掉了'
    expect(readComposerQuotes(key)?.[0]?.text).toBe('引用')

    const read = readComposerQuotes(key)
    read![0]!.text = '又被改掉了'
    expect(readComposerQuotes(key)?.[0]?.text).toBe('引用')
  })
})
