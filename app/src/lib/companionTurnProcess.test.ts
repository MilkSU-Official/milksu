import { describe, expect, it } from 'vitest'
import {
  companionEntryIsProcessOnly,
  companionTurnHasProcess,
  emptyCompanionTurnProcess,
  processFromCompanionEntry,
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
})
