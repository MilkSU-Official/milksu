// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import { AGENT_STREAM_BLUR_TAIL, decorateAgentStream } from './agentStreamText'

describe('decorateAgentStream', () => {
  it('blurs the newest characters and keeps a solid caret while streaming', () => {
    const root = document.createElement('div')
    root.innerHTML = '<p>Pistachio is growing</p>'
    decorateAgentStream(root, true)
    expect(root.querySelector('.agent-stream-tail')?.textContent).toBe('rowing')
    expect(root.textContent).toBe('Pistachio is growing')
    const caret = root.querySelector('.agent-stream-caret')
    expect(caret).not.toBeNull()
    expect(caret?.classList.contains('is-streaming')).toBe(true)
    expect(caret?.getAttribute('aria-hidden')).toBe('true')
  })

  it('counts Unicode characters for the blur tail', () => {
    const root = document.createElement('div')
    root.innerHTML = '<p>正在写完整回复</p>'
    decorateAgentStream(root, true)
    expect(root.querySelector('.agent-stream-tail')?.textContent).toBe('在写完整回复')
    expect(root.textContent).toBe('正在写完整回复')
  })

  it('removes the stream edge when the turn settles', () => {
    const root = document.createElement('div')
    root.innerHTML = '<p>写完了</p>'
    decorateAgentStream(root, true)
    decorateAgentStream(root, false)
    expect(root.querySelector('.agent-stream-tail')).toBeNull()
    expect(root.querySelector('.agent-stream-caret')).toBeNull()
    expect(root.textContent).toBe('写完了')
  })

  it('ignores trailing markdown whitespace nodes', () => {
    const root = document.createElement('div')
    root.innerHTML = '<p>Pistachio is growing</p>\n'
    decorateAgentStream(root, true)
    expect(root.querySelector('.agent-stream-tail')?.textContent).toBe('rowing')
  })

  it('keeps the blur tail at six characters', () => {
    expect(AGENT_STREAM_BLUR_TAIL).toBe(6)
  })
})
