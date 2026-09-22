import { describe, expect, it } from 'vitest'
import { canFlipHostWithoutMigrate, normalizeConversationHost } from './conversationHost'

describe('conversationHost', () => {
  it('defaults unknown to local', () => {
    expect(normalizeConversationHost(undefined)).toBe('local')
    expect(normalizeConversationHost('cloud')).toBe('cloud')
  })

  it('allows free flip only before first message', () => {
    expect(canFlipHostWithoutMigrate(0)).toBe(true)
    expect(canFlipHostWithoutMigrate(1)).toBe(false)
  })
})
