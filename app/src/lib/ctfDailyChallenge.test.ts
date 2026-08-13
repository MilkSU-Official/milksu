import { describe, expect, it } from 'vitest'
import {
  chooseCTFDailyChallenge,
  localCTFDateKey,
  parseCTFDailyChallengeRecord,
} from './ctfDailyChallenge'
import type { NSSCTFCatalogProblem } from '@/nssctfTrainingTypes'

function problem(platformId: number): NSSCTFCatalogProblem {
  return {
    platformId,
    sourceUrl: `https://www.nssctf.cn/problem/${platformId}`,
    title: `题目 ${platformId}`,
    category: 'Web',
    points: 100,
    difficulty: 1,
    tags: [],
    hasWriteup: false,
    solvedCount: 0,
    wrongAnswerCount: 0,
    noAnswerCount: 0,
    open: true,
    syncedAt: '2026-08-13T00:00:00Z',
  }
}

describe('CTF daily challenge', () => {
  it('uses a local calendar date key', () => {
    expect(localCTFDateKey(new Date(2026, 7, 13, 23, 59))).toBe('2026-08-13')
  })

  it('selects the same unfinished problem for the same date and candidates', () => {
    const candidates = [problem(4), problem(2), problem(8)]
    const first = chooseCTFDailyChallenge('2026-08-13', candidates, [])
    const second = chooseCTFDailyChallenge('2026-08-13', [...candidates].reverse(), [])

    expect(second?.platformId).toBe(first?.platformId)
  })

  it('excludes completed problems and lets the user move to another candidate', () => {
    const candidates = [problem(1), problem(2), problem(3)]
    const first = chooseCTFDailyChallenge('2026-08-13', candidates, [2])
    const changed = chooseCTFDailyChallenge('2026-08-13', candidates, [2], first?.platformId)

    expect(first?.platformId).not.toBe(2)
    expect(changed?.platformId).not.toBe(first?.platformId)
    expect(changed?.platformId).not.toBe(2)
  })

  it('rejects malformed saved records', () => {
    expect(parseCTFDailyChallengeRecord('{')).toBeNull()
    expect(parseCTFDailyChallengeRecord('{"dateKey":"2026-08-13"}')).toBeNull()
  })
})
