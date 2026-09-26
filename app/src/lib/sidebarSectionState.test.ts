import { describe, expect, it } from 'vitest'
import {
  readSidebarSectionOpen,
  SIDEBAR_SECTION_STATE_PREFIX,
  writeSidebarSectionOpen,
} from '@/lib/sidebarSectionState'

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    values,
  }
}

describe('sidebarSectionState', () => {
  it('默认展开，未写过时读回 true', () => {
    expect(readSidebarSectionOpen('projects', memoryStorage())).toBe(true)
  })

  it('写入 0 后读回 false，写回 1 后读回 true', () => {
    const storage = memoryStorage()
    writeSidebarSectionOpen('tasks', false, storage)
    expect(storage.values.get(SIDEBAR_SECTION_STATE_PREFIX + 'tasks')).toBe('0')
    expect(readSidebarSectionOpen('tasks', storage)).toBe(false)
    writeSidebarSectionOpen('tasks', true, storage)
    expect(readSidebarSectionOpen('tasks', storage)).toBe(true)
  })

  it('不同组互不影响', () => {
    const storage = memoryStorage()
    writeSidebarSectionOpen('projects', false, storage)
    expect(readSidebarSectionOpen('projects', storage)).toBe(false)
    expect(readSidebarSectionOpen('tasks', storage)).toBe(true)
  })

  it('storage 抛错时按默认展开处理', () => {
    const throwing = {
      getItem: () => { throw new Error('denied') },
      setItem: () => { throw new Error('denied') },
    }
    expect(readSidebarSectionOpen('projects', throwing)).toBe(true)
    writeSidebarSectionOpen('projects', false, throwing)
  })
})
