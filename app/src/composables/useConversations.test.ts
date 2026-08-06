import { describe, expect, it } from 'vitest'
import {
  agentErrorMessage,
  normalizeConversation,
  promptWithCodingWorkspaceContext,
  projectAgentTools,
  projectAgentTurnPolicy,
  projectCodingAbortRequest,
  projectCodingRunFinished,
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

  it('turns provider network failures into a recoverable offline message', () => {
    expect(agentErrorMessage(
      'Error: dial tcp 127.0.0.1:65533: connect: connection refused api_key=sk-test-secret',
    )).toBe(
      '模型或 Agent 网络连接失败。请检查网络、Provider Base URL、本地代理或服务状态；工作区、审批和恢复点已保留，可以稍后继续。',
    )
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

  it('adds hidden workspace context to natural Coding prompts without changing slash commands', () => {
    const conversation = normalizeConversation({
      id: 'conversation-milksu',
      title: '为什么 milksu',
      createdAt: 1,
      workspacePath: '/Users/milksu/code/milksu',
      messages: [],
    })

    const prompt = promptWithCodingWorkspaceContext('为什么叫 milksu？', conversation)
    expect(prompt).toContain('The user selected this project workspace: milksu')
    expect(prompt).toContain('Absolute workspace path: /Users/milksu/code/milksu')
    expect(prompt).toContain('User request:\n为什么叫 milksu？')

    expect(promptWithCodingWorkspaceContext('/goal resume', conversation)).toBe('/goal resume')
    expect(promptWithCodingWorkspaceContext(
      '[MilkSU product action: Understand project]\n请理解项目',
      conversation,
    )).toBe('[MilkSU product action: Understand project]\n请理解项目')
  })
})
