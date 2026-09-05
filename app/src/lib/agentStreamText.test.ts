// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import { decorateAgentStream } from './agentStreamText'

describe('decorateAgentStream', () => {
  it('keeps streamed text sharp and places a solid caret at the end', () => {
    const root = document.createElement('div')
    root.innerHTML = '<p>Pistachio is growing</p>'
    decorateAgentStream(root, true)
    expect(root.querySelector('.agent-stream-tail')).toBeNull()
    expect(root.textContent).toBe('Pistachio is growing')
    const caret = root.querySelector('.agent-stream-caret')
    expect(caret).not.toBeNull()
    expect(caret?.classList.contains('is-streaming')).toBe(true)
    expect(caret?.getAttribute('aria-hidden')).toBe('true')
    expect(root.querySelector('p')?.lastChild).toBe(caret)
  })

  it('keeps CJK characters unblurred while streaming', () => {
    const root = document.createElement('div')
    root.innerHTML = '<p>正在写完整回复</p>'
    decorateAgentStream(root, true)
    expect(root.querySelector('.agent-stream-tail')).toBeNull()
    expect(root.textContent).toBe('正在写完整回复')
    expect(root.querySelector('.agent-stream-caret')).not.toBeNull()
  })

  it('removes the stream caret when the turn settles', () => {
    const root = document.createElement('div')
    root.innerHTML = '<p>写完了</p>'
    decorateAgentStream(root, true)
    decorateAgentStream(root, false)
    expect(root.querySelector('.agent-stream-tail')).toBeNull()
    expect(root.querySelector('.agent-stream-caret')).toBeNull()
    expect(root.textContent).toBe('写完了')
  })

  it('unwraps a leftover blur tail from an older stream decoration', () => {
    const root = document.createElement('div')
    root.innerHTML = '<p>Pistachio is g<span class="agent-stream-tail">rowing</span></p>'
    decorateAgentStream(root, true)
    expect(root.querySelector('.agent-stream-tail')).toBeNull()
    expect(root.textContent).toBe('Pistachio is growing')
    expect(root.querySelector('.agent-stream-caret')).not.toBeNull()
  })

  it('ignores trailing markdown whitespace nodes', () => {
    const root = document.createElement('div')
    root.innerHTML = '<p>Pistachio is growing</p>\n'
    decorateAgentStream(root, true)
    expect(root.textContent).toBe('Pistachio is growing\n')
    expect(root.querySelector('p')?.lastChild?.nodeName).toBe('SPAN')
  })
})
