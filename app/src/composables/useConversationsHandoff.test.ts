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

  it('CTF startWorkspaceTask attaches domain context without send, running, or a canned draft', async () => {
    const { useConversations } = await import('@/composables/useConversations')
    const conversations = useConversations()
    await conversations.startWorkspaceTask({
      jobId: 'job-42',
      conversationId: 'ctf-conversation-42',
      title: 'CTF · Exact challenge',
      workspacePath: '/tmp/ctf-job-42',
      prompt: 'proposed solver prompt',
      visibleText: '继续解决 Exact challenge',
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
    expect(conversations.pendingComposerDraft.value).toBeNull()
    expect(invokeCommand.mock.calls.some(call => call[0] === 'send_message')).toBe(false)
    expect(invokeCommand.mock.calls.some(call => call[0] === 'save_conversation')).toBe(true)
  })

  it('CVE ensureConversation + stageComposerDraft does not send', async () => {
    const { useConversations } = await import('@/composables/useConversations')
    const conversations = useConversations()
    conversations.startNew()
    const id = conversations.ensureConversation('CVE-2023-46604 研究接力', {
      conversationId: 'cve-research-cve-2023-46604',
      domainTaskContext: {
        kind: 'cve',
        cveId: 'CVE-2023-46604',
        title: 'ActiveMQ',
        sourceEvidenceState: 'NVD（imported）',
        sourceEvidenceCount: 1,
        assetMatchState: 'none',
        assetCount: 0,
        researchScope: '当前会话与用户所选项目/材料',
        safetyBoundary: '沿用 Coding Agent 当前权限档',
        roleLabel: 'CVE 研究接力',
      },
    })
    conversations.stageComposerDraft(
      'full CVE prompt using cached evidence only',
      '接手 CVE-2023-46604',
    )
    expect(id).toBeTruthy()
    expect(id).toBe('cve-research-cve-2023-46604')
    expect(conversations.active.value?.domainTaskContext).toMatchObject({
      kind: 'cve',
      cveId: 'CVE-2023-46604',
    })
    expect(conversations.pendingComposerDraft.value?.visibleText).toBe('接手 CVE-2023-46604')
    expect(conversations.activeRunning.value).toBe(false)
    expect(invokeCommand.mock.calls.some(call => call[0] === 'send_message')).toBe(false)
  })

  it('reuses one Coding conversation when the same CVE is handed off repeatedly', async () => {
    const { useConversations } = await import('@/composables/useConversations')
    const conversations = useConversations()
    const context = {
      kind: 'cve' as const,
      cveId: 'CVE-2024-3400',
      title: 'PAN-OS',
      sourceEvidenceState: '尚无用户导入 Feed / 来源证据',
      sourceEvidenceCount: 0,
      assetMatchState: '3 项资产',
      assetCount: 3,
      researchScope: '当前会话与用户所选项目/材料',
      safetyBoundary: '沿用 Coding Agent 当前权限档',
      roleLabel: 'CVE 研究接力',
    }

    for (let attempt = 0; attempt < 2; attempt += 1) {
      conversations.startNew()
      conversations.ensureConversation('CVE-2024-3400 研究接力', {
        conversationId: 'cve-research-cve-2024-3400',
        domainTaskContext: context,
      })
      conversations.stageComposerDraft('research prompt', '接手 CVE-2024-3400')
    }

    expect(conversations.conversations.value).toHaveLength(1)
    expect(conversations.activeId.value).toBe('cve-research-cve-2024-3400')
    expect(conversations.active.value?.domainTaskContext).toMatchObject({
      kind: 'cve',
      cveId: 'CVE-2024-3400',
    })
    expect(conversations.pendingComposerDraft.value?.visibleText).toBe('接手 CVE-2024-3400')
    expect(invokeCommand.mock.calls.some(call => call[0] === 'send_message')).toBe(false)
  })

  it('clears stale CTF workspace and role state when a deterministic CVE conversation is reused', async () => {
    const { useConversations } = await import('@/composables/useConversations')
    const conversations = useConversations()
    await conversations.startWorkspaceTask({
      jobId: 'ctf-job-stale',
      conversationId: 'cve-research-cve-2024-3400',
      title: 'stale CTF task',
      workspacePath: '/tmp/ctf-workspaces/stale',
      prompt: 'stale CTF prompt',
      policy: { mode: 'copilot' },
      role: 'solver',
    })

    conversations.startNew()
    conversations.ensureConversation('CVE-2024-3400 研究接力', {
      conversationId: 'cve-research-cve-2024-3400',
      workspacePath: '',
      domainTaskContext: {
        kind: 'cve',
        cveId: 'CVE-2024-3400',
        title: 'PAN-OS',
        sourceEvidenceState: '尚无来源证据',
        sourceEvidenceCount: 0,
        assetMatchState: '3 项资产',
        assetCount: 3,
        researchScope: '当前会话与用户所选项目/材料',
        safetyBoundary: '沿用 Coding Agent 当前权限档',
        roleLabel: 'CVE 研究接力',
      },
    })
    conversations.stageComposerDraft('CVE prompt', '接手 CVE-2024-3400')

    expect(conversations.active.value).toMatchObject({
      id: 'cve-research-cve-2024-3400',
      title: 'CVE-2024-3400 研究接力',
      domainTaskContext: { kind: 'cve', cveId: 'CVE-2024-3400' },
    })
    expect(conversations.active.value?.workspacePath).toBeUndefined()
    expect(conversations.active.value?.ctfJobId).toBeUndefined()
    expect(conversations.active.value?.ctfMode).toBeUndefined()
    expect(conversations.active.value?.ctfRole).toBeUndefined()
    expect(conversations.pendingComposerDraft.value?.visibleText).toBe('接手 CVE-2024-3400')
  })
})
