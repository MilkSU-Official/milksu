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
  const responses: Array<{
    requestId: string
    approved: boolean
    scope?: 'once' | 'conversation'
  }> = []
  let retried = false
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp(ChatMessageItem, {
    message,
    ...props,
    onRespondApproval: (
      requestId: string,
      approved: boolean,
      scope?: 'once' | 'conversation',
    ) => {
      responses.push({ requestId, approved, scope })
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
    expect(responses).toEqual([{
      requestId: 'approval-redaction',
      approved: true,
      scope: 'once',
    }])
  })

  it('does not render a blank assistant bubble', async () => {
    const { host } = await mountMessage({
      id: 'blank-assistant',
      role: 'assistant',
      content: '   ',
      timestamp: 1,
      status: 'running',
    })
    expect(host.querySelector('article')).toBeNull()
    expect(host.textContent ?? '').not.toContain('正在回复')
  })

  it('offers a conversation-wide grant only when the request is grantable', async () => {
    const { host, responses } = await mountMessage({
      id: 'message-grantable',
      role: 'tool',
      content: '隔离 Coding Browser · 工具 browser_click',
      timestamp: 1,
      toolName: 'mcp:milksu-playwright',
      approvalRequestId: 'approval-browser',
      approvalState: 'pending',
      approvalGrantable: true,
    })

    const always = [...host.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent?.includes('本对话始终允许'))
    expect(always).toBeDefined()
    always?.click()
    await nextTick()
    expect(responses).toEqual([{
      requestId: 'approval-browser',
      approved: true,
      scope: 'conversation',
    }])
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

  it('renders a thinking block from Pi without a YOU/MILKSU label', async () => {
    const { host } = await mountMessage({
      id: 'message-thinking',
      role: 'assistant',
      content: '接下来改 greet。',
      timestamp: Date.now(),
      thinking: '先读文件再改签名。',
      thinkingStatus: 'done',
      thinkingDurationMs: 6000,
    })
    expect(host.textContent).toContain('想了 6 秒')
    expect(host.textContent).toContain('先读文件再改签名。')
    expect(host.textContent).not.toContain('MILKSU')
    expect(host.textContent).not.toContain('YOU')
    expect(host.querySelector('.agent-think')).not.toBeNull()
  })

  it('places an ak-divider above user messages only', async () => {
    const sentAt = Date.now()
    const user = await mountMessage({
      id: 'message-user-time',
      role: 'user',
      content: 'hi',
      timestamp: sentAt,
    })
    const divider = user.host.querySelector('.ak-divider')
    expect(divider).not.toBeNull()
    expect(divider?.textContent?.trim()).toMatch(/\d{1,2}:\d{2}:\d{2}/)

    const assistant = await mountMessage({
      id: 'message-assistant-time',
      role: 'assistant',
      content: 'hello',
      timestamp: sentAt,
    })
    expect(assistant.host.querySelector('.ak-divider')).toBeNull()
  })

  it('shows an ak-loading mark while the assistant is still running', async () => {
    const running = await mountMessage({
      id: 'message-assistant-running',
      role: 'assistant',
      content: '正在写',
      timestamp: Date.now(),
      status: 'running',
    })
    const mark = running.host.querySelector('.ak-loading')
    expect(mark).not.toBeNull()
    expect(running.host.querySelector('[aria-label="正在回复"]')).not.toBeNull()

    const done = await mountMessage({
      id: 'message-assistant-done',
      role: 'assistant',
      content: '写完了',
      timestamp: Date.now(),
      status: 'done',
    })
    expect(done.host.querySelector('.ak-loading')).toBeNull()
  })
})
