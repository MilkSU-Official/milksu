// @vitest-environment jsdom

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  THEME_MODE_STORAGE_KEY,
  THEME_SYNC_CHANNEL,
  applyThemeMode,
  nextThemeMode,
  normalizeThemeMode,
  publishThemeSync,
  readThemeMode,
  subscribeThemeSync,
  writeThemeMode,
} from './themeMode'

const themeBootSource = readFileSync(join(process.cwd(), 'public/theme-boot.js'), 'utf8')
const indexHtmlSource = readFileSync(join(process.cwd(), 'index.html'), 'utf8')
const mainSource = readFileSync(join(process.cwd(), 'src/main.tsx'), 'utf8')

describe('themeMode', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-theme')
    document.documentElement.removeAttribute('data-theme-mode')
    document.documentElement.removeAttribute('style')
    document.documentElement.classList.remove('dark')
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
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(document.documentElement.style.colorScheme).toBe('dark')
    expect(storage.getItem(THEME_MODE_STORAGE_KEY)).toBe('system')
    expect(nextThemeMode('system')).toBe('light')
    expect(nextThemeMode('light')).toBe('dark')
    expect(nextThemeMode('dark')).toBe('system')

    applyThemeMode('light', document.documentElement, true)
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('treats stored light and dark as the appearance, not an inverted class toggle', () => {
    const storage = createMemoryStorage()
    writeThemeMode('light', storage)
    expect(readThemeMode(storage)).toBe('light')
    applyThemeMode(readThemeMode(storage), document.documentElement, true)
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(document.documentElement.style.colorScheme).toBe('light')

    writeThemeMode('dark', storage)
    applyThemeMode(readThemeMode(storage), document.documentElement, false)
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(document.documentElement.style.colorScheme).toBe('dark')
  })

  it('boots the stored theme from a classic script before packaged CSS', () => {
    expect(indexHtmlSource).toContain('src="/theme-boot.js"')
    expect(indexHtmlSource).not.toContain('data-theme="light"')
    expect(themeBootSource).toContain(THEME_MODE_STORAGE_KEY)
    expect(themeBootSource).toContain("root.dataset.theme = resolved")
    expect(themeBootSource).toContain("root.classList.toggle('dark', resolved === 'dark')")
    expect(mainSource).toContain('applyThemeMode(initialThemeMode)')
    expect(mainSource).toContain("syncWindowChrome(resolveThemeMode(initialThemeMode), globalThis, initialThemeMode)")
    expect(mainSource).toContain('subscribeThemeSync')

    const values = new Map<string, string>([[THEME_MODE_STORAGE_KEY, 'dark']])
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem(key: string) { return values.get(key) ?? null },
        setItem(key: string, value: string) { values.set(key, value) },
        removeItem(key: string) { values.delete(key) },
      },
    })
    window.eval(themeBootSource)
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(document.documentElement.dataset.themeMode).toBe('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(document.documentElement.style.colorScheme).toBe('dark')
  })

  it('publishes the resolved appearance for other renderer surfaces', async () => {
    const seen: Array<{ mode: string; resolved: string }> = []
    const stop = subscribeThemeSync((mode, resolved) => {
      seen.push({ mode, resolved })
    })
    const posted = publishThemeSync('dark', false)
    expect(posted).toEqual({ mode: 'dark', resolved: 'dark' })
    await new Promise<void>(resolve => {
      if (typeof BroadcastChannel !== 'function') {
        resolve()
        return
      }
      window.setTimeout(resolve, 0)
    })
    if (typeof BroadcastChannel === 'function') {
      expect(seen).toContainEqual({ mode: 'dark', resolved: 'dark' })
    }
    stop()
    expect(THEME_SYNC_CHANNEL).toBe('milksu.theme-sync')
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
