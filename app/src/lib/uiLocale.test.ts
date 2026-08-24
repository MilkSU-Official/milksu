// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import { applyUiLocale, normalizeUiLocale, t, uiLocale } from './uiLocale'

afterEach(() => {
  applyUiLocale('zh')
})

describe('uiLocale', () => {
  it('treats anything other than en as Chinese', () => {
    expect(normalizeUiLocale(undefined)).toBe('zh')
    expect(normalizeUiLocale('zh')).toBe('zh')
    expect(normalizeUiLocale('EN')).toBe('en')
  })

  it('switches chrome copy when the locale changes', () => {
    applyUiLocale('zh')
    expect(t('设置', 'Settings')).toBe('设置')
    applyUiLocale('en')
    expect(uiLocale()).toBe('en')
    expect(t('设置', 'Settings')).toBe('Settings')
    expect(document.documentElement.lang).toBe('en')
  })
})
