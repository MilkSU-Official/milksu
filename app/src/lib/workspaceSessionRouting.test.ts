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
  const codingRecent = conversation({ id: 'coding-recent', title: '普通 Coding', createdAt: 30 })
  const ctfRecent = conversation({
    id: 'ctf-recent',
    title: 'CTF Solver',
    createdAt: 40,
    ctfJobId: 'ctf-job-recent',
    ctfRole: 'solver',
  })
  const ctfOlder = conversation({
    id: 'ctf-older',
    title: 'Old CTF Solver',
    createdAt: 20,
    ctfJobId: 'ctf-job-older',
    ctfRole: 'solver',
  })
  const codingOlder = conversation({ id: 'coding-older', title: '旧 Coding', createdAt: 10 })

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
    const conversations = [codingOlder, ctfRecent, codingRecent]

    expect(selectCodingConversationId(conversations, 'ctf-recent', 'coding-older'))
      .toBe('coding-older')
    expect(selectCodingConversationId(conversations, 'ctf-recent', null))
      .toBe('coding-recent')
  })

  it('falls back to the last active Coding conversation rather than the newest created row', () => {
    const conversations = [
      conversation({
        id: 'coding-created-newer',
        title: '顶部新建但未继续',
        createdAt: 200,
        messages: [],
      }),
      conversation({
        id: 'coding-active-older',
        title: '底部最近继续的任务',
        createdAt: 100,
        messages: [
          { id: 'message-1', role: 'user', content: '继续这里', timestamp: 500 },
        ],
      }),
      conversation({
        id: 'ctf-active',
        title: 'CTF Solver',
        createdAt: 300,
        ctfJobId: 'job',
        ctfRole: 'solver',
        messages: [
          { id: 'message-2', role: 'assistant', content: 'CTF still open', timestamp: 600 },
        ],
      }),
    ]

    expect(selectCodingConversationId(conversations, 'ctf-active', null))
      .toBe('coding-active-older')
  })

  it('restores CTF workspace resume points without replacing the active Coding conversation', () => {
    const conversations = [codingRecent, ctfOlder, ctfRecent]

    expect(selectCTFResumePoint(conversations, 'coding-recent', 'ctf-recent')).toEqual({
      conversationId: 'ctf-recent',
      jobId: 'ctf-job-recent',
    })
  })

  it('falls back to the newest CTF resume point when no remembered CTF chat exists', () => {
    const conversations = [ctfOlder, codingRecent, ctfRecent]

    expect(selectCTFResumePoint(conversations, 'coding-recent', null)).toEqual({
      conversationId: 'ctf-recent',
      jobId: 'ctf-job-recent',
    })
  })

  it('falls back to the last active CTF resume point rather than the newest created row', () => {
    const conversations = [
      conversation({
        id: 'ctf-created-newer',
        title: '顶部新建但未继续的 CTF',
        createdAt: 300,
        ctfJobId: 'ctf-job-created-newer',
        ctfRole: 'solver',
        messages: [],
      }),
      conversation({
        id: 'ctf-active-older',
        title: '底部最近继续的 CTF',
        createdAt: 100,
        ctfJobId: 'ctf-job-active-older',
        ctfRole: 'solver',
        messages: [
          { id: 'message-3', role: 'assistant', content: '继续这里', timestamp: 700 },
        ],
      }),
      codingRecent,
    ]

    expect(selectCTFResumePoint(conversations, 'coding-recent', null)).toEqual({
      conversationId: 'ctf-active-older',
      jobId: 'ctf-job-active-older',
    })
  })
})
