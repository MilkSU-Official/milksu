// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from '@/lib/reactStore'
import { createConversationsRuntime } from '@/composables/useConversations'
import type { Conversation, Message } from '@/types'

const desktop = vi.hoisted(() => ({
  invokeCommand: vi.fn(),
  listenEvent: vi.fn(async () => () => undefined),
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

function message(role: Message['role'], id: string, extra?: Partial<Message>): Message {
  return { id, role, content: id, timestamp: 1, ...extra }
}

const attachment = {
  id: 'att-1',
  name: 'screenshot.png',
  mediaType: 'image/png',
  size: 1024,
  sha256: 'abcd1234',
}

async function settle() {
  for (let index = 0; index < 5; index++) {
    await Promise.resolve()
    await nextTick()
  }
}

beforeEach(() => {
  desktop.invokeCommand.mockReset()
  desktop.invokeCommand.mockImplementation(async (command: string) => {
    if (command === 'save_conversation') return null
    if (command === 'send_message') return null
    return null
  })
  desktop.listenEvent.mockClear()
})

afterEach(() => {
  for (const runtime of mountedRuntimes.splice(0)) runtime.dispose()
})

describe('editAndResend', () => {
  it('keeps the original attachments on the resent message', async () => {
    const conversations = mountConversations()
    const source: Conversation = {
      id: 'source-1',
      title: 'Fix login',
      createdAt: 1,
      workspacePath: '/workspace/app',
      kernel: 'pi',
      messages: [
        message('user', 'u1', { content: 'look at this', attachments: [attachment] }),
        message('assistant', 'a1'),
      ],
    }
    conversations.conversations = [source]
    conversations.activeId = 'source-1'

    const sent = await conversations.editAndResend('u1', 'look at this again')
    await settle()

    expect(sent).toBe(true)
    const current = conversations.conversations.find(item => item.id === 'source-1')
    const userMessages = current?.messages.filter(item => item.role === 'user') ?? []
    expect(userMessages).toHaveLength(1)
    expect(userMessages[0].content).toBe('look at this again')
    expect(userMessages[0].attachments).toEqual([attachment])

    const sendCall = desktop.invokeCommand.mock.calls.find(([command]) => command === 'send_message')
    expect(sendCall?.[1]).toMatchObject({
      conversationId: 'source-1',
      prompt: 'look at this again',
      attachments: [attachment],
      branchFromUserOccurrence: 0,
    })
  })

  it('still resends a message without attachments', async () => {
    const conversations = mountConversations()
    const source: Conversation = {
      id: 'source-2',
      title: 'Fix login',
      createdAt: 1,
      workspacePath: '/workspace/app',
      kernel: 'pi',
      messages: [message('user', 'u1'), message('assistant', 'a1')],
    }
    conversations.conversations = [source]
    conversations.activeId = 'source-2'

    const sent = await conversations.editAndResend('u1', 'plain edit')
    await settle()

    expect(sent).toBe(true)
    const current = conversations.conversations.find(item => item.id === 'source-2')
    const userMessages = current?.messages.filter(item => item.role === 'user') ?? []
    expect(userMessages).toHaveLength(1)
    expect(userMessages[0].content).toBe('plain edit')
    expect(userMessages[0].attachments).toBeUndefined()

    const sendCall = desktop.invokeCommand.mock.calls.find(([command]) => command === 'send_message')
    expect(sendCall?.[1]).toMatchObject({
      conversationId: 'source-2',
      prompt: 'plain edit',
      attachments: [],
      branchFromUserOccurrence: 0,
    })
  })
})
