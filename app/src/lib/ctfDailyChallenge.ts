import type { NSSCTFCatalogProblem } from '@/nssctfTrainingTypes'

export const CTF_DAILY_CHALLENGE_STORAGE_KEY = 'milksu.ctf.daily-challenge.v1'

export interface CTFDailyChallengeRecord {
  dateKey: string
  problem: NSSCTFCatalogProblem
  reason?: string
  source?: 'model' | 'rules'
  provider?: string
  model?: string
}

export function localCTFDateKey(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function parseCTFDailyChallengeRecord(raw: string | null): CTFDailyChallengeRecord | null {
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as Partial<CTFDailyChallengeRecord>
    if (!value.dateKey || !value.problem || !Number.isFinite(value.problem.platformId)) return null
    return value as CTFDailyChallengeRecord
  } catch {
    return null
  }
}

function dateHash(value: string) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

export function chooseCTFDailyChallenge(
  dateKey: string,
  candidates: NSSCTFCatalogProblem[],
  completedIds: number[],
  currentId?: number,
) {
  const completed = new Set(completedIds)
  const unique = [...new Map(candidates.map(problem => [problem.platformId, problem])).values()]
    .filter(problem => !completed.has(problem.platformId))
    .sort((left, right) => left.platformId - right.platformId)
  if (!unique.length) return null

  if (currentId !== undefined && unique.length > 1) {
    const currentIndex = unique.findIndex(problem => problem.platformId === currentId)
    if (currentIndex >= 0) return unique[(currentIndex + 1) % unique.length]
  }
  return unique[dateHash(dateKey) % unique.length]
}
