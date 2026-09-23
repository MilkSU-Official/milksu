import { describe, expect, it } from 'vitest'
import { filterCompanionMemories, sortCompanionMemoriesNewestFirst } from './companionMemory'

const rows = [
  { id: 'mem_a', title: '称呼', markdown: '称呼用户 Milk', evidence: '叫我 Milk', at: '2026-09-01T00:00:00Z' },
  { id: 'mem_b', title: '语言', markdown: '用简体中文回复', evidence: '以后都用中文', at: '2026-09-23T00:00:00Z' },
]

describe('companion memory list', () => {
  it('sorts newest first and filters by the quote', () => {
    expect(sortCompanionMemoriesNewestFirst(rows).map(item => item.id)).toEqual(['mem_b', 'mem_a'])
    expect(filterCompanionMemories(rows, '叫我').map(item => item.id)).toEqual(['mem_a'])
    expect(filterCompanionMemories(rows, '简体').map(item => item.id)).toEqual(['mem_b'])
    expect(filterCompanionMemories(rows, '  ').map(item => item.id)).toEqual(['mem_a', 'mem_b'])
  })
})
