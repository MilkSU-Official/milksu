// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'

const invokeCommand = vi.fn(async (command: string, _args?: unknown) => {
  if (command === 'list_conversations') return []
  if (command === 'save_conversation') return null
  if (command === 'send_message') {
    throw new Error('send_message must not run on open-Coding handoff')
  }
  return null
})

vi.mock('@/desktop', () => ({
  invokeCommand: (command: string, args?: unknown) => invokeCommand(command, args),
  listenEvent: vi.fn(async () => () => {}),
}))

describe('useConversations domain handoff attach', () => {
  beforeEach(() => {
    invokeCommand.mockClear()
  })

  it('CTF startWorkspaceTask stages draft and domain context without send or running', async () => {
    const { useConversations } = await import('@/composables/useConversations')
    const conversations = useConversations()
    await conversations.startWorkspaceTask({
      jobId: 'job-42',
      conversationId: 'ctf-conversation-42',
      title: 'CTF · Exact challenge',
      workspacePath: '/tmp/ctf-job-42',
      prompt: 'proposed solver prompt',
      policy: { mode: 'copilot' },
      role: 'solver',
      domainTaskContext: {
        kind: 'ctf',
        jobId: 'job-42',
        challengeId: 'ch-exact',
        challengeTitle: 'Exact challenge',
        role: 'solver',
        roleLabel: '解题 Agent',
        materialStatus: '已挂载 1 份材料：dist.zip',
        materialCount: 1,
        authorizedScope: 'source-1 · base → origin:https://base.example | net-1 · lab → origin:https://lab.example',
        evidenceCount: 0,
        artifactCount: 0,
        judgeState: '尚无 Judge 回执',
        liveProjection: true,
      },
      // autoSend omitted / false
    })

    expect(conversations.activeId.value).toBe('ctf-conversation-42')
    const active = conversations.active.value
    expect(active?.ctfJobId).toBe('job-42')
    expect(active?.domainTaskContext).toMatchObject({
      kind: 'ctf',
      challengeId: 'ch-exact',
      authorizedScope: expect.stringContaining('source-1'),
    })
    expect(active?.messages ?? []).toEqual([])
    expect(conversations.activeRunning.value).toBe(false)
    expect(conversations.pendingComposerDraft.value).toEqual({
      prompt: 'proposed solver prompt',
      visibleText: 'proposed solver prompt',
    })
    expect(invokeCommand.mock.calls.some(call => call[0] === 'send_message')).toBe(false)
    expect(invokeCommand.mock.calls.some(call => call[0] === 'save_conversation')).toBe(true)
  })

  it('CVE ensureConversation + stageComposerDraft does not send', async () => {
    const { useConversations } = await import('@/composables/useConversations')
    const conversations = useConversations()
    conversations.startNew()
    const id = conversations.ensureConversation('CVE-2023-46604 研究接力', {
      domainTaskContext: {
        kind: 'cve',
        cveId: 'CVE-2023-46604',
        title: 'ActiveMQ',
        sourceEvidenceState: 'NVD（imported）',
        sourceEvidenceCount: 1,
        assetMatchState: 'none',
        assetCount: 0,
        researchScope: 'read-only cached evidence only',
        safetyBoundary: '学习与追踪 only',
        roleLabel: 'CVE 只读/研究接力',
      },
    })
    conversations.stageComposerDraft(
      'full CVE prompt using cached evidence only',
      '接手 CVE-2023-46604',
    )
    expect(id).toBeTruthy()
    expect(conversations.active.value?.domainTaskContext).toMatchObject({
      kind: 'cve',
      cveId: 'CVE-2023-46604',
    })
    expect(conversations.pendingComposerDraft.value?.visibleText).toBe('接手 CVE-2023-46604')
    expect(conversations.activeRunning.value).toBe(false)
    expect(invokeCommand.mock.calls.some(call => call[0] === 'send_message')).toBe(false)
  })
})
