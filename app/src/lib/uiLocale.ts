import { reactive } from 'vue'

export type UiLocale = 'zh' | 'en'

const localeState = reactive<{ locale: UiLocale }>({ locale: 'zh' })

export function normalizeUiLocale(value: unknown): UiLocale {
  return String(value ?? '').trim().toLowerCase() === 'en' ? 'en' : 'zh'
}

export function uiLocale(): UiLocale {
  return localeState.locale
}

export function applyUiLocale(value: unknown) {
  const locale = normalizeUiLocale(value)
  localeState.locale = locale
  const root = typeof document === 'undefined' ? null : document.documentElement
  if (root) root.lang = locale === 'zh' ? 'zh-CN' : 'en'
}

/** Chinese-first copy. Reading localeState makes every render reactive. */
export function t(zh: string, en: string): string {
  return localeState.locale === 'en' ? en : zh
}
