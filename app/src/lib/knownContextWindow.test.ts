import { describe, expect, it } from 'vitest'
import { resolveModelContextWindow } from '@/lib/knownContextWindow'

describe('knownContextWindow', () => {
  it('fills known series and keeps explicit catalog values', () => {
    expect(resolveModelContextWindow('x-ai/grok-4.6', 0)).toBe(500_000)
    expect(resolveModelContextWindow('grok-4.6', 128_000)).toBe(500_000)
    expect(resolveModelContextWindow('grok-4.6', 256_000)).toBe(256_000)
    expect(resolveModelContextWindow('x-ai/grok-4-fast-reasoning', 128_000)).toBe(1_000_000)
    expect(resolveModelContextWindow('x-ai/grok-build-0.1', 128_000)).toBe(256_000)
    expect(resolveModelContextWindow('openai/gpt-5-mini', 128_000)).toBe(400_000)
    expect(resolveModelContextWindow('openai/gpt-5.5', 128_000)).toBe(1_050_000)
    expect(resolveModelContextWindow('openai/gpt-5.4', 128_000)).toBe(1_050_000)
    expect(resolveModelContextWindow('openai/gpt-5.4-mini', 128_000)).toBe(400_000)
    expect(resolveModelContextWindow('openai/gpt-5.3-chat-latest', 128_000)).toBe(128_000)
    expect(resolveModelContextWindow('openai/gpt-4.1-mini', 128_000)).toBe(1_047_576)
    expect(resolveModelContextWindow('anthropic/claude-sonnet-4.5', 128_000)).toBe(200_000)
    expect(resolveModelContextWindow('anthropic/claude-sonnet-5', 128_000)).toBe(1_000_000)
    expect(resolveModelContextWindow('anthropic/claude-opus-4-8', 128_000)).toBe(1_000_000)
    expect(resolveModelContextWindow('anthropic/claude-opus-4-6', 128_000)).toBe(1_000_000)
    expect(resolveModelContextWindow('custom-128k', 128_000)).toBe(128_000)
    expect(resolveModelContextWindow('custom-unknown', 0)).toBe(0)
  })
})
