// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Conversation } from '@/types'

let stored: Record<string, unknown>[] = []
let archiveCalls = 0
let archiveStarted: (() => void) | undefined
let releaseArchive: (() => void) | undefined

const invokeCommand = vi.fn(async (command: string, args?: unknown) => {
  if (command === 'list_conversations') return stored
  if (command === 'get_coding_project_memory') return { recents: [], lastWorkspacePath: '' }
  if (command === 'archive_conversation') {
    archiveCalls += 1
    archiveStarted?.()
    await new Promise<void>(resolve => {
      releaseArchive = resolve
    })
    return null
  }
  if (command === 'save_conversation') return null
  if (command === 'abort_message') return null
  void args
  return null
})

vi.mock('@/desktop', () => ({
  invokeCommand: (command: string, args?: unknown) => invokeCommand(command, args),
  listenEvent: vi.fn(async () => () => undefined),
}))

vi.mock('@/lib/appToast', () => ({
  toast: vi.fn(),
}))

function storedConversation(id: string) {
  return { id, title: id, createdAt: 1, messages: [] }
}

describe('useConversations archive', () => {
  beforeEach(() => {
    invokeCommand.mockClear()
    stored = [storedConversation('busy-session')]
    archiveCalls = 0
    archiveStarted = undefined
    releaseArchive = undefined
  })

  it('archives immediately and ignores a second click while the first request is in flight', async () => {
    const { useConversations } = await import('@/composables/useConversations')
    const conversations = useConversations()
    await conversations.load()

    let started = 0
    archiveStarted = () => {
      started += 1
    }
    const first = conversations.archive('busy-session')
    const second = conversations.archive('busy-session')
    await vi.waitFor(() => {
      expect(started).toBe(1)
    })
    expect(conversations.conversations.map((item: Conversation) => item.id)).toEqual([])

    await second
    expect(archiveCalls).toBe(1)
    releaseArchive?.()
    await first
    expect(conversations.conversations.map((item: Conversation) => item.id)).toEqual([])
  })
})
