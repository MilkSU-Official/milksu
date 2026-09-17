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
    if (command === 'handoff_coding_session') {
      return { sessionId: 'handed-session' }
    }
    return null
  })
  desktop.listenEvent.mockClear()
})

afterEach(() => {
  for (const runtime of mountedRuntimes.splice(0)) runtime.dispose()
})

describe('conversation context handoff', () => {
  it('opens the forked conversation after a successful sidecar handoff', async () => {
    const conversations = mountConversations()
    const source: Conversation = {
      id: 'source-1',
      title: 'Keep the dock',
      createdAt: 1,
      workspacePath: '/workspace/app',
      workspaceHome: 'chat',
      kernel: 'dsh',
      messages: [message('user', 'u1'), message('assistant', 'a1')],
    }
    conversations.conversations = [source]
    conversations.activeId = 'source-1'

    await conversations.handoffContext('dsh')
    await settle()

    expect(desktop.invokeCommand).toHaveBeenCalledWith('handoff_coding_session', {
      conversationId: 'source-1',
      kernel: 'dsh',
    })
    expect(conversations.activeId).toBe('handed-session')
    const handed = conversations.conversations.find(item => item.id === 'handed-session')
    expect(handed?.kernel).toBe('dsh')
    expect(handed?.workspacePath).toBe('/workspace/app')
    expect(handed?.messages.map(item => item.content)).toEqual(['u1', 'a1'])
    expect(
      handed?.messages.some(item => item.content.includes('已整理上一会话')),
    ).toBe(false)
  })

  it('shows the harness summary in the new conversation when compact already produced one', async () => {
    desktop.invokeCommand.mockImplementation(async (command: string) => {
      if (command === 'save_conversation') return null
      if (command === 'handoff_coding_session') {
        return {
          sessionId: 'handed-session',
          summary: 'Goal: keep the dock',
        }
      }
      return null
    })
    const conversations = mountConversations()
    const source: Conversation = {
      id: 'source-summary',
      title: 'Keep the dock',
      createdAt: 1,
      kernel: 'dsh',
      messages: [message('user', 'u1'), message('assistant', 'a1')],
    }
    conversations.conversations = [source]
    conversations.activeId = 'source-summary'

    await conversations.handoffContext('dsh')
    await settle()

    const handed = conversations.conversations.find(item => item.id === 'handed-session')
    expect(handed?.messages).toHaveLength(1)
    expect(handed?.messages[0]?.role).toBe('assistant')
    expect(handed?.messages[0]?.content).toBe('Goal: keep the dock')
  })

  it('keeps the current conversation when sidecar handoff fails', async () => {
    desktop.invokeCommand.mockImplementation(async (command: string) => {
      if (command === 'save_conversation') return null
      if (command === 'handoff_coding_session') {
        throw new Error('DeepSeek Harness host IPC is not configured')
      }
      return null
    })
    const conversations = mountConversations()
    conversations.conversations = [{
      id: 'source-2',
      title: 'Keep the dock',
      createdAt: 1,
      kernel: 'dsh',
      messages: [message('user', 'u1')],
    }]
    conversations.activeId = 'source-2'

    await conversations.handoffContext('dsh')
    await settle()

    expect(conversations.activeId).toBe('source-2')
    expect(conversations.conversations).toHaveLength(1)
    expect(conversations.conversations[0]?.messages.at(-1)?.content).toMatch(/host IPC/i)
  })
})
