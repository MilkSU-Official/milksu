import { describe, expect, it } from 'vitest'
import { applyUiLocale } from './uiLocale'
import {
  buildCompanionDisplayRows,
  companionEntryIsProcessOnly,
  companionProcessSummary,
  companionThinkingLabel,
  companionTurnHasProcess,
  emptyCompanionTurnProcess,
  processFromCompanionEntry,
  resolveCompanionLiveStream,
  stampMeasuredThinkingDuration,
} from './companionTurnProcess'

describe('companionTurnProcess', () => {
  it('treats thinking and tools as process, not reply text', () => {
    expect(companionTurnHasProcess(emptyCompanionTurnProcess())).toBe(false)
    expect(companionTurnHasProcess({
      ...emptyCompanionTurnProcess(),
      reply: '你好',
    })).toBe(false)
    expect(companionTurnHasProcess({
      ...emptyCompanionTurnProcess(),
      components: [{ id: 'thinking', kind: 'thinking', title: '', detail: '先看板。', running: false }],
    })).toBe(true)
    expect(companionTurnHasProcess({
      ...emptyCompanionTurnProcess(),
      components: [{ id: '1', kind: 'tool', title: 'companion_board', detail: 'list', running: false }],
    })).toBe(true)
    expect(companionTurnHasProcess({
      ...emptyCompanionTurnProcess(),
      components: [{ id: 'decision:chat', kind: 'decision', title: '', detail: '决策：闲聊。由主模型判定。', running: false }],
    })).toBe(true)
  })

  it('marks thinking-only assistant entries as process-only', () => {
    expect(companionEntryIsProcessOnly({
      id: 'a1',
      type: 'message',
      timestamp: '2026-09-21T00:00:00.000Z',
      role: 'assistant',
      text: '',
      thinking: '先看板。',
    })).toBe(true)
    expect(companionEntryIsProcessOnly({
      id: 'a1b',
      type: 'message',
      timestamp: '2026-09-21T00:00:00.000Z',
      role: 'assistant',
      text: '',
      thinking: '先看板。',
      error: 'companion model returned no text',
    })).toBe(true)
    expect(companionEntryIsProcessOnly({
      id: 'a2',
      type: 'message',
      timestamp: '2026-09-21T00:00:00.000Z',
      role: 'assistant',
      text: '好的。',
      thinking: '先看板。',
    })).toBe(false)
    expect(processFromCompanionEntry({
      id: 'a3',
      type: 'message',
      timestamp: '2026-09-21T00:00:00.000Z',
      role: 'assistant',
      thinking: '先看板。',
      tools: ['companion_dispatch'],
      components: [{ kind: 'decision', detail: '决策：闲聊。由主模型判定。' }],
    }).components.map(component => component.kind === 'tool' ? component.title : component.kind)).toEqual([
      'decision',
      'thinking',
      'companion_dispatch',
    ])
  })

  it('shows thinking seconds from the previous transcript line', () => {
    applyUiLocale('zh')
    const rows = buildCompanionDisplayRows([
      {
        id: 'u1',
        type: 'message',
        timestamp: '2026-09-22T06:00:36.399Z',
        role: 'user',
        text: '在吗',
      },
      {
        id: 'a1',
        type: 'message',
        timestamp: '2026-09-22T06:00:48.399Z',
        role: 'assistant',
        thinking: '先看一眼。',
        text: '在。',
      },
    ])
    const process = rows.find(row => row.kind === 'process')
    expect(process?.kind === 'process' ? process.process.components.find(item => item.kind === 'thinking')?.durationMs : 0).toBe(12000)
    expect(process?.kind === 'process' ? companionProcessSummary(process.process) : '').toBe('想了 12.0s')
    applyUiLocale('en')
    expect(process?.kind === 'process' ? companionThinkingLabel(process.process) : '').toBe('Thought 12.0s')
    applyUiLocale('zh')
  })

  it('keeps one process summary for every assistant segment in the same turn', () => {
    applyUiLocale('zh')
    const rows = buildCompanionDisplayRows([
      {
        id: 'u1',
        type: 'message',
        timestamp: '2026-09-22T06:00:36.399Z',
        role: 'user',
        text: '在吗',
      },
      {
        id: 'a1',
        type: 'message',
        timestamp: '2026-09-22T06:00:40.399Z',
        role: 'assistant',
        thinking: '先看。',
        tools: ['companion_board'],
      },
      {
        id: 'a2',
        type: 'message',
        timestamp: '2026-09-22T06:00:48.399Z',
        role: 'assistant',
        thinking: '再答。',
        tools: ['companion_dispatch'],
        text: '在。',
      },
    ])
    const processes = rows.filter(row => row.kind === 'process')
    expect(processes).toHaveLength(1)
    expect(processes[0]?.kind === 'process' ? processes[0].process.components.filter(item => item.kind === 'tool').map(item => item.title) : []).toEqual([
      'companion_board',
      'companion_dispatch',
    ])
    expect(processes[0]?.kind === 'process' ? companionProcessSummary(processes[0].process) : '').toBe('想了 12.0s · 2 个工具')
    expect(rows.filter(row => row.kind === 'entry')).toHaveLength(2)
  })

  it('keeps the measured thinking duration when the transcript line matches', () => {
    const entries = stampMeasuredThinkingDuration([
      {
        id: 'a1',
        type: 'message',
        timestamp: '2026-09-22T06:00:48.399Z',
        role: 'assistant',
        thinking: '先看一眼。',
      },
    ], {
      ...emptyCompanionTurnProcess(),
      components: [{
        id: 'thinking',
        kind: 'thinking',
        title: '',
        detail: '先看一眼。',
        running: false,
        durationMs: 6400,
      }],
    })
    expect(entries[0]?.thinkingDurationMs).toBe(6400)
    expect(companionProcessSummary(processFromCompanionEntry(entries[0]!))).toBe('想了 6.4s')
  })

  it('drops a reviewed draft once the reply is in the transcript, and does not park it under the next question', () => {
    const user = {
      id: 'u1',
      type: 'message',
      timestamp: '2026-09-23T01:09:00.000Z',
      role: 'user',
      text: 'obelisk呢',
    }
    const streaming = resolveCompanionLiveStream([user], '有两个 obelisk，草稿。', {
      held: '',
      anchorUserId: '',
    })
    expect(streaming.text).toBe('有两个 obelisk，草稿。')
    expect(streaming.anchorUserId).toBe('u1')
    const landed = resolveCompanionLiveStream([
      user,
      {
        id: 'a1',
        type: 'message',
        timestamp: '2026-09-23T01:09:20.000Z',
        role: 'assistant',
        text: '有两个 obelisk，不是一个。',
      },
    ], '', streaming)
    expect(landed.text).toBe('')
    const next = resolveCompanionLiveStream([
      user,
      {
        id: 'a1',
        type: 'message',
        timestamp: '2026-09-23T01:09:20.000Z',
        role: 'assistant',
        text: '有两个 obelisk，不是一个。',
      },
      {
        id: 'u2',
        type: 'message',
        timestamp: '2026-09-23T01:10:00.000Z',
        role: 'user',
        text: '再看一眼',
      },
    ], '', streaming)
    expect(next.text).toBe('')
    const waiting = resolveCompanionLiveStream([user], '', streaming)
    expect(waiting.text).toBe('有两个 obelisk，草稿。')
  })

  it('keeps an intent component in the fold when the turn has no tools', () => {
    const rows = buildCompanionDisplayRows([
      {
        id: 'u1',
        type: 'message',
        timestamp: '2026-09-25T00:00:00.000Z',
        role: 'user',
        text: '今天过得怎么样',
      },
      {
        id: 'a1',
        type: 'message',
        timestamp: '2026-09-25T00:00:02.000Z',
        role: 'assistant',
        text: '还不错。',
        components: [{ kind: 'decision', detail: '决策：闲聊。由主模型判定。' }],
      },
    ])
    const process = rows.find(row => row.kind === 'process')
    expect(process?.kind === 'process' ? process.process.components.map(item => item.detail) : []).toEqual([
      '决策：闲聊。由主模型判定。',
    ])
    expect(rows.filter(row => row.kind === 'entry').map(row => row.kind === 'entry' ? row.entry.text : '')).toEqual([
      '今天过得怎么样',
      '还不错。',
    ])
  })

  it('puts the memory record after tools', () => {
    const rows = buildCompanionDisplayRows([
      {
        id: 'u1',
        type: 'message',
        timestamp: '2026-09-25T00:00:00.000Z',
        role: 'user',
        text: '以后叫我 Milk',
      },
      {
        id: 'a1',
        type: 'message',
        timestamp: '2026-09-25T00:00:02.000Z',
        role: 'assistant',
        text: '好。',
        tools: ['bash'],
        components: [
          { kind: 'decision', detail: '决策：闲聊。由主模型判定。' },
          { kind: 'memory', detail: '记忆：记下了称呼。' },
        ],
      },
    ])
    const process = rows.find(row => row.kind === 'process')
    expect(process?.kind === 'process' ? process.process.components.map(item => item.kind === 'tool' ? item.title : item.detail) : []).toEqual([
      '决策：闲聊。由主模型判定。',
      'bash',
      '记忆：记下了称呼。',
    ])
  })
})
