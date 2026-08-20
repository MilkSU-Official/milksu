// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest'
import {
  THEME_MODE_STORAGE_KEY,
  applyThemeMode,
  nextThemeMode,
  normalizeThemeMode,
  readThemeMode,
  writeThemeMode,
} from './themeMode'

describe('themeMode', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-theme')
    document.documentElement.removeAttribute('data-theme-mode')
    document.documentElement.removeAttribute('style')
  })

  it('defaults to the system theme while preserving explicit choices', () => {
    const storage = createMemoryStorage()
    expect(normalizeThemeMode('dark')).toBe('dark')
    expect(normalizeThemeMode('light')).toBe('light')
    expect(normalizeThemeMode('system')).toBe('system')
    expect(normalizeThemeMode('unknown')).toBe('system')
    expect(readThemeMode(storage)).toBe('system')

    storage.setItem(THEME_MODE_STORAGE_KEY, 'dark')
    expect(readThemeMode(storage)).toBe('dark')
  })

  it('applies and persists the current mode', () => {
    const storage = createMemoryStorage()
    applyThemeMode('system', document.documentElement, true)
    writeThemeMode('system', storage)

    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(document.documentElement.dataset.themeMode).toBe('system')
    expect(document.documentElement.style.colorScheme).toBe('dark')
    expect(storage.getItem(THEME_MODE_STORAGE_KEY)).toBe('system')
    expect(nextThemeMode('system')).toBe('light')
    expect(nextThemeMode('light')).toBe('dark')
    expect(nextThemeMode('dark')).toBe('system')
  })
})

function createMemoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() {
      return values.size
    },
    clear() {
      values.clear()
    },
    getItem(key: string) {
      return values.get(key) ?? null
    },
    key(index: number) {
      return Array.from(values.keys())[index] ?? null
    },
    removeItem(key: string) {
      values.delete(key)
    },
    setItem(key: string, value: string) {
      values.set(key, value)
    },
  }
}
