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

function message(role: Message['role'], id: string): Message {
  return { id, role, content: id, timestamp: 1 }
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
    if (command === 'fork_conversation') return 'forked-session'
    return null
  })
  desktop.listenEvent.mockClear()
})

afterEach(() => {
  for (const runtime of mountedRuntimes.splice(0)) runtime.dispose()
})

describe('sidebar conversation fork', () => {
  it('uses Pi fork_conversation from the last assistant turn', async () => {
    const conversations = mountConversations()
    const source: Conversation = {
      id: 'source-1',
      title: 'Fix login',
      createdAt: 1,
      workspacePath: '/workspace/app',
      workspaceHome: 'chat',
      pinned: true,
      pinnedOrder: 0,
      messages: [message('user', 'u1'), message('assistant', 'a1'), message('user', 'u2'), message('assistant', 'a2')],
    }
    conversations.conversations = [source]

    const forkedId = await conversations.forkConversation('source-1')
    await settle()

    expect(forkedId).toBe('forked-session')
    expect(desktop.invokeCommand).toHaveBeenCalledWith('fork_conversation', {
      conversationId: 'source-1',
      role: 'assistant',
      occurrence: 1,
    })
    const forked = conversations.conversations.find(item => item.id === 'forked-session')
    expect(forked?.workspacePath).toBe('/workspace/app')
    expect(forked?.workspaceHome).toBe('chat')
    expect(forked?.pinned).toBeUndefined()
    expect(forked?.messages.map(item => item.id)).toEqual(['u1', 'a1', 'u2', 'a2'])
    expect(conversations.activeId).toBe('forked-session')
  })

  it('clones the product row when there is no assistant fork point', async () => {
    const conversations = mountConversations()
    conversations.conversations = [{
      id: 'source-empty',
      title: 'Empty chat',
      createdAt: 1,
      workspacePath: '/workspace/app',
      workspaceHome: 'lab',
      kernel: 'pi',
      messages: [message('user', 'u1')],
    }]

    const forkedId = await conversations.forkConversation('source-empty')
    await settle()

    expect(forkedId).toBeTruthy()
    expect(forkedId).not.toBe('source-empty')
    expect(desktop.invokeCommand.mock.calls.some(([command]) => command === 'fork_conversation')).toBe(false)
    const forked = conversations.conversations.find(item => item.id === forkedId)
    expect(forked?.title).toBe('Empty chat')
    expect(forked?.workspacePath).toBe('/workspace/app')
    expect(forked?.workspaceHome).toBe('lab')
    expect(forked?.messages).toEqual([])
  })
})
