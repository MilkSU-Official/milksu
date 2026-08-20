import { describe, expect, it } from 'vitest'
import {
  chatActivityGroupOpen,
  chatActivityOpenEntryIds,
  createChatActivityExpansionState,
  pruneChatActivityExpansion,
  setChatActivityEntryOpen,
  setChatActivityGroupOpen,
} from '@/lib/chatActivityExpansion'
import type { ChatTranscriptBlock } from '@/lib/chatActivity'
import type { Message } from '@/types'

function tool(id: string, extra: Partial<Message> = {}): Message {
  return {
    id,
    role: 'tool',
    content: 'x',
    timestamp: 1,
    toolName: 'bash',
    status: 'done',
    ...extra,
  }
}

function activityBlock(id: string, messages: Message[]): ChatTranscriptBlock {
  return { kind: 'activity', id, messages, running: false }
}

describe('chatActivityExpansion', () => {
  it('tracks group and entry open state independently', () => {
    let state = createChatActivityExpansionState()
    expect(chatActivityGroupOpen(state, 'activity:a')).toBe(false)
    expect(chatActivityOpenEntryIds(state, 'activity:a').size).toBe(0)

    state = setChatActivityGroupOpen(state, 'activity:a', true)
    state = setChatActivityEntryOpen(state, 'activity:a', 'tool:t1', true)
    expect(chatActivityGroupOpen(state, 'activity:a')).toBe(true)
    expect(chatActivityOpenEntryIds(state, 'activity:a').has('tool:t1')).toBe(true)

    state = setChatActivityEntryOpen(state, 'activity:a', 'tool:t1', false)
    expect(chatActivityOpenEntryIds(state, 'activity:a').size).toBe(0)
    state = setChatActivityGroupOpen(state, 'activity:a', false)
    expect(chatActivityGroupOpen(state, 'activity:a')).toBe(false)
  })

  it('returns the same state when a toggle matches the current value', () => {
    const state = createChatActivityExpansionState()
    const opened = setChatActivityGroupOpen(state, 'activity:a', true)
    expect(setChatActivityGroupOpen(opened, 'activity:a', true)).toBe(opened)
    expect(setChatActivityGroupOpen(state, 'activity:a', false)).toBe(state)

    const withEntry = setChatActivityEntryOpen(opened, 'activity:a', 'tool:t1', true)
    expect(setChatActivityEntryOpen(withEntry, 'activity:a', 'tool:t1', true)).toBe(withEntry)
    expect(setChatActivityEntryOpen(opened, 'activity:a', 'tool:t1', false)).toBe(opened)
  })

  it('keeps separate conversations from sharing expansion state', () => {
    let first = createChatActivityExpansionState()
    first = setChatActivityGroupOpen(first, 'activity:a', true)
    const second = createChatActivityExpansionState()
    expect(chatActivityGroupOpen(first, 'activity:a')).toBe(true)
    expect(chatActivityGroupOpen(second, 'activity:a')).toBe(false)
  })

  it('prunes expansion state for groups and entries that no longer exist', () => {
    let state = createChatActivityExpansionState()
    state = setChatActivityGroupOpen(state, 'activity:a', true)
    state = setChatActivityGroupOpen(state, 'activity:b', true)
    state = setChatActivityEntryOpen(state, 'activity:a', 'tool:t1', true)
    state = setChatActivityEntryOpen(state, 'activity:a', 'tool:gone', true)

    const blocks: ChatTranscriptBlock[] = [
      activityBlock('activity:a', [tool('t1')]),
    ]
    const pruned = pruneChatActivityExpansion(state, blocks)
    expect(chatActivityGroupOpen(pruned, 'activity:a')).toBe(true)
    expect(chatActivityGroupOpen(pruned, 'activity:b')).toBe(false)
    expect(chatActivityOpenEntryIds(pruned, 'activity:a').has('tool:t1')).toBe(true)
    expect(chatActivityOpenEntryIds(pruned, 'activity:a').has('tool:gone')).toBe(false)
  })

  it('returns the same state when nothing needs pruning', () => {
    let state = createChatActivityExpansionState()
    state = setChatActivityGroupOpen(state, 'activity:a', true)
    const blocks: ChatTranscriptBlock[] = [
      activityBlock('activity:a', [tool('t1')]),
    ]
    expect(pruneChatActivityExpansion(state, blocks)).toBe(state)
  })
})
