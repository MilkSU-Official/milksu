// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import {
  FACTORY_PROJECT_FOLD_LIMIT,
  applyProjectFoldLimit,
  normalizeProjectFoldLimit,
  readStoredProjectFoldLimit,
} from '@/lib/projectFoldLimit'

describe('normalizeProjectFoldLimit', () => {
  it('非法值与越界值回出厂默认 5', () => {
    for (const value of [undefined, null, '', 'abc', 0, -2, 21, 1.5, Number.NaN]) {
      expect(normalizeProjectFoldLimit(value)).toBe(FACTORY_PROJECT_FOLD_LIMIT)
    }
  })

  it('1 到 20 的整数原样保留', () => {
    expect(normalizeProjectFoldLimit(1)).toBe(1)
    expect(normalizeProjectFoldLimit(3)).toBe(3)
    expect(normalizeProjectFoldLimit('5')).toBe(5)
    expect(normalizeProjectFoldLimit(20)).toBe(20)
  })
})

describe('applyProjectFoldLimit / readStoredProjectFoldLimit', () => {
  it('写入后读回同一个值', () => {
    applyProjectFoldLimit(3)
    expect(readStoredProjectFoldLimit()).toBe(3)
    applyProjectFoldLimit(99)
    expect(readStoredProjectFoldLimit()).toBe(FACTORY_PROJECT_FOLD_LIMIT)
    applyProjectFoldLimit(FACTORY_PROJECT_FOLD_LIMIT)
  })
})
