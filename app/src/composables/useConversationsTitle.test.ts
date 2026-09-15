// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from '@/lib/reactStore'
import {
  fallbackConversationTitle,
  createConversationsRuntime,
} from '@/composables/useConversations'

const desktop = vi.hoisted(() => ({
  invokeCommand: vi.fn(),
  eventCallback: undefined as undefined | ((event: {
    payload: Record<string, unknown>
  }) => void),
  listenEvent: vi.fn(async (
    _event: string,
    callback: (event: { payload: Record<string, unknown> }) => void,
  ) => {
    desktop.eventCallback = callback
    return () => undefined
  }),
}))

vi.mock('@/desktop', () => ({
  invokeCommand: (...args: unknown[]) => desktop.invokeCommand(
    ...args as [string, unknown?]
  ),
  listenEvent: (...args: unknown[]) => desktop.listenEvent(
    ...args as [string, (event: unknown) => void]
  ),
}))

const mountedRuntimes: Array<{ dispose: () => void }> = []

function mountConversations() {
  const runtime = createConversationsRuntime()
  mountedRuntimes.push(runtime)
  return runtime
}

async function settle() {
  for (let index = 0; index < 5; index++) {
    await Promise.resolve()
    await nextTick()
  }
}

beforeEach(() => {
  desktop.invokeCommand.mockReset()
  desktop.listenEvent.mockClear()
  desktop.eventCallback = undefined
})

afterEach(() => {
  for (const runtime of mountedRuntimes.splice(0)) runtime.dispose()
  document.body.innerHTML = ''
})

