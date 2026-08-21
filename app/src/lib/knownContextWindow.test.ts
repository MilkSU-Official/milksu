import { describe, expect, it } from 'vitest'
import { resolveModelContextWindow } from '@/lib/knownContextWindow'

describe('knownContextWindow', () => {
  it('fills known series and keeps explicit catalog values', () => {
    expect(resolveModelContextWindow('x-ai/grok-4.6', 0)).toBe(500_000)
    expect(resolveModelContextWindow('grok-4.6', 128_000)).toBe(500_000)
    expect(resolveModelContextWindow('grok-4.6', 256_000)).toBe(256_000)
    expect(resolveModelContextWindow('custom-128k', 128_000)).toBe(128_000)
    expect(resolveModelContextWindow('custom-unknown', 0)).toBe(0)
  })
})
