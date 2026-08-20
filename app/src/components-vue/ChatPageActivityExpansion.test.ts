// @vitest-environment jsdom

import { createApp, nextTick, ref, type App } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ChatPage from './ChatPage.vue'
import type { Conversation, Message } from '@/types'

vi.mock('@/desktop', () => ({
  hasDesktopRuntime: () => false,
  invokeCommand: vi.fn(async () => {
    throw new Error('desktop runtime unavailable in component test')
  }),
  listenEvent: vi.fn(async () => () => undefined),
}))

const mountedApps: App[] = []

afterEach(() => {
  for (const app of mountedApps.splice(0)) app.unmount()
  document.body.innerHTML = ''
})

function tool(id: string, content: string, extra: Partial<Message> = {}): Message {
  return {
    id,
    role: 'tool',
    content,
    timestamp: 1,
    toolName: 'bash',
    status: 'done',
    ...extra,
  }
}

function conversationWithTools(id: string): Conversation {
  return {
    id,
    title: id,
    createdAt: 1,
    messages: [
      { id: `${id}-user`, role: 'user', content: '做点事', timestamp: 1, status: 'done' },
      tool(`${id}-t1`, '$ npm test', { toolCallId: `${id}-call-1` }),
      tool(`${id}-t1-result`, 'ok', { toolCallId: `${id}-call-1` }),
    ],
  }
}

async function settleToggle() {
  await new Promise(resolve => setTimeout(resolve, 0))
  await nextTick()
  await nextTick()
}

function mountPage(initial: Conversation) {
  const active = ref<Conversation>(initial)
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp({
    components: { ChatPage },
    setup: () => ({ active }),
    template: `<ChatPage
      :conversation="active"
      :settings="null"
      workspace-path="/tmp/milksu"
      :running="false"
      :aborting="false"
      :session-ready="true"
      :resumed="false"
      :compacting="false"
      :ctf-session="false"
      :ensure-conversation="() => active.id"
    />`,
  })
  app.mount(host)
  mountedApps.push(app)
  return { host, active }
}

describe('ChatPage activity expansion', () => {
  it('keeps expansion state per conversation when switching sessions', async () => {
    const { host, active } = mountPage(conversationWithTools('conversation-a'))
    await nextTick()
    await nextTick()

    const groupA = host.querySelector<HTMLDetailsElement>('.tool-activity')
    expect(groupA).not.toBeNull()
    expect(groupA?.open).toBe(false)

    groupA?.querySelector('summary')?.click()
    await settleToggle()
    expect(host.querySelector<HTMLDetailsElement>('.tool-activity')?.open).toBe(true)

    active.value = conversationWithTools('conversation-b')
    await nextTick()
    await nextTick()
    expect(host.querySelector<HTMLDetailsElement>('.tool-activity')?.open).toBe(false)

    active.value = conversationWithTools('conversation-a')
    await nextTick()
    await nextTick()
    expect(host.querySelector<HTMLDetailsElement>('.tool-activity')?.open).toBe(true)
  })

  it('keeps a group expanded while new tool results arrive in the same conversation', async () => {
    const { host, active } = mountPage(conversationWithTools('conversation-a'))
    await nextTick()
    await nextTick()

    host.querySelector<HTMLDetailsElement>('.tool-activity')?.querySelector('summary')?.click()
    await settleToggle()
    expect(host.querySelector<HTMLDetailsElement>('.tool-activity')?.open).toBe(true)

    active.value = {
      ...active.value,
      messages: [
        ...active.value.messages,
        tool('conversation-a-t2', '$ npm run build', {
          toolCallId: 'conversation-a-call-2',
          status: 'running',
        }),
      ],
    }
    await nextTick()
    await nextTick()

    expect(host.querySelector<HTMLDetailsElement>('.tool-activity')?.open).toBe(true)
  })
})
