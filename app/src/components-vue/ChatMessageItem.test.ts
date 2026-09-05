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
    choice?: string
  }> = []
  let retried = false
  let rewound = false
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp(ChatMessageItem, {
    message,
    ...props,
    onRespondApproval: (
      requestId: string,
      approved: boolean,
      scope?: 'once' | 'conversation',
      choice?: string,
    ) => {
      responses.push({ requestId, approved, scope, choice })
    },
    onRetry: () => {
      retried = true
    },
    onRewindContext: () => {
      rewound = true
    },
  })
  app.mount(host)
  mountedApps.push(app)
  await nextTick()
  return { host, responses, retried: () => retried, rewound: () => rewound }
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
    expect(host.textContent).toContain('想了')
    expect(host.textContent).toContain('6.0s')
    expect(host.textContent).toContain('先读文件再改签名。')
    expect(host.textContent).not.toContain('MILKSU')
    expect(host.textContent).not.toContain('YOU')
    expect(host.querySelector('.agent-think')).not.toBeNull()
    expect(host.querySelector('.agent-think__more')?.getAttribute('data-open')).toBe('false')
    host.querySelector<HTMLButtonElement>('.agent-think__summary')?.click()
    await nextTick()
    expect(host.querySelector('.agent-think__more')?.getAttribute('data-open')).toBe('true')
  })

  it('keeps live thinking open and folds it when the conclusion starts', async () => {
    const live = await mountMessage({
      id: 'message-thinking-live',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      thinking: '先看仓库结构。\n再决定改哪个文件。',
      thinkingStatus: 'running',
      status: 'running',
    })
    expect(live.host.querySelector('.agent-think__more')?.getAttribute('data-open')).toBe('true')
    expect(live.host.textContent).toContain('正在思考')
    expect(live.host.textContent).toContain('先看仓库结构。')

    const settled = await mountMessage({
      id: 'message-thinking-settled',
      role: 'assistant',
      content: '结论是改 greet.ts。',
      timestamp: Date.now(),
      thinking: '先看仓库结构。\n再决定改哪个文件。',
      thinkingStatus: 'done',
      thinkingDurationMs: 4200,
      status: 'done',
    })
    expect(settled.host.querySelector('.agent-think__more')?.getAttribute('data-open')).toBe('false')
    expect(settled.host.textContent).toContain('想了')
    expect(settled.host.textContent).toContain('4.2s')
    expect(settled.host.textContent).toContain('结论是改 greet.ts。')
  })

  it('places a centered time divider above user messages only', async () => {
    const sentAt = Date.now()
    const user = await mountMessage({
      id: 'message-user-time',
      role: 'user',
      content: 'hi',
      timestamp: sentAt,
    })
    const divider = user.host.querySelector('.agent-time')
    expect(divider).not.toBeNull()
    expect(divider?.classList.contains('ak-divider')).toBe(false)
    expect(divider?.textContent?.trim()).toMatch(/\d{1,2}:\d{2}:\d{2}/)

    const assistant = await mountMessage({
      id: 'message-assistant-time',
      role: 'assistant',
      content: 'hello',
      timestamp: sentAt,
    })
    expect(assistant.host.querySelector('.agent-time')).toBeNull()
  })

  it('streams assistant text with a solid caret and no blurred tail', async () => {
    const running = await mountMessage({
      id: 'message-assistant-running',
      role: 'assistant',
      content: 'Pistachio is growing',
      timestamp: Date.now(),
      status: 'running',
    })
    expect(running.host.querySelector('.agent-stream-tail')).toBeNull()
    expect(running.host.textContent).toContain('Pistachio is growing')
    expect(running.host.querySelector('.agent-stream-caret')?.classList.contains('is-streaming')).toBe(true)
    expect(running.host.querySelector('.agent-pixel')).toBeNull()

    const done = await mountMessage({
      id: 'message-assistant-done',
      role: 'assistant',
      content: '写完了',
      timestamp: Date.now(),
      status: 'done',
    })
    expect(done.host.querySelector('.agent-pixel')).toBeNull()
    expect(done.host.querySelector('.agent-stream-caret')).toBeNull()
    expect(done.host.querySelector('.agent-stream-tail')).toBeNull()
  })

  it('lets the user copy or edit a prompt and copy or branch an answer', async () => {
    const user = await mountMessage({
      id: 'user-actions',
      role: 'user',
      content: '列出仓库',
      timestamp: Date.now(),
    })
    expect(user.host.querySelector('[aria-label="复制"]')).not.toBeNull()
    expect(user.host.querySelector('[aria-label="编辑并从这里重发"]')).not.toBeNull()
    expect(user.host.querySelector('[data-testid="message-rewind"]')).toBeNull()
    expect(user.host.querySelector('[aria-label="分叉到新对话"]')).toBeNull()

    const assistant = await mountMessage({
      id: 'assistant-actions',
      role: 'assistant',
      content: '这是一个仓库。',
      timestamp: Date.now(),
    })
    expect(assistant.host.querySelector('[aria-label="复制"]')).not.toBeNull()
    expect(assistant.host.querySelector('[aria-label="分叉到新对话"]')).not.toBeNull()
    expect(assistant.host.querySelector('[aria-label="编辑并从这里重发"]')).toBeNull()
  })

  it('keeps rewind on the last droppable user turn and leaves earlier prompts alone', async () => {
    const lastTurn = await mountMessage({
      id: 'user-rewind',
      role: 'user',
      content: '改成另一条路',
      timestamp: Date.now(),
    }, {
      canRewind: true,
    })
    const rewind = lastTurn.host.querySelector<HTMLButtonElement>('[data-testid="message-rewind"]')
    expect(rewind).not.toBeNull()
    expect(rewind?.getAttribute('aria-label')).toBe('丢掉这段')
    expect(lastTurn.host.querySelector('.agent-turn-actions')?.classList.contains('agent-turn-actions--visible')).toBe(true)
    rewind?.click()
    await nextTick()
    expect(lastTurn.rewound()).toBe(true)

    const earlier = await mountMessage({
      id: 'user-earlier',
      role: 'user',
      content: '先读入口',
      timestamp: Date.now(),
    })
    expect(earlier.host.querySelector('[data-testid="message-rewind"]')).toBeNull()
    expect(earlier.host.querySelector('.agent-turn-actions')?.classList.contains('agent-turn-actions--visible')).toBe(false)
  })

  it('does not emit rewind while compaction has disabled the control', async () => {
    const result = await mountMessage({
      id: 'user-rewind-disabled',
      role: 'user',
      content: '改成另一条路',
      timestamp: Date.now(),
    }, {
      canRewind: true,
      rewindDisabled: true,
    })
    const rewind = result.host.querySelector<HTMLButtonElement>('[data-testid="message-rewind"]')
    expect(rewind?.disabled).toBe(true)
    rewind?.click()
    await nextTick()
    expect(result.rewound()).toBe(false)
  })

  it('renders a Beautiful UI choice card and emits the selected option', async () => {
    const { host, responses } = await mountMessage({
      id: 'message-ask',
      role: 'tool',
      content: 'How many flavors should we launch?',
      timestamp: 1,
      toolName: 'milksu_ask',
      approvalRequestId: 'ask-1',
      approvalState: 'pending',
      approvalInput: JSON.stringify({
        options: [
          { id: 'three', label: 'Three (core line)', detail: 'Keep the line small' },
          { id: 'five', label: 'Five (full case)' },
          { id: 'one', label: 'Just one hero' },
        ],
      }),
    })
    expect(host.querySelector('.agent-choice')).not.toBeNull()
    expect(host.textContent).toContain('How many flavors should we launch?')
    expect(host.textContent).toContain('Three (core line)')
    expect(host.textContent).toContain('Keep the line small')
    expect(host.querySelector('.agent-approve__actions')).toBeNull()
    const five = [...host.querySelectorAll<HTMLButtonElement>('.agent-choice__option')]
      .find(button => button.textContent?.includes('Five (full case)'))
    five?.click()
    await nextTick()
    expect(responses).toEqual([{
      requestId: 'ask-1',
      approved: true,
      scope: 'once',
      choice: 'five',
    }])
    expect(host.querySelector('[role="radiogroup"]')).not.toBeNull()
  })

  it('keeps a selected choice card as a receipt', async () => {
    const { host } = await mountMessage({
      id: 'message-ask-done',
      role: 'tool',
      content: 'How many flavors should we launch?',
      timestamp: 1,
      toolName: 'milksu_ask',
      approvalRequestId: 'ask-1',
      approvalState: 'approved',
      approvalChoiceId: 'five',
      approvalInput: JSON.stringify({
        options: [
          { id: 'three', label: 'Three (core line)' },
          { id: 'five', label: 'Five (full case)' },
        ],
      }),
    })
    expect(host.querySelector('.agent-choice')).not.toBeNull()
    const selected = host.querySelector('.agent-choice__option.is-selected')
    expect(selected?.textContent).toContain('Five (full case)')
    expect(host.querySelectorAll<HTMLButtonElement>('.agent-choice__option')[0]?.disabled).toBe(true)
  })

  it('hides a finished approval unless the user opened it', async () => {
    const { host } = await mountMessage({
      id: 'message-approved',
      role: 'tool',
      content: 'bash · echo hi',
      timestamp: 1,
      toolName: 'bash',
      approvalRequestId: 'approval-done',
      approvalState: 'approved',
    })
    expect(host.querySelector('.agent-approve')).toBeNull()
  })
})
