import { describe, expect, it } from 'vitest'
import {
  applySessionCompacting,
  applySessionContextComposition,
  applySessionContextWindow,
  applySessionRunFinished,
  applySessionRunStarted,
  applySessionUsageAfterCompaction,
  applySessionUsageRecorded,
  emptySessionTurnSnapshot,
  formatCompositionTokenCount,
  formatElapsedMs,
  formatHitRate,
  formatTokenCount,
  contextOccupancyShares,
  presentContextUsage,
  presentRunTiming,
  readContextCompositionFromEvent,
  snapshotFromStoredContextUsage,
  storedContextUsageFromSnapshot,
} from '@/lib/sessionTurnStatus'
import { applyUiLocale } from '@/lib/uiLocale'

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

  it('round-trips last occupancy so reopen shows the ring immediately', () => {
    const snapshot = snapshotFromStoredContextUsage({
      inputTokens: 12_000,
      outputTokens: 800,
      cacheReadTokens: 2_000,
      cacheWriteTokens: 0,
      totalTokens: 14_800,
      contextWindow: 500_000,
      model: 'grok-4.6',
      recordedAt: 42,
    })
    expect(presentContextUsage(snapshot)?.percent).toBe(3)
    expect(presentContextUsage(snapshot)?.windowLabel).toBe('500k')
    expect(storedContextUsageFromSnapshot(snapshot)).toMatchObject({
      inputTokens: 12_000,
      cacheReadTokens: 2_000,
      contextWindow: 500_000,
      model: 'grok-4.6',
      recordedAt: 42,
    })
  })

  it('formats token and elapsed helpers', () => {
    expect(formatTokenCount(999)).toBe('999')
    expect(formatTokenCount(1500)).toBe('1.5k')
    expect(formatTokenCount(12_400)).toBe('12k')
    expect(formatElapsedMs(0)).toBe('0:00')
    expect(formatElapsedMs(3_600_000 + 5_000)).toBe('1:00:05')
  })

  it('breaks down last-call cache hits without folding them into uncached input', () => {
    let state = applySessionContextWindow(emptySessionTurnSnapshot(), 128_000)
    state = applySessionUsageRecorded(state, {
      inputTokens: 120,
      outputTokens: 40,
      cacheReadTokens: 80,
      cacheWriteTokens: 10,
      reasoningTokens: 15,
      totalTokens: 250,
      recordId: 'usage-1',
    })
    const presented = presentContextUsage(state)
    expect(presented?.last).toMatchObject({
      uncachedLabel: '120',
      cacheReadLabel: '80',
      cacheWriteLabel: '10',
      outputLabel: '40',
      reasoningLabel: '15',
      hitRateLabel: '40%',
    })
    expect(presented?.session).toBeUndefined()
    expect(formatHitRate(0, 200)).toBe('0%')
    expect(formatHitRate(1, 200)).toBe('0.5%')
  })

  it('accumulates session totals and ignores duplicate usage ids', () => {
    let state = emptySessionTurnSnapshot()
    state = applySessionUsageRecorded(state, {
      inputTokens: 100,
      outputTokens: 10,
      cacheReadTokens: 0,
      cacheWriteTokens: 20,
      totalTokens: 130,
      recordId: 'usage-a',
    }, 1)
    state = applySessionUsageRecorded(state, {
      inputTokens: 50,
      outputTokens: 20,
      cacheReadTokens: 150,
      cacheWriteTokens: 0,
      totalTokens: 220,
      recordId: 'usage-a',
    }, 2)
    expect(state.session?.turns).toBe(1)
    state = applySessionUsageRecorded(state, {
      inputTokens: 50,
      outputTokens: 20,
      cacheReadTokens: 150,
      cacheWriteTokens: 0,
      reasoningTokens: 8,
      totalTokens: 228,
      recordId: 'usage-b',
    }, 3)
    expect(state.session?.turns).toBe(2)
    expect(state.session?.cacheReadTokens).toBe(150)
    expect(presentContextUsage(state)?.session).toMatchObject({
      uncachedLabel: '150',
      cacheReadLabel: '150',
      hitRateLabel: '50%',
      turns: 2,
    })
  })

  it('splits occupancy into uncached and cache-read shares that sum to percent', () => {
    expect(contextOccupancyShares(12_000, 8_000, 100_000)).toEqual({
      percent: 20,
      uncachedPercent: 12,
      cachePercent: 8,
    })
    let state = applySessionContextWindow(emptySessionTurnSnapshot(), 100_000)
    state = applySessionUsageRecorded(state, {
      inputTokens: 12_000,
      outputTokens: 10,
      cacheReadTokens: 8_000,
      totalTokens: 20_010,
    })
    expect(presentContextUsage(state)).toMatchObject({
      percent: 20,
      uncachedPercent: 12,
      cachePercent: 8,
    })
    expect(presentContextUsage(state)?.usedLabel).toBe('20% 已用')
    expect(presentContextUsage(state)?.tokenRatioLabel).toBe('20k / 100k')
    expect(presentContextUsage(state)?.categories).toBeUndefined()
  })

  it('presents composition categories without treating billed cache as the main bar', () => {
    applyUiLocale('zh')
    let state = emptySessionTurnSnapshot()
    state = applySessionContextWindow(state, 1_000_000)
    state = applySessionUsageRecorded(state, {
      inputTokens: 120,
      outputTokens: 40,
      cacheReadTokens: 80,
      totalTokens: 240,
    })
    state = applySessionContextComposition(state, {
      estimatedTokens: 35_700,
      contextWindow: 1_000_000,
      categories: [
        { id: 'system', tokens: 12_400 },
        { id: 'tools', tokens: 8_100 },
        { id: 'skills', tokens: 0 },
        { id: 'conversation', tokens: 15_200 },
        { id: 'files' as 'system', tokens: 9_000 },
      ],
    })
    const presented = presentContextUsage(state)
    expect(presented?.percent).toBe(4)
    expect(presented?.usedLabel).toBe('4% 已用')
    expect(presented?.tokenRatioLabel).toBe('~35.7K / 1M')
    expect(presented?.nearLimit).toBe(false)
    expect(presented?.categories?.map(item => item.id)).toEqual([
      'system',
      'tools',
      'conversation',
    ])
    expect(presented?.categories).toEqual([
      {
        id: 'system',
        label: '系统提示',
        tokens: 12_400,
        tokenLabel: '12.4K',
        percent: 1,
      },
      {
        id: 'tools',
        label: '工具定义',
        tokens: 8_100,
        tokenLabel: '8.1K',
        percent: 1,
      },
      {
        id: 'conversation',
        label: '对话',
        tokens: 15_200,
        tokenLabel: '15.2K',
        percent: 2,
      },
    ])
    expect(presented?.last).toMatchObject({
      uncachedLabel: '120',
      cacheReadLabel: '80',
    })
    applyUiLocale('en')
    expect(presentContextUsage(state)?.usedLabel).toBe('4% Full')
    expect(presentContextUsage(state)?.categories?.[0]?.label).toBe('System prompt')
    applyUiLocale('zh')
  })

  it('reads context.composition from a nested field or flattened event', () => {
    expect(readContextCompositionFromEvent({
      type: 'usage.recorded',
      contextComposition: {
        estimatedTokens: 2_000,
        categories: [{ id: 'system', tokens: 2_000 }],
      },
    })?.estimatedTokens).toBe(2_000)
    expect(readContextCompositionFromEvent({
      type: 'context.composition',
      estimatedTokens: 3_000,
      contextWindow: 128_000,
      categories: [{ id: 'mcp', tokens: 3_000 }],
    })).toMatchObject({
      estimatedTokens: 3_000,
      contextWindow: 128_000,
      categories: [{ id: 'mcp', tokens: 3_000 }],
    })
    expect(readContextCompositionFromEvent({
      type: 'usage.recorded',
      usage: {
        contextComposition: {
          estimatedTokens: 500,
          categories: [{ id: 'subagent', tokens: 500 }],
        },
      },
    })?.categories).toEqual([{ id: 'subagent', tokens: 500 }])
  })

  it('round-trips composition with billed occupancy', () => {
    const snapshot = snapshotFromStoredContextUsage({
      inputTokens: 12_000,
      outputTokens: 800,
      cacheReadTokens: 2_000,
      cacheWriteTokens: 0,
      totalTokens: 14_800,
      contextWindow: 500_000,
      model: 'grok-4.6',
      recordedAt: 42,
      composition: {
        estimatedTokens: 18_000,
        contextWindow: 500_000,
        categories: [
          { id: 'tools', tokens: 4_000 },
          { id: 'conversation', tokens: 14_000 },
        ],
      },
    })
    expect(presentContextUsage(snapshot)?.percent).toBe(4)
    expect(presentContextUsage(snapshot)?.categories?.map(item => item.id)).toEqual([
      'tools',
      'conversation',
    ])
    expect(storedContextUsageFromSnapshot(snapshot)).toMatchObject({
      inputTokens: 12_000,
      cacheReadTokens: 2_000,
      contextWindow: 500_000,
      estimatedTokens: 18_000,
      categories: [
        { id: 'tools', tokens: 4_000 },
        { id: 'conversation', tokens: 14_000 },
      ],
      composition: {
        estimatedTokens: 18_000,
        categories: [
          { id: 'tools', tokens: 4_000 },
          { id: 'conversation', tokens: 14_000 },
        ],
      },
    })
  })

  it('hydrates composition from Go flat estimatedTokens and categories', () => {
    const snapshot = snapshotFromStoredContextUsage({
      inputTokens: 12_000,
      outputTokens: 800,
      cacheReadTokens: 2_000,
      cacheWriteTokens: 0,
      totalTokens: 14_800,
      contextWindow: 500_000,
      estimatedTokens: 18_000,
      categories: [
        { id: 'tools', tokens: 4_000 },
        { id: 'conversation', tokens: 14_000 },
      ],
    })
    expect(presentContextUsage(snapshot)?.categories?.map(item => item.id)).toEqual([
      'tools',
      'conversation',
    ])
    expect(snapshot.composition?.estimatedTokens).toBe(18_000)
  })

  it('presents composition-only occupancy for sessions without billed usage', () => {
    const state = applySessionContextComposition(emptySessionTurnSnapshot(), {
      estimatedTokens: 8_000,
      contextWindow: 200_000,
      categories: [{ id: 'system', tokens: 8_000 }],
    })
    const presented = presentContextUsage(state)
    expect(presented?.percent).toBe(4)
    expect(presented?.usedLabel).toBe('4% 已用')
    expect(presented?.tokenRatioLabel).toBe('~8K / 200K')
    expect(presented?.last).toBeUndefined()
    expect(storedContextUsageFromSnapshot(state)?.composition?.estimatedTokens).toBe(8_000)
  })

  it('clears stale composition after compaction', () => {
    let state = applySessionContextComposition(emptySessionTurnSnapshot(), {
      estimatedTokens: 90_000,
      contextWindow: 100_000,
      categories: [{ id: 'conversation', tokens: 90_000 }],
    })
    state = applySessionUsageAfterCompaction(state, 12_000, 2000)
    expect(state.composition).toBeUndefined()
    expect(presentContextUsage(state)?.categories).toBeUndefined()
    expect(presentContextUsage(state)?.percent).toBe(12)
  })

  it('formats composition token counts with a tenth of a K', () => {
    expect(formatCompositionTokenCount(35_700)).toBe('35.7K')
    expect(formatCompositionTokenCount(1_000_000)).toBe('1M')
    expect(formatCompositionTokenCount(1200)).toBe('1.2K')
  })
})
