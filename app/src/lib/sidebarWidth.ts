export const SIDEBAR_WIDTH_KEY = 'milksu.sidebar-width.v1'
export const COLLAPSED_SIDEBAR_WIDTH = 52
export const MIN_SIDEBAR_WIDTH = 224
export const DEFAULT_SIDEBAR_WIDTH = 264
export const MAX_SIDEBAR_WIDTH = 420

export function clampSidebarWidth(width: number): number {
  if (!Number.isFinite(width)) return DEFAULT_SIDEBAR_WIDTH
  return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, Math.round(width)))
}

export function parseSidebarWidth(raw: string | null): number | null {
  if (!raw) return null
  const value = Number(raw)
  if (!Number.isFinite(value)) return null
  return clampSidebarWidth(value)
}

export function readSidebarWidth(storage: Pick<Storage, 'getItem'> | null = defaultStorage()): number {
  try {
    return parseSidebarWidth(storage?.getItem(SIDEBAR_WIDTH_KEY) ?? null) ?? DEFAULT_SIDEBAR_WIDTH
  } catch {
    return DEFAULT_SIDEBAR_WIDTH
  }
}

export function writeSidebarWidth(
  width: number,
  storage: Pick<Storage, 'setItem'> | null = defaultStorage(),
): number {
  const next = clampSidebarWidth(width)
  try {
    storage?.setItem(SIDEBAR_WIDTH_KEY, String(next))
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
