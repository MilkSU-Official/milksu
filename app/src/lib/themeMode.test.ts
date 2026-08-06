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
    document.documentElement.removeAttribute('style')
  })

  it('defaults to the night theme unless the user explicitly chose day mode', () => {
    const storage = createMemoryStorage()
    expect(normalizeThemeMode('dark')).toBe('dark')
    expect(normalizeThemeMode('light')).toBe('light')
    expect(normalizeThemeMode('system')).toBe('dark')
    expect(readThemeMode(storage)).toBe('dark')

    storage.setItem(THEME_MODE_STORAGE_KEY, 'light')
    expect(readThemeMode(storage)).toBe('light')
  })

  it('applies and persists the current mode', () => {
    const storage = createMemoryStorage()
    applyThemeMode('light')
    writeThemeMode('light', storage)

    expect(document.documentElement.dataset.theme).toBe('light')
    expect(document.documentElement.style.colorScheme).toBe('light')
    expect(storage.getItem(THEME_MODE_STORAGE_KEY)).toBe('light')
    expect(nextThemeMode('light')).toBe('dark')
    expect(nextThemeMode('dark')).toBe('light')
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
