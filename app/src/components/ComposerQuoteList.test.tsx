// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ComposerQuoteList } from '@/components/ComposerQuoteList'
import type { ComposerQuote } from '@/lib/composerQuote'

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

function render(quotes: ComposerQuote[], onRemove = vi.fn()) {
  act(() => {
    root.render(<ComposerQuoteList quotes={quotes} onRemove={onRemove} />)
  })
  return onRemove
}

describe('composer quote list', () => {
  // Nothing quoted: the strip stays out of the way, so an ordinary composer is unchanged.
  it('renders nothing when there is no quote', () => {
    render([])
    expect(host.querySelector('[data-testid="composer-quote-list"]')).toBeNull()
  })

  it('shows every quote above the input', () => {
    render([
      { id: 'q1', text: '第一条引用' },
      { id: 'q2', text: '第二条引用' },
    ])
    const strip = host.querySelector('[data-testid="composer-quote-list"]')
    expect(strip).not.toBeNull()
    expect(strip?.textContent ?? '').toContain('第一条引用')
    expect(strip?.textContent ?? '').toContain('第二条引用')
  })

  // Each quote can be removed on its own: several quotes must not become all-or-nothing.
  it('removes exactly the quote whose button was pressed', () => {
    const onRemove = render([
      { id: 'q1', text: '第一条引用' },
      { id: 'q2', text: '第二条引用' },
    ])
    act(() => {
      host.querySelector<HTMLButtonElement>('[data-testid="composer-quote-remove-q2"]')?.click()
    })
    expect(onRemove).toHaveBeenCalledWith('q2')
  })

  it('collapses a long quote so the strip stays usable', () => {
    render([{ id: 'q1', text: 'x'.repeat(600) }])
    const text = host.querySelector('[data-testid="composer-quote-text-q1"]')?.textContent ?? ''
    expect(text.length).toBeLessThan(600)
  })
})
