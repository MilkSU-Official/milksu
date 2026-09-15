export type UiLocale = 'zh' | 'en'

type Listener = () => void

let locale: UiLocale = 'zh'
const listeners = new Set<Listener>()

function notify() {
  for (const listener of listeners) listener()
}

export function normalizeUiLocale(value: unknown): UiLocale {
  return String(value ?? '').trim().toLowerCase() === 'en' ? 'en' : 'zh'
}

export function uiLocale(): UiLocale {
  return locale
}

export function applyUiLocale(value: unknown) {
  const next = normalizeUiLocale(value)
  if (next === locale) return
  locale = next
  const root = typeof document === 'undefined' ? null : document.documentElement
  if (root) root.lang = locale === 'zh' ? 'zh-CN' : 'en'
  notify()
}

export function subscribeUiLocale(onChange: () => void) {
  listeners.add(onChange)
  return () => {
    listeners.delete(onChange)
  }
}

/** Chinese-first copy. subscribeUiLocale / useT make the chrome re-render. */
export function t(zh: string, en: string): string {
  return locale === 'en' ? en : zh
}
