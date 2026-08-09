// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { invokeCommand } from './desktop'

afterEach(() => {
  delete (window as unknown as { go?: unknown }).go
})

describe('Coding Browser evidence desktop binding', () => {
  it('forwards only the trusted conversation id to Wails', async () => {
    const reveal = vi.fn(async () => undefined)
    ;(window as unknown as { go?: unknown }).go = {
      main: {
        App: {
          RevealCodingBrowserEvidence: reveal,
        },
      },
    }

    await invokeCommand('reveal_coding_browser_evidence', {
      conversationId: 'conversation-1',
      path: '/tmp/untrusted',
      sessionId: 'browser_untrusted',
    })

    expect(reveal).toHaveBeenCalledOnce()
    expect(reveal).toHaveBeenCalledWith('conversation-1')
  })

  it('rejects the command outside the desktop runtime', async () => {
    await expect(invokeCommand(
      'reveal_coding_browser_evidence',
      { conversationId: 'conversation-1' },
    )).rejects.toThrow('MilkSU desktop runtime is unavailable')
  })
})
