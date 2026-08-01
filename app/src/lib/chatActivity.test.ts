import { describe, expect, it } from 'vitest'
import {
  buildChatActivityEntries,
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
  it('folds only tool calls while keeping progress and the final answer visible', () => {
    const transcript = buildChatTranscript([
      message('u1', 'user', '完成任务'),
      message('a1', 'assistant', '先读取仓库。'),
      message('t1', 'tool', '/repo', { toolName: 'read' }),
      message('a2', 'assistant', '接着运行测试。'),
      message('t2', 'tool', 'npm test', { toolName: 'bash' }),
      message('a3', 'assistant', '测试通过，交付完成。'),
    ], false)

    expect(transcript.map(block => block.kind)).toEqual([
      'message',
      'message',
      'activity',
      'message',
      'activity',
      'message',
    ])
    expect(transcript[1]?.kind === 'message' && transcript[1].message.id).toBe('a1')
    expect(transcript[2]?.kind === 'activity' && transcript[2].messages.map(item => item.id))
      .toEqual(['t1'])
    expect(transcript[3]?.kind === 'message' && transcript[3].message.id).toBe('a2')
    expect(transcript[5]?.kind === 'message' && transcript[5].message.id).toBe('a3')
  })

  it('groups consecutive tools beneath one top-level disclosure', () => {
    const transcript = buildChatTranscript([
      message('u1', 'user', '验证项目'),
      message('a1', 'assistant', '现在执行验证。'),
      message('t1', 'tool', '$ npm test', { toolName: 'bash' }),
      message('t2', 'tool', '$ npm run build', { toolName: 'bash' }),
      message('a2', 'assistant', '验证通过。'),
    ], false)

    expect(transcript.map(block => block.kind)).toEqual([
      'message',
      'message',
      'activity',
      'message',
    ])
    expect(transcript[2]?.kind === 'activity' && transcript[2].messages.map(item => item.id))
      .toEqual(['t1', 't2'])
  })

  it('keeps a live assistant response visible after collapsed activity', () => {
    const transcript = buildChatTranscript([
      message('u1', 'user', '完成任务'),
      message('a1', 'assistant', '先运行测试。'),
      message('t1', 'tool', 'npm test', { toolName: 'bash' }),
      message('a2', 'assistant', '测试完成，正在整理结果。', { status: 'running' }),
    ], true)

    expect(transcript).toHaveLength(4)
    expect(transcript[1]?.kind).toBe('message')
    expect(transcript[2]?.kind).toBe('activity')
    expect(transcript[3]?.kind).toBe('message')
    expect(transcript[3]?.kind === 'message' && transcript[3].message.id).toBe('a2')
  })

  it('shows an assistant-only live response instead of folding it as thinking', () => {
    const transcript = buildChatTranscript([
      message('u1', 'user', '解释一下'),
      message('a1', 'assistant', '正在回答。', { status: 'running' }),
    ], true)

    expect(transcript.map(block => block.kind)).toEqual(['message', 'message'])
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
    ])).toBe('编辑了文件运行了多个命令')
  })

  it('summarizes individual rows without exposing their full output', () => {
    expect(chatActivityEntrySummary(
      message('bash', 'tool', 'npm test\n\nhundreds of lines', { toolName: 'bash' }),
    )).toBe('运行 npm test')
    expect(chatActivityEntrySummary(
      message('assistant', 'assistant', '接下来检查构建结果。\n更多推理'),
    )).toBe('接下来检查构建结果。')
  })

  it('pairs tool start and result events into one expandable row', () => {
    const entries = buildChatActivityEntries([
      message('ls-start', 'tool', '{}', { toolName: 'ls', status: 'running' }),
      message('bash-start', 'tool', '$ npm test', { toolName: 'bash', status: 'running' }),
      message('ls-result', 'tool', 'src/\ntest/', { toolName: 'ls' }),
      message('bash-result', 'tool', '2 tests passed', { toolName: 'bash' }),
    ])

    expect(entries).toHaveLength(2)
    expect(entries[0]).toMatchObject({
      toolName: 'ls',
      request: { id: 'ls-start' },
      result: { id: 'ls-result' },
      running: false,
    })
    expect(entries[1]).toMatchObject({
      toolName: 'bash',
      request: { id: 'bash-start' },
      result: { id: 'bash-result' },
      running: false,
    })
    expect(chatActivityEntrySummary(entries[0]!)).toBe('查看目录')
    expect(chatActivityEntrySummary(entries[1]!)).toBe('运行 $ npm test')
    expect(chatActivityEntrySummary(
      message('write-result', 'tool', 'Successfully wrote 12 bytes to src/app.ts', {
        toolName: 'write',
      }),
    )).toBe('写入 src/app.ts')
    expect(chatActivityEntrySummary(
      message('background', 'tool', 'spawn · Vite · npm run dev', {
        toolName: 'bg_task',
      }),
    )).toBe('管理后台任务 spawn · Vite · npm run dev')
  })
})
