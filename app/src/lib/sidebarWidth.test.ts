import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  SIDEBAR_WIDTH_KEY,
  clampSidebarWidth,
  parseSidebarWidth,
  readSidebarWidth,
  writeSidebarWidth,
} from './sidebarWidth'

describe('sidebarWidth', () => {
  it('uses 224 as the minimum expanded width and a slightly wider default', () => {
    expect(MIN_SIDEBAR_WIDTH).toBe(224)
    expect(DEFAULT_SIDEBAR_WIDTH).toBeGreaterThan(MIN_SIDEBAR_WIDTH)
    expect(clampSidebarWidth(120)).toBe(MIN_SIDEBAR_WIDTH)
    expect(clampSidebarWidth(2400)).toBe(MAX_SIDEBAR_WIDTH)
    expect(clampSidebarWidth(280.4)).toBe(280)
    expect(parseSidebarWidth('not-a-number')).toBeNull()
  })

  it('reads and writes the persisted sidebar width', () => {
    const store = new Map<string, string>()
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value)
      },
    }
    expect(readSidebarWidth(storage)).toBe(DEFAULT_SIDEBAR_WIDTH)
    expect(writeSidebarWidth(300, storage)).toBe(300)
    expect(store.get(SIDEBAR_WIDTH_KEY)).toBe('300')
    expect(readSidebarWidth(storage)).toBe(300)
  })
})
