// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  applyConversationFontSize,
  CONVERSATION_FONT_SIZE_STORAGE_KEY,
  FACTORY_CONVERSATION_FONT_SIZE,
  normalizeUiFontSize,
  readStoredConversationFontSize,
  subscribeConversationFontSizeSync,
  UI_FONT_SYNC_CHANNEL,
} from './uiFonts'

describe('uiFonts', () => {
  afterEach(() => {
    const root = document.documentElement
    root.style.removeProperty('--conversation-font-size')
    window.localStorage.clear()
  })

  it('normalizes concrete px sizes and rejects out-of-range values', () => {
    expect(normalizeUiFontSize('')).toBe(FACTORY_CONVERSATION_FONT_SIZE)
    expect(normalizeUiFontSize('14')).toBe('14')
    expect(normalizeUiFontSize('14px')).toBe('14')
    expect(normalizeUiFontSize(16)).toBe('16')
    expect(normalizeUiFontSize('11')).toBe('11')
    expect(normalizeUiFontSize('18')).toBe('18')
    expect(normalizeUiFontSize('10')).toBe(FACTORY_CONVERSATION_FONT_SIZE)
    expect(normalizeUiFontSize('19')).toBe(FACTORY_CONVERSATION_FONT_SIZE)
    expect(normalizeUiFontSize('small')).toBe(FACTORY_CONVERSATION_FONT_SIZE)
    expect(normalizeUiFontSize('large')).toBe(FACTORY_CONVERSATION_FONT_SIZE)
    expect(normalizeUiFontSize('默认')).toBe(FACTORY_CONVERSATION_FONT_SIZE)
  })

  it('applies a conversation font size to the document and storage', () => {
    const size = applyConversationFontSize('16')
    expect(size).toBe('16')
    expect(document.documentElement.style.getPropertyValue('--conversation-font-size')).toBe('16px')
    expect(window.localStorage.getItem(CONVERSATION_FONT_SIZE_STORAGE_KEY)).toBe('16')
  })

  it('reads the stored size and normalizes missing values to the default', () => {
    expect(readStoredConversationFontSize()).toBe(FACTORY_CONVERSATION_FONT_SIZE)
    window.localStorage.setItem(CONVERSATION_FONT_SIZE_STORAGE_KEY, '12')
    expect(readStoredConversationFontSize()).toBe('12')
  })

  it('syncs font changes across windows without republishing', async () => {
    const seen: string[] = []
    const stop = subscribeConversationFontSizeSync(size => {
      seen.push(size)
      applyConversationFontSize(size, { sync: false })
    })
    applyConversationFontSize('17')
    await vi.waitFor(() => {
      expect(seen).toEqual(['17'])
    })
    expect(document.documentElement.style.getPropertyValue('--conversation-font-size')).toBe('17px')
    expect(UI_FONT_SYNC_CHANNEL).toBe('milksu.ui-font-sync')
    stop()
  })
})
