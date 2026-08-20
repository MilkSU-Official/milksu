export const THEME_MODE_STORAGE_KEY = 'milksu.theme-mode'

export type ThemeMode = 'system' | 'light' | 'dark'
export type ResolvedThemeMode = 'light' | 'dark'

export function normalizeThemeMode(value: unknown): ThemeMode {
  return value === 'light' || value === 'dark' || value === 'system' ? value : 'system'
}

export function readThemeMode(storage: Storage | null = safeStorage()): ThemeMode {
  if (!storage) return 'system'
  return normalizeThemeMode(storage.getItem(THEME_MODE_STORAGE_KEY))
}

export function writeThemeMode(mode: ThemeMode, storage: Storage | null = safeStorage()) {
  if (!storage) return
  storage.setItem(THEME_MODE_STORAGE_KEY, mode)
}

export function resolveThemeMode(
  mode: ThemeMode,
  prefersDark = safePrefersDark(),
): ResolvedThemeMode {
  return mode === 'system' ? (prefersDark ? 'dark' : 'light') : mode
}

export function applyThemeMode(
  mode: ThemeMode,
  root: HTMLElement | null = safeDocumentRoot(),
  prefersDark = safePrefersDark(),
) {
  if (!root) return
  const resolved = resolveThemeMode(mode, prefersDark)
  root.dataset.theme = resolved
  root.dataset.themeMode = mode
  root.style.colorScheme = resolved
}

export function nextThemeMode(mode: ThemeMode): ThemeMode {
  if (mode === 'system') return 'light'
  return mode === 'light' ? 'dark' : 'system'
}

function safeStorage(): Storage | null {
  if (typeof window === 'undefined') return null
  return window.localStorage ?? null
}

function safeDocumentRoot(): HTMLElement | null {
  if (typeof document === 'undefined') return null
  return document.documentElement
}

function safePrefersDark(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}
