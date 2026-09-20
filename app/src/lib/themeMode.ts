export const THEME_MODE_STORAGE_KEY = 'milksu.theme-mode'

export type ThemeMode = 'system' | 'light' | 'dark'
export type ResolvedThemeMode = 'light' | 'dark'

/** Stored `light` / `dark` are the appearance, shared with official Vue. */

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

export const THEME_SYNC_CHANNEL = 'milksu.theme-sync'

export function applyThemeMode(
  mode: ThemeMode,
  root: HTMLElement | null = safeDocumentRoot(),
  prefersDark = safePrefersDark(),
) {
  if (!root) return
  const resolved = resolveThemeMode(mode, prefersDark)
  root.dataset.theme = resolved
  root.dataset.themeMode = mode
  root.classList.toggle('dark', resolved === 'dark')
  root.style.colorScheme = resolved
}

export function publishThemeSync(
  mode: ThemeMode,
  prefersDark = safePrefersDark(),
) {
  const next = normalizeThemeMode(mode)
  const resolved = resolveThemeMode(next, prefersDark)
  try {
    const channel = new BroadcastChannel(THEME_SYNC_CHANNEL)
    channel.postMessage({ mode: next, resolved })
    channel.close()
  } catch {
    // BroadcastChannel is unavailable in some test and embedded renderers.
  }
  return { mode: next, resolved }
}

export function subscribeThemeSync(
  onChange: (mode: ThemeMode, resolved: ResolvedThemeMode) => void,
) {
  if (typeof window === 'undefined') return () => {}
  const apply = (mode: unknown, resolved?: unknown) => {
    const next = normalizeThemeMode(mode)
    const appearance = resolved === 'light' || resolved === 'dark'
      ? resolved
      : resolveThemeMode(next)
    onChange(next, appearance)
  }
  let channel: BroadcastChannel | undefined
  try {
    channel = new BroadcastChannel(THEME_SYNC_CHANNEL)
    channel.onmessage = event => {
      apply(event.data?.mode, event.data?.resolved)
    }
  } catch {
    channel = undefined
  }
  const onStorage = (event: StorageEvent) => {
    if (event.key !== THEME_MODE_STORAGE_KEY || event.newValue == null) return
    apply(event.newValue)
  }
  window.addEventListener('storage', onStorage)
  return () => {
    channel?.close()
    window.removeEventListener('storage', onStorage)
  }
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
