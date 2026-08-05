import { describe, expect, it } from 'vitest'
import {
  applyCodingContinuityEvent,
  codingCompactionErrorMessage,
  createCodingContinuityState,
  removeCodingContinuitySession,
} from '@/codingContinuity'

describe('Coding runtime continuity state', () => {
  it('lands session.ready resumed in the UI state only when Pi says so', () => {
    let state = createCodingContinuityState()
    state = applyCodingContinuityEvent(state, 'conversation-1', {
      type: 'session.ready',
      resumed: true,
    })
    expect(state.ready.has('conversation-1')).toBe(true)
    expect(state.resumed.has('conversation-1')).toBe(true)

    state = applyCodingContinuityEvent(state, 'conversation-1', {
      type: 'session.ready',
      resumed: false,
    })
    expect(state.resumed.has('conversation-1')).toBe(false)
  })

  it('never claims a resumed session without a fresh session.ready', () => {
    const state = createCodingContinuityState()
    expect(state.ready.size).toBe(0)
    expect(state.resumed.size).toBe(0)
    expect(
      applyCodingContinuityEvent(
        state,
        'other',
        { type: 'assistant.delta' },
      ),
    ).toBe(state)
  })

  it('marks a session as compacting on compaction start', () => {
    const state = applyCodingContinuityEvent(
      createCodingContinuityState(),
      'conversation-1',
      { type: 'runtime.compaction_started' },
    )
    expect(state.compacting.has('conversation-1')).toBe(true)
  })

  it('records a successful compaction and clears prior errors', () => {
    let state = applyCodingContinuityEvent(
      createCodingContinuityState(),
      'conversation-1',
      { type: 'runtime.compaction_completed', error: 'old failure' },
    )
    expect(state.compactedAt.has('conversation-1')).toBe(false)
    state = applyCodingContinuityEvent(
      state,
      'conversation-1',
      { type: 'runtime.compaction_started' },
    )
    state = applyCodingContinuityEvent(
      state,
      'conversation-1',
      { type: 'runtime.compaction_completed' },
    )
    expect(state.compacting.has('conversation-1')).toBe(false)
    expect(state.compactedAt.get('conversation-1')).toBeGreaterThan(0)
    expect(state.errors.has('conversation-1')).toBe(false)
  })

  it('does not write a success state when compaction fails', () => {
    const state = applyCodingContinuityEvent(
      createCodingContinuityState(),
      'conversation-1',
      {
        type: 'runtime.compaction_completed',
        error: 'Error: Nothing to compact (session too small)\n  at stack',
      },
    )
    expect(state.compacting.has('conversation-1')).toBe(false)
    expect(state.compactedAt.has('conversation-1')).toBe(false)
    expect(state.errors.get('conversation-1')).toBe(
      'Nothing to compact (session too small)',
    )
    const aborted = applyCodingContinuityEvent(
      createCodingContinuityState(),
      'conversation-2',
      { type: 'runtime.compaction_completed', aborted: true },
    )
    expect(aborted.compactedAt.has('conversation-2')).toBe(false)
    expect(aborted.errors.get('conversation-2')).toContain('cancelled')
  })

  it('bounds compaction errors to a single short line', () => {
    const state = applyCodingContinuityEvent(
      createCodingContinuityState(),
      'conversation-1',
      {
        type: 'runtime.compaction_completed',
        error: `${'x'.repeat(400)}\nsecond line`,
      },
    )
    const message = state.errors.get('conversation-1') ?? ''
    expect(message.length).toBe(320)
    expect(message.includes('\n')).toBe(false)
  })

  it('keeps continuity state per conversation and removes deleted tasks', () => {
    let state = applyCodingContinuityEvent(
      createCodingContinuityState(),
      'conversation-a',
      { type: 'session.ready', resumed: true },
    )
    state = applyCodingContinuityEvent(
      state,
      'conversation-a',
      { type: 'runtime.compaction_started' },
    )
    state = applyCodingContinuityEvent(
      state,
      'conversation-a',
      { type: 'runtime.compaction_completed', error: 'old compaction failure' },
    )
    state = applyCodingContinuityEvent(
      state,
      'conversation-b',
      { type: 'session.ready', resumed: false },
    )
    expect(state.resumed.has('conversation-a')).toBe(true)
    expect(state.resumed.has('conversation-b')).toBe(false)
    state = removeCodingContinuitySession(state, 'conversation-a')
    expect(state.ready.has('conversation-a')).toBe(false)
    expect(state.resumed.has('conversation-a')).toBe(false)
    expect(state.compacting.has('conversation-a')).toBe(false)
    expect(state.compactedAt.has('conversation-a')).toBe(false)
    expect(state.errors.has('conversation-a')).toBe(false)
    expect(state.ready.has('conversation-b')).toBe(true)
  })

  it('translates compaction failures without leaking a stack trace', () => {
    expect(codingCompactionErrorMessage(
      new Error('PI session not found: conversation-1'),
    )).toContain('还没有可整理的 Pi 会话')
    expect(codingCompactionErrorMessage(
      new Error('Nothing to compact (session too small)'),
    )).toContain('没有可压缩的内容')
  })
})
