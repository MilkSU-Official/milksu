import { describe, expect, it } from 'vitest'
import {
  agentErrorMessage,
  agentRuntimeErrorMessage,
  agentToolResultMessage,
  normalizeConversation,
  projectAgentTools,
  projectAgentTurnPolicy,
  projectCodingAbortRequest,
  projectCodingMessageQueue,
  projectCodingRunFinished,
  turnMCPServers,
} from '@/composables/useConversations'

describe('Coding approval conversation recovery', () => {
  it('shows the no-tools contract and restores the reviewed tool set', () => {
    const reviewed = ['read', 'grep']
    let active = projectAgentTurnPolicy('session.turn_policy', false)
    expect(active).toBe(true)
    expect(projectAgentTools('session.turn_policy', undefined, reviewed, active)).toEqual([])
    active = projectAgentTurnPolicy('session.ready', active)
    expect(projectAgentTools('session.ready', reviewed, [], active)).toEqual([])
    active = projectAgentTurnPolicy('session.turn_policy_cleared', active)
    expect(active).toBe(false)
    expect(projectAgentTools(
      'session.turn_policy_cleared',
      reviewed,
      [],
      active,
    )).toEqual(reviewed)
  })

  it('expires an approval that cannot survive an app or Sidecar restart', () => {
    const conversation = normalizeConversation({
      id: 'conversation-1',
      title: 'Approval fixture',
      createdAt: 1,
      messages: [{
        id: 'message-1',
        role: 'tool',
        content: '$ npm test',
        timestamp: 2,
        toolName: 'bash',
        status: 'running',
        approvalRequestId: 'approval-1',
        approvalInput: '{"command":"npm test"}',
        approvalState: 'pending',
        attachments: [{
          id: 'ab'.repeat(32),
          sha256: 'ab'.repeat(32),
          name: 'screenshot.png',
          mediaType: 'image/png',
          size: 2048,
        }],
      }],
    })
    expect(conversation.messages[0]).toMatchObject({
      status: 'done',
      approvalState: 'expired',
      approvalReason: '应用或 Agent 已重启，本次审批已失效',
      attachments: [{
        id: 'ab'.repeat(32),
        sha256: 'ab'.repeat(32),
        name: 'screenshot.png',
        mediaType: 'image/png',
        size: 2048,
      }],
    })
  })

  it('drops invalid attachment references instead of trusting persisted paths', () => {
    const conversation = normalizeConversation({
      id: 'conversation-2',
      title: 'Attachment fixture',
      createdAt: 1,
      messages: [{
        id: 'message-2',
        role: 'user',
        content: 'inspect this',
        timestamp: 2,
        attachments: [{
          id: '../outside',
          sha256: '../outside',
          name: '../secret.txt',
          mediaType: 'text/plain',
          size: 1,
        }],
      }],
    })
    expect(conversation.messages[0]?.attachments).toBeUndefined()
  })

  it('restores only a known model source projection', () => {
    expect(normalizeConversation({
      id: 'conversation-account-source',
      title: 'Account source',
      createdAt: 1,
      modelSource: 'account',
      messages: [],
    }).modelSource).toBe('account')
    expect(normalizeConversation({
      id: 'conversation-unknown-source',
      title: 'Unknown source',
      createdAt: 1,
      modelSource: 'relay-secret-slot',
      messages: [],
    }).modelSource).toBeUndefined()
  })

  it('restores only a known per-conversation model source preference', () => {
    expect(normalizeConversation({
      id: 'coding-1',
      title: 'Coding',
      createdAt: 1,
      messages: [],
      modelSourcePreference: 'personal',
    }).modelSourcePreference).toBe('personal')

    expect(normalizeConversation({
      id: 'coding-2',
      title: 'Coding',
      createdAt: 1,
      messages: [],
      modelSourcePreference: 'relay-secret-slot',
    }).modelSourcePreference).toBeUndefined()
  })

  it('restores only a valid bounded Coding goal projection', () => {
    const conversation = normalizeConversation({
      id: 'conversation-goal',
      title: 'Goal fixture',
      createdAt: 1,
      agentGoal: {
        id: 'goal-1',
        text: '完成并验证交付',
        status: 'paused',
        startedAt: 10,
        updatedAt: 20,
        iteration: 3,
        tokenBudget: 100000,
        tokensUsed: 12000,
        timeUsedSeconds: 90,
        automaticModelTurns: 2,
        queuedCount: 0,
      },
      messages: [],
    })
    expect(conversation.agentGoal).toMatchObject({
      id: 'goal-1',
      text: '完成并验证交付',
      status: 'paused',
      tokenBudget: 100000,
      tokensUsed: 12000,
    })

    const malformed = normalizeConversation({
      id: 'conversation-bad-goal',
      title: 'Bad Goal fixture',
      createdAt: 1,
      agentGoal: {
        id: 'goal-2',
        text: 'unknown state',
        status: 'mystery',
      },
      messages: [],
    })
    expect(malformed.agentGoal).toBeUndefined()
  })

  it('restores only bounded MCP server names without control characters', () => {
    const conversation = normalizeConversation({
      id: 'conversation-mcp',
      title: 'MCP fixture',
      createdAt: 1,
      mcpServers: [
        'zeta',
        'alpha',
        'alpha',
        `line${String.fromCodePoint(10)}break`,
        `delete${String.fromCodePoint(127)}character`,
        'x'.repeat(81),
      ],
      messages: [],
    })

    expect(conversation.mcpServers).toEqual(['alpha', 'zeta'])
  })

  it('adds Browser Use only to the current turn MCP selection', () => {
    expect(turnMCPServers(['fixture'], 'browser-use')).toEqual([
      'fixture',
      'milksu-playwright-user',
    ])
    expect(turnMCPServers(['fixture'], 'computer-use')).toEqual(['fixture'])
    expect(turnMCPServers(undefined)).toEqual([])
  })

  it('keeps a stopped task running until the terminal Pi event arrives', () => {
    const requested = projectCodingAbortRequest(
      new Set(['conversation-running']),
      new Set(),
      'conversation-running',
    )
    expect(requested.accepted).toBe(true)
    expect(requested.running.has('conversation-running')).toBe(true)
    expect(requested.aborting.has('conversation-running')).toBe(true)

    const duplicate = projectCodingAbortRequest(
      requested.running,
      requested.aborting,
      'conversation-running',
    )
    expect(duplicate.accepted).toBe(false)

    const finished = projectCodingRunFinished(
      requested.running,
      requested.aborting,
      'conversation-running',
    )
    expect(finished.running.has('conversation-running')).toBe(false)
    expect(finished.aborting.has('conversation-running')).toBe(false)
  })

  it('projects a bounded Pi steering queue for the composer', () => {
    expect(projectCodingMessageQueue(
      ['先保留修改', '', '再检查失败测试'],
      ['最后总结'],
    )).toEqual({
      steering: ['先保留修改', '再检查失败测试'],
      followUp: ['最后总结'],
    })
  })

  it('turns provider network failures into a recoverable offline message', () => {
    expect(agentErrorMessage(
      'Error: dial tcp 127.0.0.1:65533: connect: connection refused api_key=sk-test-secret',
    )).toBe('模型或 Agent 网络连接失败。')
  })

  it('redacts provider credentials from unexpected engine errors', () => {
    const message = agentErrorMessage(
      'Error: provider rejected Authorization Bearer sk-live-secret-token OPENAI_API_KEY=sk-other-secret https://provider.example.test/v1?api_key=sk-query-secret&model=x x-api-key: sk-header-secret',
    )
    expect(message).toContain('Bearer [credential redacted]')
    expect(message).toContain('API_KEY=[credential redacted]')
    expect(message).toContain('?api_key=[credential redacted]')
    expect(message).toContain('x-api-key=[credential redacted]')
    expect(message).not.toContain('sk-live-secret-token')
    expect(message).not.toContain('sk-other-secret')
    expect(message).not.toContain('sk-query-secret')
    expect(message).not.toContain('sk-header-secret')
  })

  it('keeps packaged permission internals in diagnostics instead of chat', () => {
    const message = agentRuntimeErrorMessage(
      'Error: Access to this API has been restricted. Use --allow-fs-read to manage permissions. resource: /Users/example',
    )
    expect(message).toContain('本地 Agent 权限组件启动失败')
    expect(message).not.toContain('--allow-fs-read')
    expect(message).not.toContain('/Users/example')
  })

  it('replaces packaged permission failures inside tool cards without hiding normal test output', () => {
    const permission = agentToolResultMessage(
      'Access to this API has been restricted. Use --allow-fs-read to manage permissions.',
      'Access to this API has been restricted. Use --allow-fs-read to manage permissions. resource: /Users/example',
    )
    expect(permission).toContain('本地 Agent 权限组件启动失败')
    expect(permission).not.toContain('--allow-fs-read')
    expect(permission).not.toContain('/Users/example')

    expect(agentToolResultMessage(
      'FAIL src/math.test.ts\nExpected 2, received 3',
      'command exited with status 1',
    )).toContain('Expected 2, received 3')
  })

  it('turns internal runtime stacks into a bounded recovery message', () => {
    const message = agentRuntimeErrorMessage('Error: internal module exploded at bridge.js:42')
    expect(message).toContain('本地 Agent 运行异常')
    expect(message).not.toContain('bridge.js')
  })

  it('surfaces provider HTTP bodies after credential redaction', () => {
    const message = agentRuntimeErrorMessage(
      '403: {"message":"model group rate limited for this key","type":"permission_error"}',
    )
    expect(message).toContain('403')
    expect(message).toContain('model group rate limited for this key')
    expect(message).not.toContain('本地 Agent 运行异常')
  })

  it.each([
    [
      '401 status code (no body)',
      '模型凭据无效或无权访问',
      '401',
    ],
    [
      'tokenflux/grok-4.6 cannot start because both model sources are unavailable; add a personal API key or connect the beta account quota in Settings',
      '当前模型没有可用凭据',
      'both model sources',
    ],
    [
      '400: {"code":"COMPOSITE_KEY_MODEL_PREFIX_REQUIRED","message":"composite api key model must use prefix/model_id"}',
      '需要带厂商前缀的模型 ID',
      'COMPOSITE_KEY_MODEL_PREFIX_REQUIRED',
    ],
    [
      '403: {"message":"This group is restricted to Claude Code clients (/v1/messages only)","type":"permission_error"}',
      '仅支持 Claude Code 客户端',
      '/v1/messages only',
    ],
    [
      'Provider milksu-route: "baseUrl" is required when defining custom models.',
      '模型连接未就绪',
      'baseUrl',
    ],
    [
      'requested input exceeds the context window',
      '上下文过长，正在自动整理',
      'requested input exceeds',
    ],
    [
      'Context overflow recovery failed after one compact-and-retry attempt',
      '自动整理上下文失败',
      'compact-and-retry',
    ],
    [
      'AbortError: This operation was aborted',
      '本轮已停止',
      'AbortError',
    ],
    [
      'Connection error.',
      '模型或 Agent 网络连接失败',
      'Connection error',
    ],
    [
      '明确的目录授权需要包含一个可解析的具体路径',
      '具体目录路径',
      '可解析',
    ],
    [
      'Coding Agent cannot authorize a filesystem root or the whole user directory',
      '不能授权整个磁盘或用户主目录',
      'filesystem root',
    ],
    [
      'open Coding Agent project directory: no such file or directory',
      '无法打开该目录',
      'no such file',
    ],
  ])('maps common runtime failure %s to an actionable message', (raw, expected, hidden) => {
    const message = agentRuntimeErrorMessage(raw)
    expect(message).toContain(expected)
    expect(message).not.toContain(hidden)
  })

  it('does not expose unknown engine internals just because diagnostics need redaction', () => {
    const message = agentRuntimeErrorMessage(
      'Error: internal bridge.js:42 exploded with token=synthetic-secret-value',
    )
    expect(message).toContain('本地 Agent 运行异常')
    expect(message).not.toContain('bridge.js')
    expect(message).not.toContain('synthetic-secret-value')
  })

  it('restores structured CTF domainTaskContext from persisted conversation state', () => {
    const conversation = normalizeConversation({
      id: 'ctf-conversation-1',
      title: 'CTF · Web challenge',
      createdAt: 1,
      ctfJobId: 'job-42',
      ctfMode: 'copilot',
      ctfRole: 'solver',
      domainTaskContext: {
        kind: 'ctf',
        jobId: 'job-42',
        challengeId: 'ch-exact',
        challengeTitle: 'Exact live challenge',
        role: 'solver',
        roleLabel: '解题 Agent',
        materialStatus: '已挂载 1 份材料：dist.zip',
        materialCount: 1,
        authorizedScope: 'source-1 · base → origin:https://base.example | net-1 · lab → origin:https://lab.example',
        evidenceCount: 2,
        artifactCount: 1,
        judgeState: 'NSSCTF · accepted · 已验证正确',
        liveProjection: true,
      },
      messages: [],
    })
    expect(conversation.ctfJobId).toBe('job-42')
    expect(conversation.domainTaskContext).toMatchObject({
      kind: 'ctf',
      jobId: 'job-42',
      challengeId: 'ch-exact',
      challengeTitle: 'Exact live challenge',
      authorizedScope: expect.stringContaining('source-1'),
    })
    expect(String(conversation.domainTaskContext && 'authorizedScope' in conversation.domainTaskContext
      ? conversation.domainTaskContext.authorizedScope
      : '')).toContain('net-1')
  })

  it('restores last context occupancy from persisted conversation state', () => {
    const conversation = normalizeConversation({
      id: 'conversation-occupancy',
      title: 'Occupancy fixture',
      createdAt: 1,
      modelId: 'grok-4.6',
      lastContextUsage: {
        inputTokens: 40_000,
        outputTokens: 1200,
        cacheReadTokens: 10_000,
        cacheWriteTokens: 0,
        totalTokens: 51_200,
        contextWindow: 128_000,
        model: 'grok-4.6',
        recordedAt: 42,
      },
      messages: [],
    })
    expect(conversation.lastContextUsage).toMatchObject({
      inputTokens: 40_000,
      cacheReadTokens: 10_000,
      contextWindow: 128_000,
      model: 'grok-4.6',
      recordedAt: 42,
    })
  })

  it('restores structured CVE domainTaskContext without inventing network grants', () => {
    const conversation = normalizeConversation({
      id: 'cve-conversation-1',
      title: 'CVE-2023-46604 研究接力',
      createdAt: 1,
      domainTaskContext: {
        kind: 'cve',
        cveId: 'CVE-2023-46604',
        title: 'ActiveMQ RCE',
        sourceEvidenceState: 'NVD（imported）',
        sourceEvidenceCount: 1,
        assetMatchState: '尚无用户确认资产匹配',
        assetCount: 0,
        researchScope: '当前会话与用户所选项目/材料',
        safetyBoundary: '沿用 Coding Agent 当前权限档',
        roleLabel: 'CVE 研究接力',
      },
      messages: [],
    })
    expect(conversation.domainTaskContext).toMatchObject({
      kind: 'cve',
      cveId: 'CVE-2023-46604',
      researchScope: '当前会话与用户所选项目/材料',
      safetyBoundary: '沿用 Coding Agent 当前权限档',
    })
  })
})
