import { describe, expect, it } from 'vitest'
import {
  rememberWorkspaceConversation,
  selectCodingConversationId,
  selectCTFResumePoint,
} from './workspaceSessionRouting'
import type { Conversation } from '@/types'

function conversation(overrides: Partial<Conversation>): Conversation {
  return {
    id: 'conversation',
    title: 'Conversation',
    createdAt: 1,
    messages: [],
    ...overrides,
  }
}

describe('workspaceSessionRouting', () => {
  const codingRecent = conversation({ id: 'coding-recent', title: '普通 Coding' })
  const ctfRecent = conversation({
    id: 'ctf-recent',
    title: 'CTF Solver',
    ctfJobId: 'ctf-job-recent',
    ctfRole: 'solver',
  })
  const codingOlder = conversation({ id: 'coding-older', title: '旧 Coding' })

  it('remembers Coding and CTF conversations independently', () => {
    const afterCoding = rememberWorkspaceConversation(codingOlder, {
      codingConversationId: null,
      ctfConversationId: null,
    })
    expect(afterCoding).toEqual({
      codingConversationId: 'coding-older',
      ctfConversationId: null,
    })

    const afterCTF = rememberWorkspaceConversation(ctfRecent, afterCoding)
    expect(afterCTF).toEqual({
      codingConversationId: 'coding-older',
      ctfConversationId: 'ctf-recent',
    })
  })

  it('restores Coding to the latest non-CTF conversation instead of reusing an active CTF Agent chat', () => {
    const conversations = [ctfRecent, codingRecent, codingOlder]

    expect(selectCodingConversationId(conversations, 'ctf-recent', 'coding-older'))
      .toBe('coding-older')
    expect(selectCodingConversationId(conversations, 'ctf-recent', null))
      .toBe('coding-recent')
  })

  it('restores CTF workspace resume points without replacing the active Coding conversation', () => {
    const conversations = [codingRecent, ctfRecent]

    expect(selectCTFResumePoint(conversations, 'coding-recent', 'ctf-recent')).toEqual({
      conversationId: 'ctf-recent',
      jobId: 'ctf-job-recent',
    })
  })
})
