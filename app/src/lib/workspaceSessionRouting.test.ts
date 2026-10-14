import { describe, expect, it } from 'vitest'
import {
  rememberItemChatAnchor,
  rememberWorkspaceConversation,
  selectAnchoredDomainConversationId,
  selectCodingConversationId,
  conversationWorkspaceHome,
  isHomeConversation,
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
  const codingOlder = conversation({ id: 'coding-older', title: '旧 Coding', createdAt: 10 })

  it('remembers Coding conversations independently of CVE and Lab', () => {
    const afterCoding = rememberWorkspaceConversation(codingOlder, {
      codingConversationId: null,
      vulnConversationId: null,
      labConversationId: null,
      imageConversationId: null,
    })
    expect(afterCoding).toEqual({
      codingConversationId: 'coding-older',
      vulnConversationId: null,
      labConversationId: null,
      imageConversationId: null,
    })
  })

  it('restores Coding to the latest home conversation instead of a domain chat', () => {
    const cveOpen = conversation({
      id: 'cve-open',
      title: 'CVE-2024-3400 复现',
      createdAt: 40,
      domainTaskContext: {
        kind: 'cve',
        cveId: 'CVE-2024-3400',
        title: 'PAN-OS',
        sourceEvidenceState: '',
        sourceEvidenceCount: 0,
        assetMatchState: '',
        assetCount: 0,
        researchScope: 'local',
        safetyBoundary: '',
        roleLabel: 'CVE',
      },
    })
    const conversations = [codingOlder, cveOpen, codingRecent]

    expect(selectCodingConversationId(conversations, 'cve-open', 'coding-older'))
      .toBe('coding-older')
    expect(selectCodingConversationId(conversations, 'cve-open', null))
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
        id: 'cve-active',
        title: 'CVE still open',
        createdAt: 300,
        domainTaskContext: {
          kind: 'cve',
          cveId: 'CVE-2024-3400',
          title: 'PAN-OS',
          sourceEvidenceState: '',
          sourceEvidenceCount: 0,
          assetMatchState: '',
          assetCount: 0,
          researchScope: 'local',
          safetyBoundary: '',
          roleLabel: 'CVE',
        },
        messages: [
          { id: 'message-2', role: 'assistant', content: 'CVE still open', timestamp: 600 },
        ],
      }),
    ]

    expect(selectCodingConversationId(conversations, 'cve-active', null))
      .toBe('coding-active-older')
  })

  it('reads a stored CTF home as Coding', () => {
    const unbound = conversation({
      id: 'legacy-ctf',
      title: '整理题库',
      createdAt: 12,
      workspaceHome: 'ctf' as unknown as Conversation['workspaceHome'],
    })
    expect(conversationWorkspaceHome(unbound)).toBe('chat')
    expect(isHomeConversation(unbound)).toBe(true)
  })

  it('does not treat CVE or Lab chats as Home conversations', () => {
    const cve = conversation({
      id: 'cve-open',
      title: 'CVE-2024-3400 复现',
      createdAt: 80,
      domainTaskContext: {
        kind: 'cve',
        cveId: 'CVE-2024-3400',
        title: 'PAN-OS',
        sourceEvidenceState: '',
        sourceEvidenceCount: 0,
        assetMatchState: '',
        assetCount: 0,
        researchScope: 'local',
        safetyBoundary: '',
        roleLabel: 'CVE',
      },
    })
    const lab = conversation({
      id: 'lab-open',
      title: 'Juice Shop',
      createdAt: 90,
      domainTaskContext: {
        kind: 'lab',
        jobId: 'job-1',
        title: 'Juice Shop',
        scope: 'local',
        request: '',
      },
    })

    expect(selectCodingConversationId([cve, lab, codingOlder], 'cve-open', null))
      .toBe('coding-older')
    expect(selectCodingConversationId([cve, lab], 'lab-open', null)).toBeNull()
  })

  it('anchors the last selected chat for a domain item', () => {
    const context = {
      kind: 'cve' as const,
      cveId: 'CVE-2024-3400',
      title: 'PAN-OS',
      sourceEvidenceState: '',
      sourceEvidenceCount: 0,
      assetMatchState: '',
      assetCount: 0,
      researchScope: 'local',
      safetyBoundary: '',
      roleLabel: 'CVE',
    }
    const first = conversation({
      id: 'cve-canonical',
      title: 'CVE-2024-3400 复现',
      createdAt: 10,
      domainTaskContext: context,
    })
    const second = conversation({
      id: 'cve-followup',
      title: 'CVE-2024-3400 复现',
      createdAt: 20,
      domainTaskContext: context,
    })
    const anchors = rememberItemChatAnchor({}, first)
    const next = rememberItemChatAnchor(anchors, second)
    expect(next).toEqual({ 'cve:cve-2024-3400': 'cve-followup' })
    expect(selectAnchoredDomainConversationId([first, second], context, next))
      .toBe('cve-followup')
    expect(selectAnchoredDomainConversationId([first, second], context, {}))
      .toBe('cve-followup')
  })
})
