// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import type { NSSCTFCatalogSearchResult } from '@/nssctfTrainingTypes'

const { invokeCommand } = vi.hoisted(() => ({
  invokeCommand: vi.fn(),
}))

vi.mock('@/desktop', () => ({
  invokeCommand,
}))

function problem(platformId: number) {
  return {
    platformId,
    sourceUrl: `https://www.nssctf.cn/problem/${platformId}`,
    title: `题目 ${platformId}`,
    category: 'Web',
    points: 100,
    difficulty: 1,
    tags: [],
    hasWriteup: false,
    solvedCount: 0,
    wrongAnswerCount: 0,
    noAnswerCount: 0,
    open: true,
    syncedAt: '2026-08-17T00:00:00Z',
  }
}

function result(platformId: number): NSSCTFCatalogSearchResult {
  return {
    problems: [problem(platformId)],
    categories: ['Web'],
    attemptedProblemIds: [],
    completedProblemIds: [],
    total: 1,
    page: 1,
    pageSize: 20,
    pageCount: 1,
  }
}

function fullCatalogResult(platformIds: number[], categories: string[] = ['Web']): NSSCTFCatalogSearchResult {
  return {
    problems: platformIds.map(problem),
    categories,
    attemptedProblemIds: [],
    completedProblemIds: [],
    total: platformIds.length,
    page: 1,
    pageSize: 0,
    pageCount: 1,
  }
}

const makeQuery = (value: string) => ({
  query: value,
  category: 'all',
  page: 1,
  pageSize: 20 as const,
})

describe('useNSSCTFCatalog', () => {
  beforeEach(() => {
    vi.resetModules()
    invokeCommand.mockReset()
  })

  async function freshModule() {
    return import('./useNSSCTFTraining')
  }

  it('returns cached results without issuing another desktop query', async () => {
    const first = result(101)
    invokeCommand.mockImplementation(async (command: string, args?: unknown) => {
      if (command === 'list_nssctf_catalog') {
        const query = (args as { query: { pageSize: number } }).query
        if (query.pageSize === 0) return fullCatalogResult([101])
        return first
      }
      throw new Error(`unexpected command: ${command}`)
    })
    const catalog = (await freshModule()).useNSSCTFCatalog()

    await catalog.search(makeQuery('收藏'))
    await catalog.search(makeQuery('收藏'))

    expect(invokeCommand).toHaveBeenCalledOnce()
    expect(catalog.result.value?.problems[0]?.platformId).toBe(101)
  })

  it('keeps the visible result while a new search query is pending', async () => {
    const first = result(101)
    let resolveNext!: (value: NSSCTFCatalogSearchResult) => void
    invokeCommand
      .mockImplementationOnce(() => Promise.resolve(first))
      .mockImplementationOnce(() => new Promise(resolve => { resolveNext = resolve }))
    const catalog = (await freshModule()).useNSSCTFCatalog()

    await catalog.search(makeQuery('web'))
    const pending = catalog.search(makeQuery('sql'))
    await nextTick()

    expect(catalog.result.value?.problems[0]?.platformId).toBe(101)
    expect(catalog.loading.value).toBe(true)

    resolveNext(result(202))
    await pending
    expect(catalog.result.value?.problems[0]?.platformId).toBe(202)
  })

  it('does not let an older response replace the latest filter result', async () => {
    let resolveOld!: (value: NSSCTFCatalogSearchResult) => void
    let resolveCurrent!: (value: NSSCTFCatalogSearchResult) => void
    invokeCommand
      .mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve }))
      .mockImplementationOnce(() => new Promise(resolve => { resolveCurrent = resolve }))
    const catalog = (await freshModule()).useNSSCTFCatalog()

    const oldRequest = catalog.search(makeQuery('旧'))
    const currentRequest = catalog.search(makeQuery('当前'))
    resolveCurrent(result(303))
    await currentRequest
    resolveOld(result(404))
    await oldRequest

    expect(catalog.result.value?.problems[0]?.platformId).toBe(303)
  })

  it('serves collection filter switches from the local full catalog without RPC', async () => {
    const full = fullCatalogResult([101, 202, 303, 404])
    invokeCommand.mockImplementation(async (command: string) => {
      if (command === 'list_nssctf_catalog') return full
      throw new Error(`unexpected command: ${command}`)
    })
    const catalog = (await freshModule()).useNSSCTFCatalog()

    await catalog.ensureLoaded()
    invokeCommand.mockClear()

    const result = await catalog.search({ query: '', category: 'all', page: 1, pageSize: 20, problemIds: [303, 101] })
    expect(result?.problems.map(item => item.platformId).sort()).toEqual([101, 303])
    expect(invokeCommand).not.toHaveBeenCalled()
    expect(catalog.loading.value).toBe(false)
  })

  it('pages locally when a collection has more problems than one page', async () => {
    const full = fullCatalogResult([...Array.from({ length: 25 }, (_, index) => 1000 + index)])
    invokeCommand.mockImplementation(async (command: string) => {
      if (command === 'list_nssctf_catalog') return full
      throw new Error(`unexpected command: ${command}`)
    })
    const catalog = (await freshModule()).useNSSCTFCatalog()
    await catalog.ensureLoaded()
    invokeCommand.mockClear()

    const pageOne = await catalog.search({ query: '', category: 'all', page: 1, pageSize: 20, problemIds: undefined })
    const pageTwo = await catalog.search({ query: '', category: 'all', page: 2, pageSize: 20, problemIds: undefined })
    expect(pageOne?.problems).toHaveLength(20)
    expect(pageOne?.total).toBe(25)
    expect(pageOne?.pageCount).toBe(2)
    expect(pageTwo?.problems).toHaveLength(5)
    expect(invokeCommand).not.toHaveBeenCalled()
  })

  it('still queries the backend for keyword search', async () => {
    const full = fullCatalogResult([101])
    const searched = fullCatalogResult([101], [])
    invokeCommand.mockImplementation(async (command: string, args?: unknown) => {
      if (command === 'list_nssctf_catalog') {
        const query = (args as { query: { pageSize: number } }).query
        if (query.pageSize === 0) return full
        return searched
      }
      throw new Error(`unexpected command: ${command}`)
    })
    const catalog = (await freshModule()).useNSSCTFCatalog()
    await catalog.ensureLoaded()
    invokeCommand.mockClear()

    const result = await catalog.search({ query: 'web', category: 'all', page: 1, pageSize: 20 })
    expect(result?.problems.map(item => item.platformId)).toEqual([101])
    expect(invokeCommand).toHaveBeenCalledTimes(1)
  })
})