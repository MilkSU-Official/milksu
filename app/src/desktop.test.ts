// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { invokeCommand } from './desktop'

afterEach(() => {
  vi.restoreAllMocks()
  Reflect.deleteProperty(window, 'go')
})

describe('desktop command adapter', () => {
  it('passes the selected Computer Use PID and window id to Wails unchanged', async () => {
    const status = {
      available: true,
      enabled: true,
      conversationId: 'conversation-ui',
      phase: 'ready',
      target: {
        name: 'Codex',
        bundleId: 'com.openai.codex',
        pid: 4242,
        windowId: 9001,
      },
      permissions: {
        accessibility: true,
        screenRecording: true,
      },
    }
    const startCodingComputerUse = vi.fn(async () => status)
    Object.defineProperty(window, 'go', {
      configurable: true,
      value: {
        main: {
          App: {
            StartCodingComputerUse: startCodingComputerUse,
          },
        },
      },
    })

    await expect(invokeCommand('start_coding_computer_use', {
      conversationId: 'conversation-ui',
      targetPid: 4242,
      targetWindowId: 9001,
    })).resolves.toBe(status)

    expect(startCodingComputerUse).toHaveBeenCalledWith(
      'conversation-ui',
      4242,
      9001,
    )
  })
})
