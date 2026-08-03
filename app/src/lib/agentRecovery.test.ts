import { describe, expect, it } from 'vitest'
import {
  agentRecoveryPrompt,
  recoverableAgentFailureId,
} from '@/lib/agentRecovery'
import type { Message } from '@/types'

function message(
  id: string,
  role: Message['role'],
  content: string,
): Message {
  return {
    id,
    role,
    content,
    timestamp: 1,
    status: 'done',
  }
}

describe('agent recovery', () => {
  it('offers recovery only for the latest no-activity failure', () => {
    expect(recoverableAgentFailureId([
      message('user', 'user', '继续分析'),
      message(
        'failure',
        'assistant',
        'Agent 运行失败：模型长时间没有产生文本或工具进展，本回合已停止。',
      ),
    ], false)).toBe('failure')

    expect(recoverableAgentFailureId([
      message('failure', 'assistant', 'produced no model or tool activity'),
      message('newer', 'user', '新的要求'),
    ], false)).toBe('')

    expect(recoverableAgentFailureId([
      message('failure', 'assistant', 'produced no model or tool activity'),
    ], true)).toBe('')
  })

  it('offers recovery for transient network failures without treating configuration errors as resumable', () => {
    expect(recoverableAgentFailureId([
      message(
        'network',
        'assistant',
        '模型或 Agent 网络连接失败。请检查网络、Provider Base URL、本地代理或服务状态；工作区、审批和恢复点已保留，可以稍后继续。',
      ),
    ], false)).toBe('network')

    expect(recoverableAgentFailureId([
      message('english-network', 'assistant', 'Agent 运行失败：dial tcp 127.0.0.1:65533: connect: connection refused'),
    ], false)).toBe('english-network')

    expect(recoverableAgentFailureId([
      message('missing-key', 'assistant', '当前模型没有可用的 API Key，请在“授权与模型”中保存并验证。'),
    ], false)).toBe('')

    expect(recoverableAgentFailureId([
      message('bad-model', 'assistant', '当前模型不受 PI 运行时支持，请在“授权与模型”中更换模型并验证。'),
    ], false)).toBe('')
  })

  it('resumes CTF from persisted evidence without repeating completed work', () => {
    const prompt = agentRecoveryPrompt(true)
    expect(prompt).toContain('notes.md')
    expect(prompt).toContain('最近一次已完成的工具结果')
    expect(prompt).toContain('不要重复')
    expect(prompt).toContain('最小、可验证')
  })
})
