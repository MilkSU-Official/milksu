import { describe, expect, it } from 'vitest'
import { chatEdgeFadeAmounts, parseFadeSpan } from './chatEdgeFade'

describe('chatEdgeFade', () => {
  it('keeps an edge clear when the transcript is resting there', () => {
    expect(chatEdgeFadeAmounts({ scrollTop: 0, scrollHeight: 400, clientHeight: 200 })).toEqual({
      top: 0,
      bottom: 1,
    })
    expect(chatEdgeFadeAmounts({ scrollTop: 200, scrollHeight: 400, clientHeight: 200 })).toEqual({
      top: 1,
      bottom: 0,
    })
  })

  it('ramps across the fade span and stays off when nothing overflows', () => {
    expect(chatEdgeFadeAmounts({ scrollTop: 16, scrollHeight: 232, clientHeight: 200 }, 32)).toEqual({
      top: 0.5,
      bottom: 0.5,
    })
    expect(chatEdgeFadeAmounts({ scrollTop: 0, scrollHeight: 120, clientHeight: 200 })).toEqual({
      top: 0,
      bottom: 0,
    })
  })

  it('reads a rem fade span against the root font size', () => {
    expect(parseFadeSpan('2rem', 16)).toBe(32)
    expect(parseFadeSpan('24px', 16)).toBe(24)
    expect(parseFadeSpan('', 16)).toBe(32)
  })
})
