import { describe, expect, it } from 'vitest'
import { extractLatestComputerUseOperationEvidence } from './codingComputerUseEvidence'
import type { Message } from '@/types'

function toolMessage(overrides: Partial<Message>): Message {
  return {
    id: crypto.randomUUID(),
    role: 'tool',
    content: '',
    timestamp: Date.now(),
    toolName: 'computer_use',
    status: 'done',
    ...overrides,
  }
}

describe('codingComputerUseEvidence', () => {
  it('extracts the latest completed Computer Use operation envelope', () => {
    const evidence = extractLatestComputerUseOperationEvidence([
      toolMessage({
        content: JSON.stringify({
          action: 'observe',
          driverTool: 'get_window_state',
          target: {
            app: 'Preview',
            bundleId: 'com.example.preview',
            pid: 123,
            windowId: 456,
            title: '视觉回归',
          },
          output: { elements: [] },
        }, null, 2),
        durationMs: 32,
      }),
      toolMessage({
        toolName: 'mcp__milksu-computer-use__computer_use',
        content: `{"action":"click","element_index":7}\n\n${JSON.stringify({
          action: 'click',
          driverTool: 'click',
          target: {
            app: 'TextEdit',
            bundleId: 'com.apple.TextEdit',
            pid: 789,
            windowId: 321,
            title: 'Untitled',
          },
          output: { verified: true },
        }, null, 2)}`,
        durationMs: 54,
      }),
    ])

    expect(evidence).toMatchObject({
      action: 'click',
      targetName: 'TextEdit',
      bundleId: 'com.apple.TextEdit',
      pid: 789,
      windowId: 321,
      windowTitle: 'Untitled',
      durationMs: 54,
    })
    expect(evidence?.summary).toContain('click · TextEdit')
  })

  it('does not turn connected scope text or malformed output into operation evidence', () => {
    expect(extractLatestComputerUseOperationEvidence([
      toolMessage({
        content: 'Computer Use 已接入 Preview · PID 123 · Window 456',
      }),
      toolMessage({
        status: 'running',
        content: JSON.stringify({
          action: 'observe',
          target: {
            app: 'Preview',
            bundleId: 'com.example.preview',
            pid: 123,
            windowId: 456,
          },
        }),
      }),
      toolMessage({
        toolName: 'bash',
        content: JSON.stringify({
          action: 'click',
          target: {
            app: 'Preview',
            bundleId: 'com.example.preview',
            pid: 123,
            windowId: 456,
          },
        }),
      }),
    ])).toBeNull()
  })

  it('does not count observe-only window reads as external app operation evidence', () => {
    expect(extractLatestComputerUseOperationEvidence([
      toolMessage({
        content: JSON.stringify({
          action: 'observe',
          driverTool: 'get_window_state',
          target: {
            app: 'Preview',
            bundleId: 'com.example.preview',
            pid: 123,
            windowId: 456,
          },
          output: { elements: [{ role: 'button', label: '确定' }] },
        }),
      }),
      toolMessage({
        content: JSON.stringify({
          driverTool: 'list_windows',
          target: {
            app: 'Preview',
            bundleId: 'com.example.preview',
            pid: 123,
            windowId: 456,
          },
        }),
      }),
    ])).toBeNull()
  })

  it('normalizes driver tool names for real click, typing, key and scroll operations', () => {
    for (const [driverTool, expectedAction] of [
      ['click', 'click'],
      ['type_text', 'type'],
      ['press_key', 'key'],
      ['scroll', 'scroll'],
    ] as const) {
      const evidence = extractLatestComputerUseOperationEvidence([
        toolMessage({
          content: JSON.stringify({
            driverTool,
            target: {
              app: 'TextEdit',
              bundleId: 'com.apple.TextEdit',
              pid: 789,
              windowId: 321,
            },
          }),
        }),
      ])
      expect(evidence?.action).toBe(expectedAction)
      expect(evidence?.summary).toContain(`${expectedAction} · TextEdit`)
    }
  })
})
