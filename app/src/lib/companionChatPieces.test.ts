import { describe, expect, it } from 'vitest'
import { companionChatPieces } from '@/lib/companionChatPieces'

describe('companionChatPieces', () => {
  it('leaves markdown as one block', () => {
    const text = '先看一下。\n\n' + '细节。'.repeat(80)
    expect(companionChatPieces(text, 'markdown')).toEqual([{ kind: 'bubble', text: text.trim() }])
  })

  it('splits short chat lines into bubbles', () => {
    expect(companionChatPieces('我先看一下。\n\n这三条是一件事。', 'chat')).toEqual([
      { kind: 'bubble', text: '我先看一下。' },
      { kind: 'bubble', text: '这三条是一件事。' },
    ])
  })

  it('folds a long middle into a note and keeps the short edges', () => {
    const body = ['## 根因', ...Array.from({ length: 8 }, (_, index) => `${index + 1}. 这一条比较长，需要单独展开说明。`)].join('\n')
    const pieces = companionChatPieces(`我先看这三条。\n\n${body}\n\n这三条是一件事。`, 'chat')
    expect(pieces.map(piece => piece.kind)).toEqual(['bubble', 'note', 'bubble'])
    expect(pieces[0]).toMatchObject({ text: '我先看这三条。' })
    expect(pieces[1]).toMatchObject({ kind: 'note', title: '根因' })
    expect(pieces[2]).toMatchObject({ text: '这三条是一件事。' })
  })

  it('turns one long essay into a note', () => {
    const text = '这段说明比较长，不适合塞进一个气泡里。'.repeat(12)
    const pieces = companionChatPieces(text, 'chat')
    expect(pieces).toHaveLength(1)
    expect(pieces[0]?.kind).toBe('note')
  })
})
