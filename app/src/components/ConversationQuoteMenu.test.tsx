// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { selectedTextIn, selectionQuotePoint } from '@/components/ConversationQuoteMenu'

let transcript: HTMLDivElement

beforeEach(() => {
  transcript = document.createElement('div')
  transcript.innerHTML = '<p>助手说的一段话</p><p>另一段</p>'
  document.body.append(transcript)
})

afterEach(() => {
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

describe('selectedTextIn', () => {
  // Only a real selection inside the transcript may be quoted, so a right click on the composer
  // can never pick up something the reader did not select in the conversation.
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

  it('anchors the quote chip to a selection inside the transcript', () => {
    const inside = transcript.querySelector('p')!.firstChild!
    select(inside, 0, 3)
    expect(selectionQuotePoint(transcript)?.text).toBe('助手说')
    window.getSelection()!.removeAllRanges()
    expect(selectionQuotePoint(transcript)).toBeNull()
  })
})
