import { describe, expect, it } from 'vitest'
import {
  applyAssistantThinkingEvent,
  applyCodingToolEvent,
  buildChatActivityEntries,
  visibleChatActivityEntries,
  buildChatTranscript,
  chatActivityEntrySummary,
  chatActivitySummary,
  detailsToggleOpen,
  isBlankAssistantMessage,
  settleRunningToolMessages,
  withoutBlankAssistantMessages,
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
    expect(transcript[2]?.kind === 'activity' && transcript[2].id).toBe('activity:t1')
  })

  it('keeps a live tool group key stable while later tools are appended', () => {
    const first = buildChatTranscript([
      message('u1', 'user', '查一下'),
      message('t1', 'tool', '打开首页', {
        toolName: 'mcp',
        toolCallId: 'call-1',
        status: 'running',
      }),
    ], true)
    const second = buildChatTranscript([
      message('u1', 'user', '查一下'),
      message('t1', 'tool', '打开首页', {
        toolName: 'mcp',
        toolCallId: 'call-1',
        status: 'done',
      }),
      message('t1-result', 'tool', 'ok', {
        toolName: 'mcp',
        toolCallId: 'call-1',
      }),
      message('t2', 'tool', '点击播放', {
        toolName: 'mcp',
        toolCallId: 'call-2',
        status: 'running',
      }),
    ], true)

    expect(first[1]?.kind === 'activity' && first[1].id).toBe('activity:t1')
    expect(second[1]?.kind === 'activity' && second[1].id).toBe('activity:t1')
    expect(second[1]?.kind === 'activity' && second[1].running).toBe(true)
  })

  it('stops the group spinner after paired tool results even if a start row lingered', () => {
    const transcript = buildChatTranscript([
      message('t1', 'tool', '打开首页', {
        toolName: 'mcp',
        toolCallId: 'call-1',
        status: 'done',
      }),
      message('t1-result', 'tool', 'ok', {
        toolName: 'mcp',
        toolCallId: 'call-1',
      }),
    ], true)
    expect(transcript[0]?.kind === 'activity' && transcript[0].running).toBe(false)
  })

  it('drops blank assistant shells from the message list', () => {
    const messages = [
      message('t1', 'tool', '$ npm test', { toolName: 'bash' }),
      message('empty', 'assistant', '   ', { status: 'running' }),
      message('t2', 'tool', '$ npm run build', { toolName: 'bash' }),
    ]
    expect(isBlankAssistantMessage(messages[1]!)).toBe(true)
    expect(withoutBlankAssistantMessages(messages).map(item => item.id)).toEqual(['t1', 't2'])
  })

  it('keeps one activity block across an empty assistant shell', () => {
    const transcript = buildChatTranscript([
      message('t1', 'tool', '$ npm test', { toolName: 'bash' }),
      message('empty', 'assistant', '   ', { status: 'done' }),
      message('t2', 'tool', '$ npm run build', { toolName: 'bash' }),
    ], false)

    expect(transcript).toHaveLength(1)
    expect(transcript[0]?.kind === 'activity' && transcript[0].messages.map(item => item.id))
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

  it('summarizes ImageGen as a delivered project asset', () => {
    const entries = buildChatActivityEntries([
      message('image-start', 'tool', '生成图片 · assets/hero.png · 1024x1024 · low', {
        toolName: 'milksu_imagegen',
        toolCallId: 'image-call',
        status: 'running',
      }),
      message('image-result', 'tool', JSON.stringify({
        status: 'completed',
        output: { path: 'assets/hero.png' },
      }), {
        toolName: 'milksu_imagegen',
        toolCallId: 'image-call',
      }),
    ])
    expect(chatActivitySummary([
      message('image-result', 'tool', '{}', { toolName: 'milksu_imagegen' }),
    ])).toBe('生成或编辑了图片')
    expect(chatActivityEntrySummary(entries[0]!)).toBe('交付图片 assets/hero.png')
  })

  it('pairs tool start and result events into one expandable row', () => {
    const entries = buildChatActivityEntries([
      message('ls-start', 'tool', '{}', { toolName: 'ls', status: 'running' }),
      message('bash-start', 'tool', '$ npm test', {
        toolName: 'bash',
        toolCallId: 'call-bash',
        status: 'running',
      }),
      message('ls-result', 'tool', 'src/\ntest/', { toolName: 'ls' }),
      message('bash-result', 'tool', '2 tests passed', {
        toolName: 'bash',
        toolCallId: 'call-bash',
        durationMs: 1250,
      }),
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
      durationMs: 1250,
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

  it('pairs concurrent calls by Pi tool call id instead of tool name order', () => {
    const entries = buildChatActivityEntries([
      message('bash-a-start', 'tool', '$ npm test', {
        toolName: 'bash',
        toolCallId: 'call-a',
        status: 'running',
      }),
      message('bash-b-start', 'tool', '$ npm run build', {
        toolName: 'bash',
        toolCallId: 'call-b',
        status: 'running',
      }),
      message('bash-b-result', 'tool', 'build ok', {
        toolName: 'bash',
        toolCallId: 'call-b',
      }),
      message('bash-a-result', 'tool', 'tests ok', {
        toolName: 'bash',
        toolCallId: 'call-a',
      }),
    ])

    expect(entries[0]?.request?.id).toBe('bash-a-start')
    expect(entries[0]?.result?.id).toBe('bash-a-result')
    expect(entries[1]?.request?.id).toBe('bash-b-start')
    expect(entries[1]?.result?.id).toBe('bash-b-result')
  })

  it('settles a sole compatible call when one bridge event lacks a call id', () => {
    const toolMessages = [
      message('bash-start', 'tool', '$ npm test', {
        toolName: 'bash',
        status: 'running',
      }),
      message('bash-result', 'tool', 'tests ok', {
        toolName: 'bash',
        toolCallId: 'call-bash',
      }),
    ]
    const entries = buildChatActivityEntries(toolMessages)

    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      request: { id: 'bash-start' },
      result: { id: 'bash-result' },
      running: false,
    })
  })
})

describe('applyCodingToolEvent', () => {
  it('completes an earlier running call without touching a later one', () => {
    const started = [
      applyCodingToolEvent([], {
        type: 'tool.started',
        text: '打开首页',
        toolName: 'mcp',
        toolCallId: 'call-a',
      }, () => 'start-a'),
    ].flat()
    const both = applyCodingToolEvent(started, {
      type: 'tool.started',
      text: '点击播放',
      toolName: 'mcp',
      toolCallId: 'call-b',
    }, () => 'start-b')
    const completed = applyCodingToolEvent(both, {
      type: 'tool.completed',
      text: '首页已打开',
      toolName: 'mcp',
      toolCallId: 'call-a',
      durationMs: 800,
    }, () => 'result-a')

    expect(completed.map(item => ({
      id: item.id,
      status: item.status,
      toolCallId: item.toolCallId,
    }))).toEqual([
      { id: 'start-a', status: 'done', toolCallId: 'call-a' },
      { id: 'start-b', status: 'running', toolCallId: 'call-b' },
      { id: 'result-a', status: 'done', toolCallId: 'call-a' },
    ])
    const entries = buildChatActivityEntries(completed)
    expect(entries[0]).toMatchObject({
      request: { id: 'start-a' },
      result: { id: 'result-a' },
      running: false,
    })
    expect(entries[1]).toMatchObject({
      request: { id: 'start-b' },
      running: true,
    })
  })

  it('settles a unique pending start when its completion supplies the missing call id', () => {
    const started = applyCodingToolEvent([], {
      type: 'tool.started',
      text: '$ npm test',
      toolName: 'bash',
    }, () => 'start')
    const completed = applyCodingToolEvent(started, {
      type: 'tool.completed',
      text: 'tests passed',
      toolName: 'bash',
      toolCallId: 'call-bash',
    }, () => 'result')

    expect(completed[0]).toMatchObject({
      id: 'start',
      status: 'done',
      toolCallId: 'call-bash',
    })
    expect(buildChatActivityEntries(completed)[0]).toMatchObject({
      request: { id: 'start' },
      result: { id: 'result' },
      running: false,
    })
  })

  it('does not settle a concurrent same-tool call when the completion has no identity', () => {
    const started = [
      ...applyCodingToolEvent([], {
        type: 'tool.started',
        text: '$ npm test',
        toolName: 'bash',
        toolCallId: 'call-a',
      }, () => 'start-a'),
      ...applyCodingToolEvent([], {
        type: 'tool.started',
        text: '$ npm run build',
        toolName: 'bash',
        toolCallId: 'call-b',
      }, () => 'start-b'),
    ]
    const completed = applyCodingToolEvent(started, {
      type: 'tool.completed',
      text: 'one result without an id',
      toolName: 'bash',
    }, () => 'result')

    expect(completed.slice(0, 2).map(item => item.status)).toEqual(['running', 'running'])
  })

  it('clears leftover running tool rows when the turn settles', () => {
    const settled = settleRunningToolMessages([
      message('start', 'tool', '打开首页', {
        toolName: 'mcp',
        toolCallId: 'call-a',
        status: 'running',
      }),
      message('approval', 'tool', '需要批准', {
        toolName: 'bash',
        approvalRequestId: 'approval-1',
        approvalState: 'pending',
        status: 'running',
      }),
    ])
    expect(settled[0]?.status).toBe('done')
    expect(settled[1]?.status).toBe('running')
    expect(settled[1]?.approvalRequestId).toBe('approval-1')
  })

  it('keeps a thinking-only assistant row visible', () => {
    const thinking = message('think', 'assistant', '', {
      thinking: 'read greet first',
      thinkingStatus: 'running',
      status: 'running',
    })
    expect(isBlankAssistantMessage(thinking)).toBe(false)
    expect(isBlankAssistantMessage(message('start', 'assistant', '', {
      thinkingStatus: 'running',
      status: 'running',
    }))).toBe(false)
    const next = applyAssistantThinkingEvent([], {
      type: 'assistant.thinking_delta',
      text: 'read greet first',
    }, () => 'id-1')
    expect(next[0]?.thinking).toBe('read greet first')
    expect(next[0]?.thinkingStatus).toBe('running')
    const done = applyAssistantThinkingEvent(next, {
      type: 'assistant.thinking_completed',
      text: 'read greet first',
      durationMs: 2400,
    })
    expect(done[0]?.thinkingStatus).toBe('done')
    expect(done[0]?.thinkingDurationMs).toBe(2400)
  })

  it('hides leftover read-only delivery status as a blank assistant shell', () => {
    expect(isBlankAssistantMessage(message(
      'stale',
      'assistant',
      '正在把只读研究结论写入工作区交付',
    ))).toBe(true)
    expect(isBlankAssistantMessage(message(
      'ok',
      'assistant',
      '已经写完报告。',
    ))).toBe(false)
  })

  it('also settles leftover running assistant shells when the turn is idle', () => {
    const settled = settleRunningToolMessages([
      message('a1', 'assistant', '还没说完', { status: 'running' }),
    ])
    expect(settled[0]?.status).toBe('done')
  })

  it('ignores bubbled details toggles from nested entries', () => {
    const parent = { open: true } as HTMLDetailsElement
    const child = { open: false } as HTMLDetailsElement
    expect(detailsToggleOpen({
      target: child,
      currentTarget: parent,
    } as unknown as Event)).toBeUndefined()
    expect(detailsToggleOpen({
      target: parent,
      currentTarget: parent,
    } as unknown as Event)).toBe(true)
  })

  it('hides finished tools unless the user expanded them', () => {
    const entries = buildChatActivityEntries([
      message('t1', 'tool', 'README.md', { toolName: 'read', toolCallId: 'c1', status: 'done' }),
      message('t1r', 'tool', 'ok', { toolName: 'read', toolCallId: 'c1', status: 'done' }),
      message('t2', 'tool', 'src', { toolName: 'read', toolCallId: 'c2', status: 'running' }),
    ])
    const hidden = visibleChatActivityEntries(entries, new Set())
    expect(hidden).toHaveLength(1)
    expect(hidden[0]?.running).toBe(true)
    const kept = visibleChatActivityEntries(entries, new Set([entries[0]!.id]))
    expect(kept).toHaveLength(2)
  })
})
