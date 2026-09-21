import { describe, expect, it } from 'vitest'
import {
  estimateUsageCostUsd,
  formatEstimatedUsd,
  lookupKnownModelPricing,
} from '@/lib/knownModelPricing'

describe('knownModelPricing', () => {
  it('resolves official lab rates for known families', () => {
    expect(lookupKnownModelPricing('deepseek/deepseek-flash')).toMatchObject({
      input: 0.15,
      output: 0.6,
      cacheRead: 0.003,
    })
    expect(lookupKnownModelPricing('anthropic/claude-sonnet-4-6')).toMatchObject({
      input: 3,
      output: 15,
      cacheWrite: 3.75,
    })
    expect(lookupKnownModelPricing('openai/gpt-5.4-mini')).toMatchObject({
      input: 0.75,
      output: 4.5,
    })
  })

  it('estimates USD from token buckets without double-counting matching reasoning', () => {
    const cost = estimateUsageCostUsd('deepseek-flash', {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cacheReadTokens: 1_000_000,
      reasoningTokens: 500_000,
    })
    // reasoning rate equals output → only input + output + cacheRead
    expect(cost).toBeCloseTo(0.15 + 0.6 + 0.003, 6)
  })

  it('formats estimates for the profile surface', () => {
    expect(formatEstimatedUsd(0.0123, 'zh')).toBe('约 $0.012')
    expect(formatEstimatedUsd(1.2, 'en')).toBe('est. $1.20')
    expect(formatEstimatedUsd(undefined, 'zh')).toBe('暂无估价')
  })
})
