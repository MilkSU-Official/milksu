// @vitest-environment jsdom

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  FACTORY_UI_EMPHASIS,
  UI_EMPHASIS_PRESET_IDS,
  UI_EMPHASIS_STORAGE_KEY,
  applyUiEmphasis,
  emphasisTokensFor,
  normalizeUiEmphasisPreset,
} from './uiEmphasis'

const themeBootSource = readFileSync(join(process.cwd(), 'public/theme-boot.js'), 'utf8')

describe('uiEmphasis', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-ui-emphasis')
    document.documentElement.removeAttribute('data-theme')
    document.documentElement.style.removeProperty('--emphasis')
    document.documentElement.style.removeProperty('--emphasis-foreground')
    document.documentElement.style.removeProperty('--primary')
    document.documentElement.style.removeProperty('--primary-foreground')
    document.documentElement.style.removeProperty('--ring')
    const values = new Map<string, string>()
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem(key: string) { return values.get(key) ?? null },
        setItem(key: string, value: string) { values.set(key, value) },
        removeItem(key: string) { values.delete(key) },
      },
    })
  })

  it('normalizes known presets and aliases', () => {
    expect(normalizeUiEmphasisPreset('')).toBe(FACTORY_UI_EMPHASIS)
    expect(normalizeUiEmphasisPreset('blue')).toBe('blue')
    expect(normalizeUiEmphasisPreset('purple')).toBe('violet')
    expect(normalizeUiEmphasisPreset('cyan')).toBe('teal')
    expect(normalizeUiEmphasisPreset('nope')).toBe(FACTORY_UI_EMPHASIS)
  })

  it('exposes light and dark tokens for every preset', () => {
    for (const id of UI_EMPHASIS_PRESET_IDS) {
      const dark = emphasisTokensFor(id, 'dark')
      const light = emphasisTokensFor(id, 'light')
      expect(dark.emphasis).toMatch(/^#[0-9a-f]{6}$/i)
      expect(light.emphasis).toMatch(/^#[0-9a-f]{6}$/i)
      expect(dark.foreground).toMatch(/^#[0-9a-f]{6}$/i)
      expect(light.foreground).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })

  it('applies colored emphasis and clears inline vars for default', () => {
    document.documentElement.dataset.theme = 'dark'
    applyUiEmphasis({ preset: 'blue' })
    expect(document.documentElement.dataset.uiEmphasis).toBe('blue')
    expect(document.documentElement.style.getPropertyValue('--emphasis')).toBe('#5b9fff')
    expect(document.documentElement.style.getPropertyValue('--primary')).toBe('#5b9fff')
    expect(document.documentElement.style.getPropertyValue('--primary-foreground')).toBe('#0b1220')
    expect(document.documentElement.style.getPropertyValue('--ring')).toBe('#5b9fff')
    expect(window.localStorage.getItem(UI_EMPHASIS_STORAGE_KEY)).toBe('blue')

    applyUiEmphasis({ preset: 'default' })
    expect(document.documentElement.dataset.uiEmphasis).toBe('default')
    expect(document.documentElement.style.getPropertyValue('--emphasis')).toBe('')
    expect(document.documentElement.style.getPropertyValue('--primary')).toBe('')
    expect(document.documentElement.style.getPropertyValue('--ring')).toBe('')
  })

  it('recolors when theme flips while keeping the preset', () => {
    document.documentElement.dataset.theme = 'dark'
    applyUiEmphasis({ preset: 'violet' })
    expect(document.documentElement.style.getPropertyValue('--emphasis')).toBe('#a78bfa')
    applyUiEmphasis({ theme: 'light' })
    expect(document.documentElement.dataset.uiEmphasis).toBe('violet')
    expect(document.documentElement.style.getPropertyValue('--emphasis')).toBe('#7c3aed')
  })

  it('keeps theme-boot in sync with the storage key and presets', () => {
    expect(themeBootSource).toContain(UI_EMPHASIS_STORAGE_KEY)
    expect(themeBootSource).toContain('applyStoredUiEmphasis')
    for (const id of UI_EMPHASIS_PRESET_IDS) {
      expect(themeBootSource).toContain(`${id}:`)
    }
  })
})