describe('Coding conversation title generation', () => {
  it('uses the first request immediately and lets Pi replace it with a concise title', async () => {
    let resolveTitle!: (title: string) => void
    const generatedTitle = new Promise<string>(resolve => {
      resolveTitle = resolve
    })
    desktop.invokeCommand.mockImplementation(async (command: string) => {
      if (command === 'generate_conversation_title') return generatedTitle
      return undefined
    })
    const conversations = mountConversations()
    const firstMessage = '请检查登录回调为什么在刷新后丢失原始路径，并修好状态恢复与相应测试'
    const fallbackTitle = fallbackConversationTitle(firstMessage)

    await expect(conversations.send(firstMessage)).resolves.toBe(true)
    expect(conversations.active?.title).toBe(fallbackTitle)
    expect(desktop.invokeCommand).toHaveBeenCalledWith('generate_conversation_title', {
      firstMessage,
      modelMode: '',
      modelProvider: '',
      modelId: '',
    })
    const prematurelySavedTitles = desktop.invokeCommand.mock.calls
      .filter(([command]) => command === 'save_conversation')
      .map(([, args]) => (args as { conversation: { title: string } }).conversation.title)
    expect(prematurelySavedTitles).toContain(fallbackTitle)

    resolveTitle('修复登录回调状态恢复')
    await settle()

    expect(conversations.active?.title).toBe('修复登录回调状态恢复')
    expect(desktop.invokeCommand).toHaveBeenCalledWith('save_conversation', {
      conversation: expect.objectContaining({ title: '修复登录回调状态恢复' }),
    })
  })

  it('does not overwrite an explicit product title', async () => {
    desktop.invokeCommand.mockResolvedValue(undefined)
    const conversations = mountConversations()
    conversations.ensureConversation('MilkSU · 浏览器')

    await expect(conversations.send('检查这个页面的登录流程')).resolves.toBe(true)
    await settle()

    expect(conversations.active?.title).toBe('MilkSU · 浏览器')
    expect(desktop.invokeCommand).not.toHaveBeenCalledWith(
      'generate_conversation_title',
      expect.anything(),
    )
  })

  it('sends a GUI product action as structured runtime data', async () => {
    desktop.invokeCommand.mockResolvedValue(undefined)
    const conversations = mountConversations()
    conversations.setWorkspace('/Users/milksu/code/project')

    await expect(conversations.send(
      'Run the repository test contract.',
      '运行测试',
      [],
      undefined,
      { kind: 'test' },
    )).resolves.toBe(true)

    expect(desktop.invokeCommand).toHaveBeenCalledWith('send_message', expect.objectContaining({
      prompt: 'Run the repository test contract.',
      productAction: { kind: 'test' },
    }))
  })

  it('does not spend another title turn after a best-effort failure', async () => {
    desktop.invokeCommand.mockImplementation(async (command: string) => {
      if (command === 'generate_conversation_title') {
        throw new Error('title model unavailable')
      }
      return undefined
    })
    const conversations = mountConversations()

    await expect(conversations.send('修复登录回调')).resolves.toBe(true)
    await settle()
    await expect(conversations.send('补上恢复测试')).resolves.toBe(true)
    await settle()

    expect(conversations.active?.title).toBe('修复登录回调')
    expect(desktop.invokeCommand.mock.calls.filter(
      ([command]) => command === 'generate_conversation_title',
    )).toHaveLength(1)
  })

  it('normalizes and truncates the local fallback without leaving trailing punctuation', () => {
    expect(fallbackConversationTitle('  检查   登录回调。  ')).toBe('检查 登录回调')
    expect(Array.from(fallbackConversationTitle('请把这段很长的用户请求截断为一个可读的会话标题并保留关键信息')).length)
      .toBeLessThanOrEqual(24)
  })

  it('answers a pending ask instead of queueing steering', async () => {
    desktop.invokeCommand.mockResolvedValue(undefined)
    const conversations = mountConversations()

    await expect(conversations.send('先检查当前失败测试')).resolves.toBe(true)
    const conversationId = conversations.activeId
    conversations.conversations = conversations.conversations.map(item => (
      item.id === conversationId
        ? {
            ...item,
            messages: [
              ...item.messages,
              {
                id: 'ask-1',
                role: 'tool',
                content: '选一个方案',
                timestamp: Date.now(),
                toolName: 'milksu_ask',
                status: 'running',
                approvalRequestId: 'ask-1',
                approvalState: 'pending',
                approvalInput: JSON.stringify({
                  options: [
                    { id: 'a', label: 'A' },
                    { id: 'b', label: 'B' },
                  ],
                }),
              },
            ],
          }
        : item
    ))

    await expect(conversations.send('都不合适，按任务交接来')).resolves.toBe(true)

    expect(desktop.invokeCommand).toHaveBeenCalledWith('respond_tool_approval', {
      conversationId,
      requestId: 'ask-1',
      approved: true,
      scope: '',
      choice: 'other:都不合适，按任务交接来',
    })
    expect(desktop.invokeCommand.mock.calls.filter(
      ([command]) => command === 'steer_message',
    )).toHaveLength(0)
    expect(desktop.invokeCommand.mock.calls.filter(
      ([command]) => command === 'send_message',
    )).toHaveLength(1)
    expect(conversations.activeMessageQueue.steering).toEqual([])
    expect(conversations.active?.messages.some(message => (
      message.role === 'user'
      && message.content === '都不合适，按任务交接来'
      && message.status === 'queued'
    ))).toBe(false)
  })

  it('uses Pi steering instead of starting a parallel turn while running', async () => {
    desktop.invokeCommand.mockResolvedValue(undefined)
    const conversations = mountConversations()

    await expect(conversations.send('先检查当前失败测试')).resolves.toBe(true)
    await expect(conversations.send('不要改 API，先补回归测试')).resolves.toBe(true)

    expect(desktop.invokeCommand).toHaveBeenCalledWith('steer_message', {
      conversationId: conversations.activeId,
      prompt: '不要改 API，先补回归测试',
    })
    expect(desktop.invokeCommand.mock.calls.filter(
      ([command]) => command === 'send_message',
    )).toHaveLength(1)
    expect(conversations.activeMessageQueue.steering).toEqual([
      '不要改 API，先补回归测试',
    ])
  })

  it('recreates a stale Pi session instead of exposing its old id', async () => {
    desktop.invokeCommand.mockImplementation(async (command: string) => {
      if (command === 'steer_message') {
        throw new Error('PI session not found: stale-conversation')
      }
      return undefined
    })
    const conversations = mountConversations()

    await expect(conversations.send('先检查当前失败测试')).resolves.toBe(true)
    await expect(conversations.send('继续检查')).resolves.toBe(true)

    expect(desktop.invokeCommand.mock.calls.filter(
      ([command]) => command === 'send_message',
    )).toHaveLength(2)
    expect(conversations.active?.messages.some(message => (
      message.role === 'assistant' && message.content.includes('PI session not found')
    ))).toBe(false)
  })

  it('removes a queued steering message only after the runtime receipt succeeds', async () => {
    desktop.invokeCommand.mockResolvedValue(undefined)
    const conversations = mountConversations()

    await conversations.send('先检查当前失败测试')
    await conversations.send('不要改 API，先补回归测试')
    await expect(conversations.cancelQueuedGuidance(0)).resolves.toBe(true)

    expect(desktop.invokeCommand).toHaveBeenCalledWith('remove_queued_message', {
      conversationId: conversations.activeId,
      queue: 'steering',
      index: 0,
      expected: '不要改 API，先补回归测试',
    })
    expect(conversations.activeMessageQueue.steering).toEqual([])
    expect(conversations.active?.messages.map(message => message.content))
      .not.toContain('不要改 API，先补回归测试')
  })

  it('returns a successfully retracted message to the composer for editing', async () => {
    desktop.invokeCommand.mockResolvedValue(undefined)
    const conversations = mountConversations()

    await conversations.send('先检查当前失败测试')
    await conversations.send('把 API 全部改掉')
    await expect(conversations.editQueuedGuidance(0)).resolves.toBe(true)

    expect(conversations.pendingComposerDraft).toEqual({
      prompt: '把 API 全部改掉',
      visibleText: '把 API 全部改掉',
    })
    expect(conversations.activeMessageQueue.steering).toEqual([])
  })

  it('keeps the queued message when the runtime rejects a stale removal', async () => {
    desktop.invokeCommand.mockImplementation(async (command: string) => {
      if (command === 'remove_queued_message') {
        throw new Error('queued message changed before it could be removed')
      }
      return undefined
    })
    const conversations = mountConversations()

    await conversations.send('先检查当前失败测试')
    await conversations.send('继续补回归测试')
    await expect(conversations.cancelQueuedGuidance(0)).rejects.toThrow('changed before')

    expect(conversations.activeMessageQueue.steering).toEqual(['继续补回归测试'])
    expect(conversations.active?.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: 'user',
        content: '继续补回归测试',
        status: 'queued',
      }),
    ]))
  })
})
