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

  it('resumes CTF from persisted evidence without repeating completed work', () => {
    const prompt = agentRecoveryPrompt(true)
    expect(prompt).toContain('notes.md')
    expect(prompt).toContain('最近一次已完成的工具结果')
    expect(prompt).toContain('不要重复')
    expect(prompt).toContain('最小、可验证')
  })
})
