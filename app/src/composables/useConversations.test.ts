import { describe, expect, it } from 'vitest'
import {
  normalizeConversation,
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
})
