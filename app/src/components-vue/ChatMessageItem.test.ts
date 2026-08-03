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

async function mountMessage(
  message: Message,
  props: Partial<InstanceType<typeof ChatMessageItem>['$props']> = {},
) {
  const responses: Array<{ requestId: string, approved: boolean }> = []
  let retried = false
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp(ChatMessageItem, {
    message,
    ...props,
    onRespondApproval: (requestId: string, approved: boolean) => {
      responses.push({ requestId, approved })
    },
    onRetry: () => {
      retried = true
    },
  })
  app.mount(host)
  mountedApps.push(app)
  await nextTick()
  return { host, responses, retried: () => retried }
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

  it('shows context-specific recovery hints for resumable failures', async () => {
    const coding = await mountMessage({
      id: 'message-recovery',
      role: 'assistant',
      content: 'Agent 已停止：sidecar exited',
      timestamp: 1,
      status: 'done',
    }, {
      recoverable: true,
      recoveryContext: 'coding',
    })

    expect(coding.host.textContent).toContain('继续')
    expect(coding.host.textContent).toContain('工作区、Git 状态、工具结果和验证面板')
    const codingRetry = [...coding.host.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent?.includes('继续'))
    codingRetry?.click()
    await nextTick()
    expect(coding.retried()).toBe(true)

    const ctf = await mountMessage({
      id: 'message-ctf-recovery',
      role: 'assistant',
      content: 'Agent 通信异常：engine.protocol_error',
      timestamp: 1,
      status: 'done',
    }, {
      recoverable: true,
      recoveryContext: 'ctf',
    })

    expect(ctf.host.textContent).toContain('notes、证据、Judge 回执和工具结果')
  })
})
