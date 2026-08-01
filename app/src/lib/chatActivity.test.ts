import { describe, expect, it } from 'vitest'
import {
  buildChatTranscript,
  chatActivityEntrySummary,
  chatActivitySummary,
} from '@/lib/chatActivity'
import type { Message } from '@/types'

function message(
  id: string,
  role: Message['role'],
  content: string,
  extra: Partial<Message> = {},
): Message {
  return {
    id,
    role,
    content,
    timestamp: 1,
    status: 'done',
    ...extra,
  }
}

describe('buildChatTranscript', () => {
  it('folds progress and tool calls while keeping the final answer visible', () => {
    const transcript = buildChatTranscript([
      message('u1', 'user', '完成任务'),
      message('a1', 'assistant', '先读取仓库。'),
      message('t1', 'tool', '/repo', { toolName: 'read' }),
      message('a2', 'assistant', '接着运行测试。'),
      message('t2', 'tool', 'npm test', { toolName: 'bash' }),
      message('a3', 'assistant', '测试通过，交付完成。'),
    ], false)

    expect(transcript.map(block => block.kind)).toEqual(['message', 'activity', 'message'])
    expect(transcript[1]?.kind === 'activity' && transcript[1].messages.map(item => item.id))
      .toEqual(['a1', 't1', 'a2', 't2'])
    expect(transcript[2]?.kind === 'message' && transcript[2].message.id).toBe('a3')
  })

  it('keeps the live response inside the collapsed activity until the run finishes', () => {
    const transcript = buildChatTranscript([
      message('u1', 'user', '完成任务'),
      message('a1', 'assistant', '正在检查。', { status: 'running' }),
    ], true)

    expect(transcript).toHaveLength(2)
    expect(transcript[1]?.kind).toBe('activity')
    expect(transcript[1]?.kind === 'activity' && transcript[1].running).toBe(true)
  })

  it('leaves approvals visible as standalone decision cards', () => {
    const transcript = buildChatTranscript([
      message('u1', 'user', '推送'),
      message('approval', 'tool', 'git push', {
        toolName: 'bash',
        approvalRequestId: 'request-1',
        approvalState: 'pending',
      }),
    ], true)

    expect(transcript.map(block => block.kind)).toEqual(['message', 'message'])
    expect(transcript[1]?.kind === 'message' && transcript[1].message.approvalRequestId)
      .toBe('request-1')
  })

  it('does not hide an ordinary assistant-only answer', () => {
    const transcript = buildChatTranscript([
      message('u1', 'user', '解释一下'),
      message('a1', 'assistant', '这是最终解释。'),
    ], false)

    expect(transcript.map(block => block.kind)).toEqual(['message', 'message'])
  })
})

describe('activity labels', () => {
  it('uses a Codex-like aggregate summary', () => {
    expect(chatActivitySummary([
      message('write', 'tool', 'src/app.ts', { toolName: 'write' }),
      message('bash-1', 'tool', 'npm test', { toolName: 'bash' }),
      message('bash-2', 'tool', 'npm run build', { toolName: 'bash' }),
    ])).toBe('编辑了文件并运行了多个命令')
  })

  it('summarizes individual rows without exposing their full output', () => {
    expect(chatActivityEntrySummary(
      message('bash', 'tool', 'npm test\n\nhundreds of lines', { toolName: 'bash' }),
    )).toBe('运行 npm test')
    expect(chatActivityEntrySummary(
      message('assistant', 'assistant', '接下来检查构建结果。\n更多推理'),
    )).toBe('接下来检查构建结果。')
  })
})
