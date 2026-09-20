import { describe, expect, it } from 'vitest'
import {
  COMPANION_CHAT_TIME_GAP_MS,
  companionChatContinuesRun,
  companionChatEndsRun,
  companionChatIsBubble,
  companionChatIsUser,
  companionChatShowsTimeCaption,
  companionChatShowsTimeDivider,
  companionChatSide,
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

  it('groups adjacent rows from the same side into one run', () => {
    const first = '2026-09-20T10:00:00.000Z'
    const soon = '2026-09-20T10:02:00.000Z'
    const later = '2026-09-20T10:20:00.000Z'
    expect(companionChatContinuesRun(
      { role: 'assistant', timestamp: soon },
      { role: 'assistant', timestamp: first },
    )).toBe(true)
    expect(companionChatContinuesRun(
      { role: 'user', timestamp: soon },
      { role: 'assistant', timestamp: first },
    )).toBe(false)
    expect(companionChatContinuesRun(
      { role: 'assistant', timestamp: later },
      { role: 'assistant', timestamp: first },
    )).toBe(false)
    expect(companionChatContinuesRun(
      { role: 'assistant', timestamp: soon },
      undefined,
    )).toBe(false)
  })

  it('groups transcript entries that carry no role into one block', () => {
    const first = '2026-09-20T10:00:00.000Z'
    const soon = '2026-09-20T10:00:10.000Z'
    expect(companionChatSide(undefined)).toBe('note')
    expect(companionChatSide('')).toBe('note')
    expect(companionChatSide('system')).toBe('note')
    expect(companionChatContinuesRun(
      { timestamp: soon },
      { timestamp: first },
    )).toBe(true)
    expect(companionChatContinuesRun(
      { role: 'assistant', timestamp: soon },
      { timestamp: first },
    )).toBe(false)
  })

  it('ends a run on the last row, a role change, or a time gap', () => {
    const first = Date.parse('2026-09-20T10:00:00.000Z')
    expect(companionChatEndsRun({
      currentMs: first,
      nextMs: first + 60_000,
      currentRole: 'user',
      nextRole: 'user',
      isLast: false,
    })).toBe(false)
    expect(companionChatEndsRun({
      currentMs: first,
      nextMs: first + 60_000,
      currentRole: 'user',
      nextRole: 'user',
      isLast: true,
    })).toBe(true)
    expect(companionChatEndsRun({
      currentMs: first,
      nextMs: first + 60_000,
      currentRole: 'user',
      nextRole: 'assistant',
      isLast: false,
    })).toBe(true)
    expect(companionChatEndsRun({
      currentMs: first,
      nextMs: first + COMPANION_CHAT_TIME_GAP_MS,
      currentRole: 'user',
      nextRole: 'user',
      isLast: false,
    })).toBe(true)
  })
})
