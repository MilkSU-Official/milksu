// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Conversation } from '@/types'

let stored: Record<string, unknown>[] = []

const invokeCommand = vi.fn(async (command: string, _args?: unknown) => {
  if (command === 'list_conversations') return stored
  if (command === 'get_coding_project_memory') return { recents: [], lastWorkspacePath: '' }
  return null
})

vi.mock('@/desktop', () => ({
  invokeCommand: (command: string, args?: unknown) => invokeCommand(command, args),
  listenEvent: vi.fn(async () => () => undefined),
}))

function storedConversation(id: string, createdAt: number) {
  return { id, title: id, createdAt, messages: [] }
}

function pinnedSnapshot(list: readonly Conversation[]) {
  return list
    .filter(conversation => conversation.pinned)
    .sort((left, right) => (left.pinnedOrder ?? 0) - (right.pinnedOrder ?? 0))
    .map(conversation => conversation.id)
}

describe('useConversations pinning', () => {
  beforeEach(() => {
    invokeCommand.mockClear()
    stored = [
      storedConversation('a', 1),
      storedConversation('b', 2),
      storedConversation('c', 3),
    ]
  })

  it('appends a newly pinned conversation after the existing pins', async () => {
    const { useConversations } = await import('@/composables/useConversations')
    const conversations = useConversations()
    await conversations.load()

    conversations.setConversationPinned('b', true)
    conversations.setConversationPinned('a', true)

    expect(pinnedSnapshot(conversations.conversations)).toEqual(['b', 'a'])
  })

  it('unpinning clears both fields', async () => {
    const { useConversations } = await import('@/composables/useConversations')
    const conversations = useConversations()
    await conversations.load()

    conversations.setConversationPinned('a', true)
    conversations.setConversationPinned('a', false)

    const target = conversations.conversations.find(item => item.id === 'a')
    expect(target?.pinned).toBeUndefined()
    expect(target?.pinnedOrder).toBeUndefined()
  })

  it('moves a pinned conversation up and down without touching the others', async () => {
    const { useConversations } = await import('@/composables/useConversations')
    const conversations = useConversations()
    await conversations.load()

    conversations.setConversationPinned('a', true)
    conversations.setConversationPinned('b', true)
    conversations.setConversationPinned('c', true)

    conversations.movePinnedConversation('c', -1)
    expect(pinnedSnapshot(conversations.conversations)).toEqual(['a', 'c', 'b'])
    conversations.movePinnedConversation('c', 1)
    expect(pinnedSnapshot(conversations.conversations)).toEqual(['a', 'b', 'c'])
  })

  it('reorders a dragged conversation to the drop target position', async () => {
    const { useConversations } = await import('@/composables/useConversations')
    const conversations = useConversations()
    await conversations.load()

    conversations.setConversationPinned('a', true)
    conversations.setConversationPinned('b', true)
    conversations.setConversationPinned('c', true)

    conversations.reorderPinnedConversation('c', 'a')
    expect(pinnedSnapshot(conversations.conversations)).toEqual(['c', 'a', 'b'])
  })

  it('persists the pinned order to the backend', async () => {
    const { useConversations } = await import('@/composables/useConversations')
    const conversations = useConversations()
    await conversations.load()

    conversations.setConversationPinned('a', true)
    await vi.waitFor(() => {
      const saved = invokeCommand.mock.calls.find(([command]) => command === 'save_conversation')
      expect(saved).toBeDefined()
    })
  })
})
