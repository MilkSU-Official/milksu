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
})
