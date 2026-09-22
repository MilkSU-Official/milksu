import { describe, expect, it } from 'vitest'
import {
  companionAttentionText,
  companionPetDragMoved,
  companionPetShowsError,
  companionPetSprite,
  formatCompanionThinkElapsed,
  resolveCompanionIsland,
  resolveCompanionPetMotion,
  stepCompanionThinkClock,
} from '@/lib/companionPetMotion'

describe('companionPetMotion', () => {
  it('picks decide over talk, think, and complete', () => {
    expect(resolveCompanionPetMotion({
      confirm: true,
      error: false,
      streaming: true,
      busy: true,
      complete: true,
    })).toBe('decide')
    expect(resolveCompanionPetMotion({
      confirm: false,
      error: true,
      streaming: false,
      busy: false,
      complete: true,
    })).toBe('decide')
  })

  it('uses closed mouth for think, smile for talk and complete', () => {
    expect(resolveCompanionPetMotion({
      confirm: false,
      error: false,
      streaming: false,
      busy: true,
      complete: false,
    })).toBe('think')
    expect(resolveCompanionPetMotion({
      confirm: false,
      error: false,
      streaming: true,
      busy: true,
      complete: false,
    })).toBe('talk')
    expect(resolveCompanionPetMotion({
      confirm: false,
      error: false,
      streaming: false,
      busy: false,
      complete: true,
    })).toBe('complete')
    expect(companionPetSprite('think')).toBe('idle')
    expect(companionPetSprite('think', { think: true })).toBe('think')
    expect(companionPetSprite('decide')).toBe('decide')
    expect(companionPetSprite('complete')).toBe('talk')
    expect(companionPetSprite('complete', { complete: true })).toBe('complete')
    expect(companionPetSprite('talk')).toBe('talk')
    expect(companionPetSprite('idle')).toBe('idle')
  })

  it('treats a short pointer move as a click, not a pet drag', () => {
    expect(companionPetDragMoved(2, 2)).toBe(false)
    expect(companionPetDragMoved(4, 0)).toBe(true)
    expect(companionPetDragMoved(-3, -3)).toBe(true)
  })

  it('draws an island for think, confirm, error, and complete only', () => {
    const quiet = { confirm: false, error: false, streaming: false, busy: false, complete: false }
    expect(resolveCompanionIsland({ ...quiet, busy: true })).toBe('think')
    expect(resolveCompanionIsland({ ...quiet, confirm: true, streaming: true, busy: true })).toBe('confirm')
    expect(resolveCompanionIsland({ ...quiet, confirm: true, error: true, busy: true })).toBe('confirm')
    expect(resolveCompanionIsland({ ...quiet, error: true, complete: true })).toBe('error')
    expect(resolveCompanionIsland({ ...quiet, complete: true })).toBe('complete')
    expect(resolveCompanionIsland({ ...quiet, streaming: true, busy: true })).toBe('none')
    expect(resolveCompanionIsland(quiet)).toBe('none')
  })

  it('formats the think clock as m:ss without milliseconds', () => {
    expect(formatCompanionThinkElapsed(0)).toBe('0:00')
    expect(formatCompanionThinkElapsed(12_000)).toBe('0:12')
    expect(formatCompanionThinkElapsed(12_999)).toBe('0:12')
    expect(formatCompanionThinkElapsed(61_000)).toBe('1:01')
    expect(formatCompanionThinkElapsed(3_599_000)).toBe('59:59')
    expect(formatCompanionThinkElapsed(3_661_000)).toBe('61:01')
    expect(formatCompanionThinkElapsed(Number.NaN)).toBe('0:00')
  })

  it('keeps the think clock through talk and resets when the turn ends', () => {
    const started = stepCompanionThinkClock(null, 'think', 1_000, true)
    expect(started).toBe(1_000)
    expect(stepCompanionThinkClock(started, 'talk', 5_000, true)).toBe(1_000)
    expect(stepCompanionThinkClock(started, 'decide', 6_000, true)).toBe(1_000)
    expect(stepCompanionThinkClock(started, 'think', 8_000, true)).toBe(1_000)
    expect(stepCompanionThinkClock(null, 'talk', 2_000, true)).toBeNull()
    expect(stepCompanionThinkClock(null, 'decide', 2_000, true)).toBeNull()
    expect(stepCompanionThinkClock(started, 'complete', 9_000, false)).toBeNull()
    expect(stepCompanionThinkClock(started, 'idle', 9_000, false)).toBeNull()
    const afterError = stepCompanionThinkClock(started, 'decide', 9_000, false)
    expect(afterError).toBeNull()
    expect(stepCompanionThinkClock(afterError, 'think', 10_000, true)).toBe(10_000)
  })

  it('uses the pet bubble sentence for confirm and stays quiet for a missing key', () => {
    const t = (zh: string, en: string) => `${zh}|${en}`
    expect(companionAttentionText({
      confirm: { action: 'stop', text: '', targetTitle: '' },
      error: '',
      t,
    })).toBe('有一条命令在等你确认|A command is waiting for your confirmation')
    expect(companionAttentionText({
      confirm: { action: 'other', text: '  look here  ', targetTitle: '' },
      error: 'ignored',
      t,
    })).toBe('look here')
    expect(companionAttentionText({
      confirm: null,
      error: 'no API key is configured',
      t,
    })).toBe('')
    expect(companionPetShowsError('')).toBe(false)
    expect(companionPetShowsError('no API key is configured')).toBe(false)
    expect(companionPetShowsError('companion sidecar is not running')).toBe(false)
    expect(companionPetShowsError('model exploded')).toBe(true)
  })
})
