import { describe, expect, it } from 'vitest'
import {
  chatAutoScrollThreshold,
  nextChatAutoScrollPinned,
  shouldFollowChatOutput,
} from './chatAutoScroll'

describe('chat auto scroll', () => {
  it('follows output while the user remains at or near the bottom', () => {
    expect(shouldFollowChatOutput(600, 400, 1000)).toBe(true)
    expect(shouldFollowChatOutput(
      600 - chatAutoScrollThreshold,
      400,
      1000,
    )).toBe(true)
  })

  it('stops following as soon as the user scrolls above the bottom threshold', () => {
    expect(shouldFollowChatOutput(
      600 - chatAutoScrollThreshold - 1,
      400,
      1000,
    )).toBe(false)
    expect(shouldFollowChatOutput(250, 400, 1000)).toBe(false)
  })

  it('stops on any upward user movement, even within the bottom threshold', () => {
    expect(nextChatAutoScrollPinned(600, 599, 400, 1000)).toBe(false)
    expect(nextChatAutoScrollPinned(599, 600, 400, 1000)).toBe(true)
  })

  it('treats a short viewport as already pinned to the bottom', () => {
    expect(shouldFollowChatOutput(0, 600, 400)).toBe(true)
  })
})
