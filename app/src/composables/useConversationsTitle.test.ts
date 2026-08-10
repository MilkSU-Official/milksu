// @vitest-environment jsdom

import { createApp, defineComponent, h, nextTick, type App } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useConversations } from '@/composables/useConversations'

const desktop = vi.hoisted(() => ({
  invokeCommand: vi.fn(),
  listenEvent: vi.fn(async (
    _event: string,
    _callback: (event: unknown) => void,
  ) => () => undefined),
}))

vi.mock('@/desktop', () => ({
  invokeCommand: (...args: unknown[]) => desktop.invokeCommand(
    ...args as [string, unknown?]
  ),
  listenEvent: (...args: unknown[]) => desktop.listenEvent(
    ...args as [string, (event: unknown) => void]
  ),
}))

const mountedApps: App[] = []

function mountConversations() {
  let conversations!: ReturnType<typeof useConversations>
  const root = defineComponent({
    setup: function ConversationsTitleFixture() {
      conversations = useConversations()
      return () => h('div')
    },
  })
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp(root)
  app.mount(host)
  mountedApps.push(app)
  return conversations
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
})

afterEach(() => {
  for (const app of mountedApps.splice(0)) app.unmount()
  document.body.innerHTML = ''
})

describe('Coding conversation title generation', () => {
  it('keeps a neutral title until Pi summarizes the first message', async () => {
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

    await expect(conversations.send(firstMessage)).resolves.toBe(true)
    expect(conversations.active.value?.title).toBe('新编码任务')
    expect(desktop.invokeCommand).toHaveBeenCalledWith('generate_conversation_title', {
      firstMessage,
      modelMode: '',
      modelProvider: '',
      modelId: '',
    })
    const prematurelySavedTitles = desktop.invokeCommand.mock.calls
      .filter(([command]) => command === 'save_conversation')
      .map(([, args]) => (args as { conversation: { title: string } }).conversation.title)
    expect(prematurelySavedTitles).not.toContain(firstMessage.slice(0, 40))

    resolveTitle('修复登录回调状态恢复')
    await settle()

    expect(conversations.active.value?.title).toBe('修复登录回调状态恢复')
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

    expect(conversations.active.value?.title).toBe('MilkSU · 浏览器')
    expect(desktop.invokeCommand).not.toHaveBeenCalledWith(
      'generate_conversation_title',
      expect.anything(),
    )
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

    expect(conversations.active.value?.title).toBe('新编码任务')
    expect(desktop.invokeCommand.mock.calls.filter(
      ([command]) => command === 'generate_conversation_title',
    )).toHaveLength(1)
  })

  it('uses Pi steering instead of starting a parallel turn while running', async () => {
    desktop.invokeCommand.mockResolvedValue(undefined)
    const conversations = mountConversations()

    await expect(conversations.send('先检查当前失败测试')).resolves.toBe(true)
    await expect(conversations.send('不要改 API，先补回归测试')).resolves.toBe(true)

    expect(desktop.invokeCommand).toHaveBeenCalledWith('steer_message', {
      conversationId: conversations.activeId.value,
      prompt: '不要改 API，先补回归测试',
    })
    expect(desktop.invokeCommand.mock.calls.filter(
      ([command]) => command === 'send_message',
    )).toHaveLength(1)
    expect(conversations.activeMessageQueue.value.steering).toEqual([
      '不要改 API，先补回归测试',
    ])
  })
})
