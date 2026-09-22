import { describe, expect, it } from 'vitest'
import { mergeCompanionTranscriptTail } from '@/lib/companionTranscriptTail'
import type { CompanionTranscriptEntry } from '@/types'

function entry(id: string, role: string, text: string): CompanionTranscriptEntry {
  return { id, type: 'message', timestamp: '2026-09-22T08:00:00.000Z', role, text }
}

describe('mergeCompanionTranscriptTail', () => {
  it('keeps the outgoing user line when the refreshed tail does not have it yet', () => {
    const pending = { id: 'pending:1', prompt: '看看这三条', attachments: [] }
    const optimistic = entry('pending:1', 'user', '看看这三条')
    const merged = mergeCompanionTranscriptTail(
      [entry('a1', 'assistant', '上一句')],
      [entry('a1', 'assistant', '上一句'), optimistic],
      pending,
    )
    expect(merged.map(item => item.id)).toEqual(['a1', 'pending:1'])
  })

  it('does not duplicate the user line once the transcript has it', () => {
    const pending = { id: 'pending:1', prompt: '看看这三条', attachments: [] }
    const merged = mergeCompanionTranscriptTail(
      [entry('a1', 'assistant', '上一句'), entry('u1', 'user', '看看这三条')],
      [entry('pending:1', 'user', '看看这三条')],
      pending,
    )
    expect(merged.map(item => item.id)).toEqual(['a1', 'u1'])
  })
})