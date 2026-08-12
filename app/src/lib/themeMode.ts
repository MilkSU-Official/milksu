export const THEME_MODE_STORAGE_KEY = 'milksu.theme-mode'

export type ThemeMode = 'dark' | 'light'

export function normalizeThemeMode(value: unknown): ThemeMode {
  return value === 'dark' ? 'dark' : 'light'
}

export function readThemeMode(storage: Storage | null = safeStorage()): ThemeMode {
  if (!storage) return 'light'
  return normalizeThemeMode(storage.getItem(THEME_MODE_STORAGE_KEY))
}

export function writeThemeMode(mode: ThemeMode, storage: Storage | null = safeStorage()) {
  if (!storage) return
  storage.setItem(THEME_MODE_STORAGE_KEY, mode)
}

export function applyThemeMode(mode: ThemeMode, root: HTMLElement | null = safeDocumentRoot()) {
  if (!root) return
  root.dataset.theme = mode
  root.style.colorScheme = mode
}

export function nextThemeMode(mode: ThemeMode): ThemeMode {
  return mode === 'dark' ? 'light' : 'dark'
}

function safeStorage(): Storage | null {
  if (typeof window === 'undefined') return null
  return window.localStorage ?? null
}

function safeDocumentRoot(): HTMLElement | null {
  if (typeof document === 'undefined') return null
  return document.documentElement
}
