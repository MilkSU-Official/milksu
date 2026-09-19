// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConversationQuoteMenu, selectedTextIn } from '@/components/ConversationQuoteMenu'

let host: HTMLDivElement
let transcript: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  transcript = document.createElement('div')
  transcript.innerHTML = '<p>助手说的一段话</p><p>另一段</p>'
  document.body.append(transcript, host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  transcript.remove()
  window.getSelection()?.removeAllRanges()
})

function select(node: Node, offset = 0, length = 0) {
  const range = document.createRange()
  range.setStart(node, offset)
  range.setEnd(node, offset + length)
  const selection = window.getSelection()!
  selection.removeAllRanges()
  selection.addRange(range)
}

describe('conversation quote menu', () => {
  // Only a real selection inside the transcript may offer the item, so a stray right click cannot
  // quote anything.
  it('reads the selected text only when the selection is inside the transcript', () => {
    const inside = transcript.querySelector('p')!.firstChild!
    select(inside, 0, 3)
    expect(selectedTextIn(transcript)).toBe('助手说')

    window.getSelection()!.removeAllRanges()
    expect(selectedTextIn(transcript)).toBe('')

    const outside = document.createElement('p')
    outside.textContent = '输入框里的字'
    document.body.append(outside)
    select(outside.firstChild!, 0, 3)
    expect(selectedTextIn(transcript)).toBe('')
    outside.remove()
  })

  it('offers 加入对话 and hands the selected text over when clicked', async () => {
    const onAdd = vi.fn()
    const onDismiss = vi.fn()
    act(() => {
      root.render(
        <ConversationQuoteMenu
          text="助手说的一段话"
          x={10}
          y={20}
          onAdd={onAdd}
          onDismiss={onDismiss}
        />,
      )
    })

    const item = host.querySelector('[data-testid="conversation-quote-add"]')
    expect(item).not.toBeNull()
    expect(item?.textContent ?? '').toContain('加入对话')

    act(() => (item as HTMLElement).click())
    expect(onAdd).toHaveBeenCalledWith('助手说的一段话')
  })

  // Escape closes the menu without quoting anything.
  it('closes on Escape without adding anything', () => {
    const onAdd = vi.fn()
    const onDismiss = vi.fn()
    act(() => {
      root.render(
        <ConversationQuoteMenu text="引用" x={0} y={0} onAdd={onAdd} onDismiss={onDismiss} />,
      )
    })
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(onDismiss).toHaveBeenCalled()
    expect(onAdd).not.toHaveBeenCalled()
  })
})
