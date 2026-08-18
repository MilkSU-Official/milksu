import { describe, expect, it } from 'vitest'
import {
  CODING_RAIL_MAX_WIDTH,
  CODING_RAIL_MIN_WIDTH,
  CODING_RAIL_WIDTH_KEY,
  clampCodingRailWidth,
  parseCodingRailWidth,
  readCodingRailWidth,
  writeCodingRailWidth,
} from './codingRailWidth'

describe('codingRailWidth', () => {
  it('clamps saved rail widths to the visible range', () => {
    expect(clampCodingRailWidth(120)).toBe(CODING_RAIL_MIN_WIDTH)
    expect(clampCodingRailWidth(2400)).toBe(CODING_RAIL_MAX_WIDTH)
    expect(clampCodingRailWidth(400.8)).toBe(401)
    expect(parseCodingRailWidth('not-a-number')).toBeNull()
  })

  it('reads and writes the persisted rail width', () => {
    const store = new Map<string, string>()
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value)
      },
    }
    expect(readCodingRailWidth(storage)).toBeNull()
    expect(writeCodingRailWidth(512, storage)).toBe(512)
    expect(store.get(CODING_RAIL_WIDTH_KEY)).toBe('512')
    expect(readCodingRailWidth(storage)).toBe(512)
  })
})
