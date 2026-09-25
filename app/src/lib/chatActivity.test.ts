import { describe, expect, it } from 'vitest'
import {
  applyAssistantThinkingEvent,
  applyCodingToolEvent,
  settleLiveThinking,
  buildChatActivityEntries,
  visibleChatActivityEntries,
  buildChatTranscript,
  chatTranscriptBlockMemoRefs,
  detailsToggleOpen,
  hasEmptyVisibleReply,
  latestFinishedThinkingId,
  isBlankAssistantMessage,
  retainAssistantAfterEmptyCompletion,
  thinkingStaysOpen,
  processFoldStepCount,
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
  it('keeps staged assistant text in the open thread and folds finished tools', () => {
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
      'process',
      'message',
      'process',
      'message',
    ])
    expect(transcript[1]?.kind === 'message' && transcript[1].message.id).toBe('a1')
    expect(transcript[2]?.kind === 'process' && transcript[2].blocks.map(item => item.kind))
      .toEqual(['activity'])
    expect(transcript[3]?.kind === 'message' && transcript[3].message.id).toBe('a2')
    expect(transcript[5]?.kind === 'message' && transcript[5].message.id).toBe('a3')
  })

  it('keeps only live thinking and a running tool group in the open thread', () => {
    const transcript = buildChatTranscript([
      message('u1', 'user', '完成任务'),
      message('a1', 'assistant', '', { thinking: '先看仓库。', thinkingStatus: 'running', status: 'running' }),
      message('t1', 'tool', '/repo', { toolName: 'read', status: 'running' }),
    ], true)

    expect(transcript.map(block => block.kind)).toEqual([
      'message',
      'message',
      'activity',
    ])
  })

  it('folds finished thinking into the process overview around tool work', () => {
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
      message('t1', 'tool', '/repo', { toolName: 'read' }),
      message('t2', 'tool', 'npm test', { toolName: 'bash' }),
      message('a3', 'assistant', '', {
        thinking: '还在想。',
        thinkingStatus: 'running',
        status: 'running',
      }),
    ], true)

    expect(transcript.map(block => block.kind)).toEqual([
      'message',
      'process',
      'message',
    ])
    expect(transcript[1]?.kind === 'process' && transcript[1].blocks.map(item => item.kind))
      .toEqual(['message', 'message', 'activity'])
    expect(transcript[1]?.kind === 'process' && transcript[1].blocks[0]?.kind === 'message'
      && transcript[1].blocks[0].message).toMatchObject({
      id: 'a1',
      thinking: '先看仓库。',
      thinkingDurationMs: 800,
    })
    expect(transcript[1]?.kind === 'process' && transcript[1].blocks[1]?.kind === 'message'
      && transcript[1].blocks[1].message).toMatchObject({
      id: 'a2',
      thinking: '再跑测试。',
      thinkingDurationMs: 500,
    })
    expect(transcript[2]?.kind === 'message' && transcript[2].message.id).toBe('a3')
    expect(transcript[1]?.kind === 'process' && processFoldStepCount(transcript[1].blocks)).toBe(2)
  })

  it('collapses a work stretch without body text into one process fold', () => {
    const transcript = buildChatTranscript([
      message('u1', 'user', '排查问题'),
      message('t1', 'tool', '/repo', { toolName: 'read' }),
      message('a1', 'assistant', '', {
        thinking: '再看测试。',
        thinkingStatus: 'done',
        thinkingDurationMs: 900,
      }),
      message('t2', 'tool', 'npm test', { toolName: 'bash' }),
      message('a2', 'assistant', '', {
        thinking: '还在想。',
        thinkingStatus: 'done',
        thinkingDurationMs: 2500,
      }),
      message('t3', 'tool', 'src/app.ts', { toolName: 'grep' }),
      message('a3', 'assistant', '查完了。'),
    ], false)

    expect(transcript.map(block => block.kind)).toEqual(['message', 'process', 'message'])
    expect(transcript[1]?.kind === 'process' && transcript[1].blocks.map(item => item.kind))
      .toEqual(['activity', 'message', 'activity', 'message', 'activity'])
  })

  it('keeps each finished thinking row when no tools have started', () => {
    const transcript = buildChatTranscript([
      message('u1', 'user', '完成任务'),
      message('a1', 'assistant', '', {
        thinking: '先看仓库。',
        thinkingStatus: 'done',
        thinkingDurationMs: 800,
      }),
      message('a2', 'assistant', '', {
        thinking: '再看测试。',
        thinkingStatus: 'done',
        thinkingDurationMs: 400,
      }),
    ], true)

    expect(transcript.map(block => block.kind)).toEqual(['message', 'message', 'message'])
    expect(transcript[1]?.kind === 'message' && transcript[1].message).toMatchObject({
      id: 'a1',
      thinking: '先看仓库。',
      thinkingDurationMs: 800,
    })
    expect(transcript[2]?.kind === 'message' && transcript[2].message).toMatchObject({
      id: 'a2',
      thinking: '再看测试。',
      thinkingDurationMs: 400,
    })
  })

  it('keeps only the latest open-thread thinking row expanded', () => {
    const transcript = buildChatTranscript([
      message('u1', 'user', '完成任务'),
      message('a1', 'assistant', '', {
        thinking: '先看仓库。',
        thinkingStatus: 'done',
      }),
      message('a2', 'assistant', '', {
        thinking: '再看测试。',
        thinkingStatus: 'done',
      }),
      message('a3', 'assistant', '', {
        thinking: '还在想。',
        thinkingStatus: 'running',
        status: 'running',
      }),
    ], true)

    expect(thinkingStaysOpen('a1', transcript)).toBe(false)
    expect(thinkingStaysOpen('a2', transcript)).toBe(true)
    expect(thinkingStaysOpen('a3', transcript)).toBe(true)
    expect(latestFinishedThinkingId(transcript)).toBe('a2')
  })

  it('groups consecutive tools beneath one process disclosure', () => {
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
      'process',
      'message',
    ])
    expect(transcript[2]?.kind === 'process' && transcript[2].blocks.map(item => item.kind))
      .toEqual(['activity'])
    expect(transcript[2]?.kind === 'process' && transcript[2].blocks[0]?.kind === 'activity'
      && transcript[2].blocks[0].messages.map(item => item.id)).toEqual(['t1', 't2'])
    expect(transcript[1]?.kind === 'message' && transcript[1].message.id).toBe('a1')
    expect(transcript[3]?.kind === 'message' && transcript[3].message.id).toBe('a2')
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
    expect(transcript[0]?.kind === 'process' && transcript[0].blocks[0]?.kind === 'activity'
      && transcript[0].blocks[0].running).toBe(false)
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
    expect(transcript[0]?.kind === 'process' && transcript[0].blocks[0]?.kind === 'activity'
      && transcript[0].blocks[0].messages.map(item => item.id)).toEqual(['t1', 't2'])
  })

  it('keeps a live assistant response visible after collapsed activity', () => {
    const transcript = buildChatTranscript([
      message('u1', 'user', '完成任务'),
      message('a1', 'assistant', '先运行测试。'),
      message('t1', 'tool', 'npm test', { toolName: 'bash' }),
      message('a2', 'assistant', '测试完成，正在整理结果。', { status: 'running' }),
    ], true)

    expect(transcript.map(block => block.kind)).toEqual(['message', 'message', 'process', 'message'])
    expect(transcript[1]?.kind === 'message' && transcript[1].message.id).toBe('a1')
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

  it('keeps a blocking milksu_ask card in the open thread and hides its tool chip', () => {
    const transcript = buildChatTranscript([
      message('u1', 'user', '给我几个选项'),
      message('ask-start', 'tool', 'How many flavors should we launch?', {
        toolName: 'milksu_ask',
        toolCallId: 'call-ask',
        status: 'running',
      }),
      message('ask', 'tool', 'How many flavors should we launch?', {
        toolName: 'milksu_ask',
        toolCallId: 'call-ask',
        approvalRequestId: 'ask-1',
        approvalState: 'pending',
        approvalInput: JSON.stringify({
          options: [
            { id: 'three', label: 'Three' },
            { id: 'five', label: 'Five' },
          ],
        }),
      }),
    ], true)

    expect(transcript.map(block => block.kind)).toEqual(['message', 'message'])
    expect(transcript[1]?.kind === 'message' && transcript[1].message.approvalRequestId)
      .toBe('ask-1')
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
  it('pairs an ImageGen start and result into one delivered row', () => {
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
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      toolName: 'milksu_imagegen',
      request: { id: 'image-start' },
      result: { id: 'image-result' },
      running: false,
    })
  })

  it('shows a generated image in the thread and drops the delivery note', () => {
    const receipt = [
      '已生成完成。',
      '• 文件： /Users/example/milk-cat.png',
      '• 模型： openai-image/gpt-image-2',
      '• 规格： PNG, 1254×1254, 2,091,405 字节',
      '• SHA-256： 5040047063855dec7c41620279e5a8f34b5dc4651c02c697893e5f7d958f881e',
      '工作区内是新建的 .png ，未覆盖任何已有文件，也未改动代码。',
    ].join('\n')
    const transcript = buildChatTranscript([
      message('u1', 'user', '画个牛奶猫'),
      message('image-result', 'tool', JSON.stringify({
        status: 'completed',
        output: { path: 'milk-cat.png' },
      }), { toolName: 'milksu_imagegen' }),
      message('a1', 'assistant', receipt),
    ], false)
    expect(transcript.some(block => block.kind === 'image' && block.path === 'milk-cat.png')).toBe(true)
    expect(transcript.some(block => block.kind === 'message' && block.message.content.includes('SHA-256'))).toBe(false)
    expect(transcript.some(block => block.kind === 'message' && block.message.role === 'assistant')).toBe(false)
  })

  it('keeps a real caption under the image and leaves text-only replies alone', () => {
    const withCaption = buildChatTranscript([
      message('u1', 'user', '画个小猫'),
      message('image-result', 'tool', JSON.stringify({
        status: 'completed',
        output: { path: 'cat.png' },
      }), { toolName: 'milksu_imagegen' }),
      message('a1', 'assistant', '猫戴着一顶牛奶帽。'),
    ], false)
    const caption = withCaption.find(block => block.kind === 'message' && block.message.role === 'assistant')
    expect(caption && caption.kind === 'message' && caption.message.content).toBe('猫戴着一顶牛奶帽。')

    const textOnly = buildChatTranscript([
      message('u1', 'user', '这是什么'),
      message('a1', 'assistant', '这是一只猫。'),
    ], false)
    expect(textOnly.some(block => block.kind === 'image')).toBe(false)
    expect(textOnly.some(block => block.kind === 'message' && block.message.content === '这是一只猫。')).toBe(true)
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

  it('keeps a thinking-only row after an empty completion and flags an empty visible reply', () => {
    const thinking = message('think', 'assistant', '', {
      thinking: '完整中文答复',
      thinkingStatus: 'running',
      status: 'running',
    })
    const retained = retainAssistantAfterEmptyCompletion(thinking)
    expect(retained?.status).toBe('done')
    expect(retained?.thinking).toBe('完整中文答复')
    expect(retainAssistantAfterEmptyCompletion(message('blank', 'assistant', '', {
      status: 'running',
    }))).toBeNull()
    expect(hasEmptyVisibleReply([
      message('u1', 'user', '下一步做什么'),
      retained!,
    ], false)).toBe(true)
    expect(hasEmptyVisibleReply([
      message('u1', 'user', '下一步做什么'),
      retained!,
      message('a2', 'assistant', '先打开设置。'),
    ], false)).toBe(false)
    expect(hasEmptyVisibleReply([
      message('u1', 'user', '下一步做什么'),
      retained!,
    ], true)).toBe(false)
    expect(hasEmptyVisibleReply([
      message('u1', 'user', '画个小猫'),
      message('image-result', 'tool', JSON.stringify({
        status: 'completed',
        output: { path: 'cat.png' },
      }), { toolName: 'milksu_imagegen' }),
    ], false)).toBe(false)
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

  it('closes live thinking when a tool starts', () => {
    const thinking = message('think', 'assistant', '', {
      thinking: '先看图片。',
      thinkingStatus: 'running',
      status: 'running',
      timestamp: 1_000,
    })
    const next = applyCodingToolEvent([thinking], {
      type: 'tool.started',
      text: 'read image',
      toolName: 'read',
      toolCallId: 'call-read',
    }, () => 'tool-1')
    expect(next[0]?.thinkingStatus).toBe('done')
    expect(next[0]?.thinkingDurationMs).toBeGreaterThanOrEqual(0)
    expect(next[1]?.role).toBe('tool')
  })

  it('does not rewrite settled thinking', () => {
    const settled = message('think', 'assistant', '', {
      thinking: 'done',
      thinkingStatus: 'done',
      thinkingDurationMs: 800,
      status: 'running',
    })
    expect(settleLiveThinking([settled])[0]).toBe(settled)
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

function sameMemoRefs(first: unknown[], second: unknown[]) {
  return first.length === second.length
    && first.every((value, index) => value === second[index])
}

describe('chatTranscriptBlockMemoRefs', () => {
  it('keeps a message block memoized while its message reference is unchanged', () => {
    const user = message('u1', 'user', 'hi')
    const before = chatTranscriptBlockMemoRefs(
      { kind: 'message', id: 'message:u1', message: user },
      'shared',
    )
    const again = chatTranscriptBlockMemoRefs(
      { kind: 'message', id: 'message:u1', message: user },
      'shared',
    )
    expect(sameMemoRefs(before, again)).toBe(true)

    const streamed = { ...user, content: 'hi there' }
    const changed = chatTranscriptBlockMemoRefs(
      { kind: 'message', id: 'message:u1', message: streamed },
      'shared',
    )
    expect(sameMemoRefs(before, changed)).toBe(false)

    const sharedChanged = chatTranscriptBlockMemoRefs(
      { kind: 'message', id: 'message:u1', message: user },
      'shared-2',
    )
    expect(sameMemoRefs(before, sharedChanged)).toBe(false)
  })

  it('ignores rebuilt activity arrays but notices a replaced tool message', () => {
    const read = message('t1', 'tool', 'README.md', { toolName: 'read', toolCallId: 'c1' })
    const before = chatTranscriptBlockMemoRefs(
      { kind: 'activity', id: 'activity:t1', messages: [read], running: false },
      'shared',
    )
    // buildChatTranscript rebuilds this array on every delta while the tool
    // message object itself stays put.
    const rebuilt = chatTranscriptBlockMemoRefs(
      { kind: 'activity', id: 'activity:t1', messages: [...[read]], running: false },
      'shared',
    )
    expect(sameMemoRefs(before, rebuilt)).toBe(true)

    const completed = { ...read, status: 'done' as const }
    const changed = chatTranscriptBlockMemoRefs(
      { kind: 'activity', id: 'activity:t1', messages: [completed], running: false },
      'shared',
    )
    expect(sameMemoRefs(before, changed)).toBe(false)
  })

  it('keeps a process block memoized until one of its inner messages changes', () => {
    const first = message('a1', 'assistant', '先读仓库。')
    const tool = message('t1', 'tool', '/repo', { toolName: 'read', toolCallId: 'c1' })
    const fold = (blocks: Parameters<typeof chatTranscriptBlockMemoRefs>[0]) => (
      chatTranscriptBlockMemoRefs(blocks, 'shared')
    )
    const before = fold({
      kind: 'process',
      id: 'process:a1',
      blocks: [
        { kind: 'message', id: 'message:a1', message: first },
        { kind: 'activity', id: 'activity:t1', messages: [tool], running: false },
      ],
    })
    const rebuilt = fold({
      kind: 'process',
      id: 'process:a1',
      blocks: [
        { kind: 'message', id: 'message:a1', message: first },
        { kind: 'activity', id: 'activity:t1', messages: [...[tool]], running: false },
      ],
    })
    expect(sameMemoRefs(before, rebuilt)).toBe(true)

    const appended = fold({
      kind: 'process',
      id: 'process:a1',
      blocks: [
        { kind: 'message', id: 'message:a1', message: first },
        { kind: 'activity', id: 'activity:t1', messages: [tool], running: false },
        { kind: 'message', id: 'message:a2', message: message('a2', 'assistant', '继续。') },
      ],
    })
    expect(sameMemoRefs(before, appended)).toBe(false)
  })
})
