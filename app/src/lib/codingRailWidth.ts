export const CODING_RAIL_WIDTH_KEY = 'milksu.coding.rail-width.v1'
export const CODING_RAIL_MIN_WIDTH = 288
export const CODING_RAIL_MAX_WIDTH = 720

export function clampCodingRailWidth(width: number): number {
  if (!Number.isFinite(width)) return CODING_RAIL_MIN_WIDTH
  return Math.min(CODING_RAIL_MAX_WIDTH, Math.max(CODING_RAIL_MIN_WIDTH, Math.round(width)))
}

export function parseCodingRailWidth(raw: string | null): number | null {
  if (!raw) return null
  const value = Number(raw)
  if (!Number.isFinite(value)) return null
  return clampCodingRailWidth(value)
}

export function readCodingRailWidth(storage: Pick<Storage, 'getItem'> | null = defaultStorage()): number | null {
  try {
    return parseCodingRailWidth(storage?.getItem(CODING_RAIL_WIDTH_KEY) ?? null)
  } catch {
    return null
  }
}

export function writeCodingRailWidth(
  width: number,
  storage: Pick<Storage, 'setItem'> | null = defaultStorage(),
): number {
  const next = clampCodingRailWidth(width)
  try {
    storage?.setItem(CODING_RAIL_WIDTH_KEY, String(next))
  } catch {
    // Private mode or quota: keep the in-memory width only.
  }
  return next
}

function defaultStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}
