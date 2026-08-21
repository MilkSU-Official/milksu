export const CODING_TERMINAL_HEIGHT_KEY = 'milksu.coding.terminal-height.v1'
export const CODING_TERMINAL_MIN_HEIGHT = 160
export const CODING_TERMINAL_DEFAULT_HEIGHT = 320

export function clampCodingTerminalHeight(
  height: number,
  viewportHeight = defaultViewportHeight(),
): number {
  const max = Math.max(
    CODING_TERMINAL_MIN_HEIGHT,
    Math.round(Math.max(viewportHeight, 1) * 0.72),
  )
  if (!Number.isFinite(height)) return CODING_TERMINAL_MIN_HEIGHT
  return Math.min(max, Math.max(CODING_TERMINAL_MIN_HEIGHT, Math.round(height)))
}

export function parseCodingTerminalHeight(
  raw: string | null,
  viewportHeight = defaultViewportHeight(),
): number | null {
  if (!raw) return null
  const value = Number(raw)
  if (!Number.isFinite(value)) return null
  return clampCodingTerminalHeight(value, viewportHeight)
}

export function readCodingTerminalHeight(
  storage: Pick<Storage, 'getItem'> | null = defaultStorage(),
  viewportHeight = defaultViewportHeight(),
): number {
  try {
    return parseCodingTerminalHeight(storage?.getItem(CODING_TERMINAL_HEIGHT_KEY) ?? null, viewportHeight)
      ?? clampCodingTerminalHeight(CODING_TERMINAL_DEFAULT_HEIGHT, viewportHeight)
  } catch {
    return clampCodingTerminalHeight(CODING_TERMINAL_DEFAULT_HEIGHT, viewportHeight)
  }
}

export function writeCodingTerminalHeight(
  height: number,
  storage: Pick<Storage, 'setItem'> | null = defaultStorage(),
  viewportHeight = defaultViewportHeight(),
): number {
  const next = clampCodingTerminalHeight(height, viewportHeight)
  try {
    storage?.setItem(CODING_TERMINAL_HEIGHT_KEY, String(next))
  } catch {
    // Private mode or quota: keep the in-memory height only.
  }
  return next
}

function defaultViewportHeight() {
  try {
    return typeof window === 'undefined' ? 900 : window.innerHeight
  } catch {
    return 900
  }
}

function defaultStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}
