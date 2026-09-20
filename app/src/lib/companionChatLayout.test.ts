import { describe, expect, it } from 'vitest'
import {
  COMPANION_CHAT_TIME_GAP_MS,
  companionChatIsBubble,
  companionChatIsUser,
  companionChatShowsTimeCaption,
  companionChatShowsTimeDivider,
  companionChatTimestampMs,
  formatCompanionChatStamp,
} from '@/lib/companionChatLayout'

describe('companionChatLayout', () => {
  it('parses ISO timestamps and ignores empty values', () => {
    expect(companionChatTimestampMs('')).toBe(0)
    expect(companionChatTimestampMs('not-a-date')).toBe(0)
    expect(companionChatTimestampMs('2026-09-20T10:00:00.000Z')).toBe(Date.parse('2026-09-20T10:00:00.000Z'))
  })

  it('formats same-day clock time and older day plus time', () => {
    const now = Date.parse('2026-09-20T12:00:00')
    const morning = new Date(now)
    morning.setHours(8, 5, 0, 0)
    expect(formatCompanionChatStamp(morning.toISOString(), 'zh', now)).toMatch(/^\d{1,2}:\d{2}$/)
    const earlier = new Date(now)
    earlier.setDate(earlier.getDate() - 2)
    earlier.setHours(8, 5, 0, 0)
    expect(formatCompanionChatStamp(earlier.toISOString(), 'en', now)).toMatch(/\d+[^\d]+\d+ \d{1,2}:\d{2}/)
  })

  it('shows a divider after a five-minute gap, not inside a tight cluster', () => {
    const first = Date.parse('2026-09-20T10:00:00.000Z')
    expect(companionChatShowsTimeDivider(first, 0)).toBe(true)
    expect(companionChatShowsTimeDivider(first + 60_000, first)).toBe(false)
    expect(companionChatShowsTimeDivider(first + COMPANION_CHAT_TIME_GAP_MS, first)).toBe(true)
  })

  it('keeps captions on the last bubble of a role cluster', () => {
    const currentMs = Date.parse('2026-09-20T10:00:00.000Z')
    expect(companionChatShowsTimeCaption({
      currentMs,
      nextMs: currentMs + 1_000,
      currentRole: 'assistant',
      nextRole: 'assistant',
      showDivider: false,
      isLast: false,
    })).toBe(false)
    expect(companionChatShowsTimeCaption({
      currentMs,
      nextMs: currentMs + 1_000,
      currentRole: 'assistant',
      nextRole: 'user',
      showDivider: false,
      isLast: false,
    })).toBe(true)
    expect(companionChatShowsTimeCaption({
      currentMs,
      nextMs: 0,
      currentRole: 'user',
      nextRole: undefined,
      showDivider: true,
      isLast: true,
    })).toBe(false)
  })

  it('treats only user and assistant rows as bubbles', () => {
    expect(companionChatIsUser('user')).toBe(true)
    expect(companionChatIsUser('assistant')).toBe(false)
    expect(companionChatIsBubble('assistant')).toBe(true)
    expect(companionChatIsBubble('system')).toBe(false)
  })
})
