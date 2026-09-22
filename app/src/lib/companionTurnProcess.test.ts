import { describe, expect, it } from 'vitest'
import { applyUiLocale } from './uiLocale'
import {
  buildCompanionDisplayRows,
  companionEntryIsProcessOnly,
  companionLiveActivity,
  companionLiveSummary,
  companionProcessSummary,
  companionThinkingLabel,
  finishCompanionTurn,
  companionTurnHasProcess,
  emptyCompanionTurnProcess,
  processFromCompanionEntry,
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
      thinking: '先看板。',
    })).toBe(true)
    expect(companionTurnHasProcess({
      ...emptyCompanionTurnProcess(),
      tools: [{ id: '1', name: 'companion_board', detail: 'list', running: false }],
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
    }).tools.map(tool => tool.name)).toEqual(['companion_dispatch'])
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
    expect(process?.kind === 'process' ? process.process.thinkingDurationMs : 0).toBe(12000)
    expect(process?.kind === 'process' ? companionProcessSummary(process.process) : '').toBe('想了 12.0s')
    applyUiLocale('en')
    expect(process?.kind === 'process' ? companionThinkingLabel(process.process) : '').toBe('Thought 12.0s')
    applyUiLocale('zh')
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
      thinking: '先看一眼。',
      thinkingDurationMs: 6400,
    })
    expect(entries[0]?.thinkingDurationMs).toBe(6400)
    expect(companionProcessSummary(processFromCompanionEntry(entries[0]!))).toBe('想了 6.4s')
  })

  it('folds tools into the same summary line as thinking', () => {
    applyUiLocale('zh')
    expect(companionProcessSummary({
      ...emptyCompanionTurnProcess(),
      thinking: '先看一眼。',
      thinkingDurationMs: 1200,
      tools: [
        { id: '1', name: 'read', detail: 'read', running: false },
        { id: '2', name: 'bash', detail: 'bash', running: false },
      ],
    })).toBe('想了 1.2s · 2 次工具调用')
    applyUiLocale('en')
    expect(companionProcessSummary({
      ...emptyCompanionTurnProcess(),
      tools: [{ id: '1', name: 'read', detail: 'read', running: false }],
    })).toBe('1 tool call')
    applyUiLocale('zh')
  })

  it('keeps the live clock on the whole turn and names the current activity', () => {
    applyUiLocale('zh')
    const process = {
      ...emptyCompanionTurnProcess(),
      thinking: '先看一眼。',
      thinkingDurationMs: 900,
      turnStartedAt: 10_000,
      tools: [
        { id: '1', name: 'read', detail: 'read', running: false },
        { id: '2', name: 'bash', detail: 'bash', running: true },
      ],
    }
    expect(companionLiveActivity(process)).toBe('正在等命令')
    expect(companionLiveSummary(process, 12_400)).toEqual({
      activity: '正在等命令',
      elapsed: '2.4s',
      tools: '2 次工具调用',
    })
    expect(companionLiveActivity({
      ...emptyCompanionTurnProcess(),
      tools: [{ id: 'd', name: 'companion_dispatch', detail: 'speak', running: true }],
    })).toBe('正在等对话')
    expect(companionLiveActivity({
      ...emptyCompanionTurnProcess(),
      thinkingRunning: true,
    })).toBe('正在思考')
    expect(companionLiveActivity({
      ...emptyCompanionTurnProcess(),
      reply: '好。',
    })).toBe('正在回复')
    applyUiLocale('en')
    expect(companionLiveActivity({
      ...process,
      tools: [{ id: '2', name: 'bash', detail: 'bash', running: true }],
    })).toBe('Waiting for the command')
    expect(finishCompanionTurn(process, 14_200).thinkingDurationMs).toBe(4200)
    applyUiLocale('zh')
  })
})
