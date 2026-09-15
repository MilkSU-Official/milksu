import { useSyncExternalStore } from 'react'
import { subscribeUiLocale, t as translate, uiLocale, type UiLocale } from '@/lib/uiLocale'

export function useUiLocale(): UiLocale {
  return useSyncExternalStore(subscribeUiLocale, uiLocale, uiLocale)
}

export function useT() {
  useUiLocale()
  return translate
}
