import { describe, expect, it } from 'vitest'
import {
  CODING_TERMINAL_DEFAULT_HEIGHT,
  CODING_TERMINAL_HEIGHT_KEY,
  CODING_TERMINAL_MIN_HEIGHT,
  clampCodingTerminalHeight,
  parseCodingTerminalHeight,
  readCodingTerminalHeight,
  writeCodingTerminalHeight,
} from './codingTerminalHeight'

describe('codingTerminalHeight', () => {
  it('clamps saved terminal heights to the visible range', () => {
    expect(clampCodingTerminalHeight(80, 900)).toBe(CODING_TERMINAL_MIN_HEIGHT)
    expect(clampCodingTerminalHeight(2400, 900)).toBe(648)
    expect(clampCodingTerminalHeight(321.6, 900)).toBe(322)
    expect(parseCodingTerminalHeight('not-a-number')).toBeNull()
  })

  it('reads and writes the persisted terminal height', () => {
    const store = new Map<string, string>()
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value)
      },
    }
    expect(readCodingTerminalHeight(storage, 900)).toBe(CODING_TERMINAL_DEFAULT_HEIGHT)
    expect(writeCodingTerminalHeight(400, storage, 900)).toBe(400)
    expect(store.get(CODING_TERMINAL_HEIGHT_KEY)).toBe('400')
    expect(readCodingTerminalHeight(storage, 900)).toBe(400)
  })
})
