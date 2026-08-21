import { describe, expect, it } from 'vitest'
import {
  applySessionCompacting,
  applySessionContextWindow,
  applySessionRunFinished,
  applySessionRunStarted,
  applySessionUsageAfterCompaction,
  applySessionUsageRecorded,
  emptySessionTurnSnapshot,
  formatElapsedMs,
  formatTokenCount,
  presentContextUsage,
  presentRunTiming,
} from '@/lib/sessionTurnStatus'

describe('sessionTurnStatus', () => {
  it('records last usage and presents a composer strip', () => {
    let state = emptySessionTurnSnapshot()
    state = applySessionContextWindow(state, 128_000)
    state = applySessionUsageRecorded(state, {
      inputTokens: 10_200,
      outputTokens: 1800,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 12_000,
      model: 'grok-4.5',
    }, 1000)
    const presented = presentContextUsage(state)
    expect(presented?.inputLabel).toBe('10k')
    expect(presented?.outputLabel).toBe('1.8k')
    expect(presented?.windowLabel).toBe('128k')
    expect(presented?.ioLabel).toBe('↑10k ↓1.8k')
    expect(presented?.strip).toBe('↑10k ↓1.8k · 10k/128k')
    expect(presented?.percent).toBe(8)
    expect(presented?.nearLimit).toBe(false)
    expect(presented?.compacting).toBe(false)
  })

  it('marks near-limit when prompt fills most of the window', () => {
    let state = emptySessionTurnSnapshot()
    state = applySessionContextWindow(state, 100_000)
    state = applySessionUsageRecorded(state, {
      inputTokens: 90_000,
      outputTokens: 100,
      totalTokens: 90_100,
    })
    expect(presentContextUsage(state)?.nearLimit).toBe(true)
    expect(presentContextUsage(state)?.percent).toBe(90)
  })

  it('appends compacting to the strip', () => {
    let state = applySessionUsageRecorded(emptySessionTurnSnapshot(), {
      inputTokens: 1000,
      outputTokens: 10,
      totalTokens: 1010,
    })
    state = applySessionCompacting(state, true)
    expect(presentContextUsage(state)?.strip).toContain('整理中')
    expect(presentContextUsage(state)?.compacting).toBe(true)
  })

  it('replaces last-prompt occupancy with the compacted estimate', () => {
    let state = applySessionContextWindow(emptySessionTurnSnapshot(), 100_000)
    state = applySessionUsageRecorded(state, {
      inputTokens: 90_000,
      outputTokens: 1200,
      cacheReadTokens: 0,
      totalTokens: 91_200,
    }, 1000)
    state = applySessionUsageAfterCompaction(state, 12_000, 2000)
    const presented = presentContextUsage(state)
    expect(presented?.percent).toBe(12)
    expect(presented?.inputLabel).toBe('12k')
    expect(presented?.outputLabel).toBe('0')
    expect(presented?.nearLimit).toBe(false)
  })

  it('shows compacting even before the first usage record', () => {
    const state = applySessionCompacting(emptySessionTurnSnapshot(), true)
    expect(presentContextUsage(state)?.compacting).toBe(true)
    expect(presentContextUsage(state)?.strip).toBe('整理中')
  })

  it('tracks run wall-clock timing and keeps last elapsed after finish', () => {
    let state = applySessionRunStarted(emptySessionTurnSnapshot(), 1000)
    expect(presentRunTiming(state, 1000 + 65_000)).toEqual({ label: '1:05', running: true })
    state = applySessionRunFinished(state, 1000 + 65_000)
    expect(presentRunTiming(state, 9999)).toEqual({ label: '1:05', running: false })
  })

  it('formats token and elapsed helpers', () => {
    expect(formatTokenCount(999)).toBe('999')
    expect(formatTokenCount(1500)).toBe('1.5k')
    expect(formatTokenCount(12_400)).toBe('12k')
    expect(formatElapsedMs(0)).toBe('0:00')
    expect(formatElapsedMs(3_600_000 + 5_000)).toBe('1:00:05')
  })
})
