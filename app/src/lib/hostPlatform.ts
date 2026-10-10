export type HostPlatform = 'darwin' | 'win32' | 'linux' | 'web'
export type WindowChromeTheme = 'light' | 'dark'
export type WindowChromeThemeMode = 'system' | 'light' | 'dark'

type HostPlatformSource = {
  milksu?: {
    hostPlatform?: unknown
    invoke?: (method: string, args: unknown[]) => Promise<unknown>
  }
}

function asHostPlatformSource(input: HostPlatformSource | typeof globalThis): HostPlatformSource {
  return input as HostPlatformSource
}

export function readHostPlatform(input: HostPlatformSource | typeof globalThis = globalThis): HostPlatform {
  const raw = asHostPlatformSource(input).milksu?.hostPlatform
  if (raw === 'darwin' || raw === 'win32' || raw === 'linux') return raw
  return 'web'
}

export function applyHostPlatform(
  root: HTMLElement | null = safeDocumentRoot(),
  platform = readHostPlatform(),
) {
  if (!root) return
  root.dataset.hostPlatform = platform
}

export function syncWindowChrome(
  theme: WindowChromeTheme,
  input: HostPlatformSource | typeof globalThis = globalThis,
  mode?: WindowChromeThemeMode,
) {
  const invoke = asHostPlatformSource(input).milksu?.invoke
  if (typeof invoke !== 'function') return
  const themeMode = mode === 'system' || mode === 'light' || mode === 'dark' ? mode : theme
  void invoke('SetTitleBarOverlay', [{ theme, mode: themeMode }]).catch(() => undefined)
}

export function toggleWindowMaximize(
  input: HostPlatformSource | typeof globalThis = globalThis,
) {
  const source = asHostPlatformSource(input)
  const platform = readHostPlatform(source)
  const invoke = source.milksu?.invoke
  if (platform !== 'linux' || typeof invoke !== 'function') return
  void invoke('window.toggleMaximize', []).catch(() => undefined)
}

export function attachWindowMaximizeDblClick(
  target: EventTarget = globalThis,
  source: HostPlatformSource | typeof globalThis = globalThis,
): () => void {
  if (typeof target?.addEventListener !== 'function') return () => {}

  const onDoubleClick = (event: Event) => {
    const el = event.target
    if (!(el instanceof Element)) return
    if (el.closest('.app-no-drag, button, input, select, textarea, a, [data-no-drag]')) return
    if (el.closest('.app-drag')) {
      toggleWindowMaximize(source)
    }
  }

  target.addEventListener('dblclick', onDoubleClick)
  return () => {
    target.removeEventListener('dblclick', onDoubleClick)
  }
}

function safeDocumentRoot(): HTMLElement | null {
  if (typeof document === 'undefined') return null
  return document.documentElement
}
