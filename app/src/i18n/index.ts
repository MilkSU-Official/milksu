import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './en.json'
import zh from './zh.json'

type SupportedLocale = 'en' | 'zh'

const resources = {
  en: { translation: en },
  zh: { translation: zh },
}

function normalizeLocale(value: unknown): SupportedLocale | null {
  if (typeof value !== 'string') return null
  const lower = value.toLowerCase()
  if (lower.startsWith('zh')) return 'zh'
  if (lower.startsWith('en')) return 'en'
  return null
}

function readStoredLocale(): SupportedLocale | null {
  if (typeof window === 'undefined') return null

  for (const key of ['milksu_settings', 'milksu.dev.settings']) {
    try {
      const raw = window.localStorage.getItem(key)
      if (!raw) continue
      const parsed = JSON.parse(raw) as { locale?: unknown }
      const locale = normalizeLocale(parsed.locale)
      if (locale) return locale
    } catch {
      // Ignore malformed preview settings.
    }
  }

  return null
}

function detectInitialLanguage(): SupportedLocale {
  return readStoredLocale() ?? normalizeLocale(navigator.language) ?? 'en'
}

void i18next.use(initReactI18next).init({
  resources,
  lng: detectInitialLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
})

export default i18next
