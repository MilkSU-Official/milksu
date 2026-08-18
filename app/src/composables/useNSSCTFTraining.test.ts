// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import type { NSSCTFCatalogQuery, NSSCTFCatalogSearchResult, NSSCTFTrainingDashboard } from '@/nssctfTrainingTypes'

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

function result(platformId: number, page = 1): NSSCTFCatalogSearchResult {
  return {
    problems: [problem(platformId)],
    categories: ['Web'],
    attemptedProblemIds: [],
    completedProblemIds: [],
    total: 1,
    page,
    pageSize: 20,
    pageCount: 1,
  }
}

function fullCatalogResult(
  platformIds: number[],
  categories: string[] = ['Web'],
  progress: { attemptedProblemIds?: number[]; completedProblemIds?: number[] } = {},
): NSSCTFCatalogSearchResult {
  return {
    problems: platformIds.map(problem),
    categories,
    attemptedProblemIds: progress.attemptedProblemIds ?? [],
    completedProblemIds: progress.completedProblemIds ?? [],
    total: platformIds.length,
    page: 1,
    pageSize: 20,
    pageCount: 1,
  }
}

function dashboardStub(): NSSCTFTrainingDashboard {
  return {
    catalogTotal: 2,
    lastSyncedAt: '2026-08-18T00:00:00Z',
    overallScore: 0,
    overallConfidence: 0,
    realAttemptCount: 0,
    realSolvedCount: 0,
    judgeVerifiedSolvedCount: 0,
    userConfirmedSolvedCount: 0,
    acceptance: { requiredTracks: 6, judgeVerifiedTracks: 0, ready: false, tracks: [] },
    sources: [],
    dimensions: [],
    recommendations: [],
    series: [],
  }
}

function catalogQuery(args?: unknown): NSSCTFCatalogQuery | undefined {
  return (args as { query?: NSSCTFCatalogQuery } | undefined)?.query
}

const makeQuery = (value: string, page = 1): NSSCTFCatalogQuery => ({
  query: value,
  category: 'all',
  page,
  pageSize: 20,
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
        if (catalogQuery(args)?.unpaged) return fullCatalogResult([101])
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

  it('does not resolve a superseded search to the discarded payload', async () => {
    let resolveOld!: (value: NSSCTFCatalogSearchResult) => void
    let resolveCurrent!: (value: NSSCTFCatalogSearchResult) => void
    invokeCommand
      .mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve }))
      .mockImplementationOnce(() => new Promise(resolve => { resolveCurrent = resolve }))
    const catalog = (await freshModule()).useNSSCTFCatalog()

    const oldRequest = catalog.search(makeQuery('旧', 2))
    const currentRequest = catalog.search(makeQuery('当前', 1))
    resolveCurrent(result(303, 1))
    await currentRequest
    resolveOld(result(404, 2))
    const stale = await oldRequest

    expect(stale?.page).toBe(1)
    expect(stale?.problems[0]?.platformId).toBe(303)
    expect(catalog.result.value?.page).toBe(1)
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
        if (catalogQuery(args)?.unpaged) return full
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

  it('lets concurrent ensureLoaded callers wait for the in-flight catalog', async () => {
    let resolveFull!: (value: NSSCTFCatalogSearchResult) => void
    invokeCommand.mockImplementation((command: string) => {
      if (command === 'list_nssctf_catalog') {
        return new Promise<NSSCTFCatalogSearchResult>(resolve => { resolveFull = resolve })
      }
      throw new Error(`unexpected command: ${command}`)
    })
    const catalog = (await freshModule()).useNSSCTFCatalog()

    const first = catalog.ensureLoaded()
    const second = catalog.ensureLoaded()
    expect(invokeCommand).toHaveBeenCalledTimes(1)
    resolveFull(fullCatalogResult([101, 202]))
    await expect(first).resolves.toMatchObject({ total: 2 })
    await expect(second).resolves.toMatchObject({ total: 2 })
  })

  it('discards a warmup snapshot that finishes after catalog sync', async () => {
    let resolveWarmup!: (value: NSSCTFCatalogSearchResult) => void
    let unpagedCalls = 0
    invokeCommand.mockImplementation(async (command: string, args?: unknown) => {
      if (command === 'sync_nssctf_catalog') {
        return { sourceUrl: 'https://www.nssctf.cn/problem', total: 2, pages: 1, syncedAt: '2026-08-18T00:00:00Z' }
      }
      if (command === 'get_nssctf_training_dashboard') return dashboardStub()
      if (command === 'list_nssctf_catalog' && catalogQuery(args)?.unpaged) {
        unpagedCalls += 1
        if (unpagedCalls === 1) {
          return new Promise<NSSCTFCatalogSearchResult>(resolve => { resolveWarmup = resolve })
        }
        return fullCatalogResult([201, 202])
      }
      throw new Error(`unexpected command: ${command}`)
    })
    const module = await freshModule()
    const catalog = module.useNSSCTFCatalog()
    const training = module.useNSSCTFTraining()

    const warmup = catalog.ensureLoaded()
    await training.sync()
    resolveWarmup(fullCatalogResult([101]))
    await warmup

    const loaded = await catalog.ensureLoaded()
    expect(loaded?.problems.map(item => item.platformId)).toEqual([201, 202])
    const served = await catalog.search({ query: '', category: 'all', page: 1, pageSize: 20 })
    expect(served?.problems.map(item => item.platformId)).toEqual([201, 202])
  })

  it('overlays fresh training progress onto a local catalog page', async () => {
    invokeCommand.mockImplementation(async (command: string, args?: unknown) => {
      if (command !== 'list_nssctf_catalog') throw new Error(`unexpected command: ${command}`)
      if (catalogQuery(args)?.unpaged) {
        const completed = invokeCommand.mock.calls.filter(([name]) => name === 'list_nssctf_catalog').length > 1
        return fullCatalogResult([101, 202], ['Web'], {
          attemptedProblemIds: [101],
          completedProblemIds: completed ? [101] : [],
        })
      }
      throw new Error('paged catalog should stay local')
    })
    const catalog = (await freshModule()).useNSSCTFCatalog()
    await catalog.ensureLoaded()
    const before = await catalog.search({ query: '', category: 'all', page: 1, pageSize: 20 })
    expect(before?.completedProblemIds).toEqual([])

    await catalog.refreshProgress()
    const after = await catalog.search({ query: '', category: 'all', page: 1, pageSize: 20 })
    expect(after?.completedProblemIds).toEqual([101])
    expect(catalog.result.value?.completedProblemIds).toEqual([101])
  })

  it('swallows a failed warmup instead of rejecting ensureLoaded', async () => {
    invokeCommand.mockImplementation(async (command: string) => {
      if (command === 'list_nssctf_catalog') throw new Error('catalog unavailable')
      throw new Error(`unexpected command: ${command}`)
    })
    const catalog = (await freshModule()).useNSSCTFCatalog()
    await expect(catalog.ensureLoaded()).resolves.toBeNull()
  })
})
