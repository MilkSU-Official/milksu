import { describe, expect, it } from 'vitest'
import { chatEdgeChromePx } from './chatEdgeFade'

describe('chatEdgeChromePx', () => {
  it('rounds a measured chrome box to whole pixels', () => {
    expect(chatEdgeChromePx(48.4)).toBe(48)
    expect(chatEdgeChromePx(48.6)).toBe(49)
  })

  it('treats a missing edge as no chrome', () => {
    expect(chatEdgeChromePx(0)).toBe(0)
    expect(chatEdgeChromePx(-12)).toBe(0)
    expect(chatEdgeChromePx(Number.NaN)).toBe(0)
  })
})
