export type HostPlatform = 'darwin' | 'win32' | 'linux' | 'web'
export type WindowChromeTheme = 'light' | 'dark'

type HostPlatformSource = {
  milksu?: {
    hostPlatform?: unknown
    invoke?: (method: string, args: unknown[]) => Promise<unknown>
  }
}

export function readHostPlatform(input: HostPlatformSource = globalThis as HostPlatformSource): HostPlatform {
  const raw = input.milksu?.hostPlatform
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
  input: HostPlatformSource = globalThis as HostPlatformSource,
) {
  const invoke = input.milksu?.invoke
  if (typeof invoke !== 'function') return
  void invoke('SetTitleBarOverlay', [{ theme }]).catch(() => undefined)
}

function safeDocumentRoot(): HTMLElement | null {
  if (typeof document === 'undefined') return null
  return document.documentElement
}
