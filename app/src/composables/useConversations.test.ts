import { describe, expect, it } from 'vitest'
import { normalizeConversation } from '@/composables/useConversations'

describe('Coding approval conversation recovery', () => {
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
})
