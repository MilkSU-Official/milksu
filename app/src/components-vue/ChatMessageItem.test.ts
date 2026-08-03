// @vitest-environment jsdom

import { createApp, nextTick, type App } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import ChatMessageItem from './ChatMessageItem.vue'
import type { Message } from '@/types'

const mountedApps: App[] = []

afterEach(() => {
  for (const app of mountedApps.splice(0)) app.unmount()
  document.body.innerHTML = ''
})

async function mountMessage(message: Message) {
  const responses: Array<{ requestId: string, approved: boolean }> = []
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp(ChatMessageItem, {
    message,
    onRespondApproval: (requestId: string, approved: boolean) => {
      responses.push({ requestId, approved })
    },
  })
  app.mount(host)
  mountedApps.push(app)
  await nextTick()
  return { host, responses }
}

describe('ChatMessageItem', () => {
  it('redacts provider credentials from approval cards without disabling the decision', async () => {
    const { host, responses } = await mountMessage({
      id: 'message-approval',
      role: 'tool',
      content: '即将运行 Bearer sk-content-secret-123456789',
      timestamp: 1,
      toolName: 'bash',
      approvalRequestId: 'approval-redaction',
      approvalState: 'pending',
      approvalInput: JSON.stringify({
        command: 'OPENAI_API_KEY=sk-input-secret-123456789 npm test',
        header: 'x-api-key: sk-header-secret-123456789',
      }),
    })

    const text = host.textContent ?? ''
    expect(text).toContain('Bearer [credential redacted]')
    expect(text).toContain('OPENAI_API_KEY=[credential redacted] npm test')
    expect(text).toContain('x-api-key: [credential redacted]')
    expect(text).not.toContain('sk-content-secret')
    expect(text).not.toContain('sk-input-secret')
    expect(text).not.toContain('sk-header-secret')

    const allow = [...host.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent?.includes('允许这一次'))
    expect(allow).toBeDefined()
    allow?.click()
    await nextTick()
    expect(responses).toEqual([{ requestId: 'approval-redaction', approved: true }])
  })
})
