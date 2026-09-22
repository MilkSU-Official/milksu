import { describe, expect, it } from 'vitest'
import { buildChatTranscript } from '@/lib/chatActivity'
import { chatFoldModel, chatWorkTotalsLabel } from '@/lib/chatWorkStatus'
import { applyUiLocale } from '@/lib/uiLocale'
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

describe('chatWorkStatus', () => {
  it('counts a finished turn as thinking, files, and commands', () => {
    applyUiLocale('zh')
    const transcript = buildChatTranscript([
      message('u1', 'user', '完成任务'),
      message('a1', 'assistant', '', {
        thinking: '先看仓库。',
        thinkingStatus: 'done',
        thinkingDurationMs: 800,
      }),
      message('a2', 'assistant', '', {
        thinking: '再跑测试。',
        thinkingStatus: 'done',
        thinkingDurationMs: 500,
      }),
      message('t1', 'tool', '/repo/src/app.ts', { toolName: 'read' }),
      message('t2', 'tool', '/repo/src/app.ts', { toolName: 'read' }),
      message('t3', 'tool', 'npm test', { toolName: 'bash' }),
      message('a3', 'assistant', '看完了。'),
    ], false)
    const process = transcript.find(block => block.kind === 'process')
    expect(process?.kind).toBe('process')
    const model = chatFoldModel(transcript, process?.id ?? '', false)
    expect(chatWorkTotalsLabel(model.entries, model.thinkingMs)).toBe('想了 1.3s · 1 个文件 · 1 条命令')
    expect(model.liveLabel).toBe('')
  })

  it('names the running action under the turn totals', () => {
    applyUiLocale('zh')
    const transcript = buildChatTranscript([
      message('u1', 'user', '继续'),
      message('a1', 'assistant', '', {
        thinking: '先看。',
        thinkingStatus: 'done',
        thinkingDurationMs: 800,
      }),
      message('t1', 'tool', 'src/click/_termui_impl.py', { toolName: 'read', status: 'running' }),
    ], true)
    const activity = transcript.find(block => block.kind === 'activity')
    const model = chatFoldModel(transcript, activity?.id ?? '', true)
    expect(chatWorkTotalsLabel(model.entries, model.thinkingMs)).toBe('想了 0.8s · 1 个文件')
    expect(model.liveLabel).toBe('正在读 _termui_impl.py')
    applyUiLocale('en')
    expect(chatFoldModel(transcript, activity?.id ?? '', true).liveLabel).toBe('Reading _termui_impl.py')
    applyUiLocale('zh')
  })

  it('switches the live line to thinking when the tools have already finished', () => {
    applyUiLocale('zh')
    const transcript = buildChatTranscript([
      message('u1', 'user', '继续'),
      message('t1', 'tool', '/repo', { toolName: 'read' }),
      message('t2', 'tool', 'pattern', { toolName: 'grep' }),
      message('a1', 'assistant', '', {
        thinking: '还在想。',
        thinkingStatus: 'running',
        status: 'running',
      }),
    ], true)
    const process = transcript.find(block => block.kind === 'process')
    const model = chatFoldModel(transcript, process?.id ?? '', true)
    expect(model.liveLabel).toBe('正在思考')
    expect(chatWorkTotalsLabel(model.entries, model.thinkingMs)).toBe('1 个文件 · 1 次检索')
  })
})
