// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'

let stored: Record<string, unknown>[] = []

const invokeCommand = vi.fn(async (command: string, _args?: unknown) => {
  if (command === 'list_conversations') return stored
  return null
})

vi.mock('@/desktop', () => ({
  invokeCommand: (command: string, args?: unknown) => invokeCommand(command, args),
  listenEvent: vi.fn(async () => () => {}),
}))

function storedConversation(id: string, messages: unknown[]) {
  return { id, title: id, createdAt: 1, messages }
}

describe('useConversations reload', () => {
  beforeEach(() => {
    invokeCommand.mockClear()
  })

  it('keeps loaded conversations intact while adding and dropping stored ones', async () => {
    const { useConversations } = await import('@/composables/useConversations')
    const conversations = useConversations()

    stored = [
      storedConversation('streaming', [
        { id: 'message-1', role: 'assistant', content: '已写入磁盘的部分', timestamp: 2 },
      ]),
      storedConversation('going-away', []),
    ]
    await conversations.load()

    // The stored snapshot lags behind the debounced save, so a reload triggered by
    // restoring an archived conversation must not roll the live one back.
    stored = [
      storedConversation('streaming', []),
      storedConversation('restored', []),
    ]
    await conversations.load()

    const ids = conversations.conversations.value.map(conversation => conversation.id)
    expect(ids).toEqual(['streaming', 'restored'])
    expect(conversations.conversations.value[0]?.messages).toHaveLength(1)
  })
})
