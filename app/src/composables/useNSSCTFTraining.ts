import { createStore } from '@/lib/reactStore'
import { invokeCommand } from '@/desktop'
import {
  debugLog,
  recordCacheHit,
  recordLocalHit,
  updateDebugState,
} from '@/lib/debugMode'
import type {
  NSSCTFCatalogQuery,
  NSSCTFCatalogSearchResult,
  NSSCTFCatalogSyncResult,
  NSSCTFTrainingDashboard,
} from '@/nssctfTrainingTypes'

const CATALOG_URL = 'https://www.nssctf.cn/problem'

const FULL_CATALOG_QUERY: NSSCTFCatalogQuery = {
  query: '',
  category: 'all',
  page: 1,
  pageSize: 20,
  unpaged: true,
}

const trainingStore = createStore({
  dashboard: null as NSSCTFTrainingDashboard | null,
  dashboardLoading: false,
  dashboardSyncing: false,
  dashboardError: null as string | null,
  fullCatalog: null as NSSCTFCatalogSearchResult | null,
  trainingProgress: null as {
    attemptedProblemIds: number[]
    completedProblemIds: number[]
  } | null,
})
const ts = {
  get dashboard() { return trainingStore.getState().dashboard },
  set dashboard(value) { trainingStore.setState({ dashboard: value }) },
  get dashboardLoading() { return trainingStore.getState().dashboardLoading },
  set dashboardLoading(value) { trainingStore.setState({ dashboardLoading: value }) },
  get dashboardSyncing() { return trainingStore.getState().dashboardSyncing },
  set dashboardSyncing(value) { trainingStore.setState({ dashboardSyncing: value }) },
  get dashboardError() { return trainingStore.getState().dashboardError },
  set dashboardError(value) { trainingStore.setState({ dashboardError: value }) },
  get fullCatalog() { return trainingStore.getState().fullCatalog },
  set fullCatalog(value) { trainingStore.setState({ fullCatalog: value }) },
  get trainingProgress() { return trainingStore.getState().trainingProgress },
  set trainingProgress(value) { trainingStore.setState({ trainingProgress: value }) },
}
const catalogSearchCache = new Map<string, NSSCTFCatalogSearchResult>()

let fullCatalogGeneration = 0
let fullCatalogLoad: Promise<NSSCTFCatalogSearchResult | null> | null = null

function catalogSearchKey(query: NSSCTFCatalogQuery) {
  return JSON.stringify({
    query: query.query.trim(),
    category: query.category,
    page: query.page,
    pageSize: query.pageSize,
    unpaged: query.unpaged === true,
    problemIds: query.problemIds ? [...query.problemIds].sort((left, right) => left - right) : undefined,
  })
}

function isLocalCatalogQuery(query: NSSCTFCatalogQuery) {
  return query.query.trim() === '' && (query.category === '' || query.category === 'all') && query.unpaged !== true
}

function withCurrentProgress(result: NSSCTFCatalogSearchResult): NSSCTFCatalogSearchResult {
  if (!ts.trainingProgress) return result
  return {
    ...result,
    attemptedProblemIds: ts.trainingProgress.attemptedProblemIds,
    completedProblemIds: ts.trainingProgress.completedProblemIds,
  }
}

function rememberProgress(result: NSSCTFCatalogSearchResult) {
  ts.trainingProgress = {
    attemptedProblemIds: result.attemptedProblemIds,
    completedProblemIds: result.completedProblemIds,
  }
}

function invalidateFullCatalog() {
  fullCatalogGeneration += 1
  ts.fullCatalog = null
  fullCatalogLoad = null
}

async function loadFullCatalog() {
  if (ts.fullCatalog) return ts.fullCatalog
  if (fullCatalogLoad) return fullCatalogLoad

  const generation = fullCatalogGeneration
  const started = Date.now()
  const pending = (async (): Promise<NSSCTFCatalogSearchResult | null> => {
    try {
      const result = await invokeCommand<NSSCTFCatalogSearchResult>('list_nssctf_catalog', {
        query: FULL_CATALOG_QUERY,
      })
      if (generation !== fullCatalogGeneration) {
        return fullCatalogLoad ?? ts.fullCatalog
      }
      ts.fullCatalog = result
      rememberProgress(result)
      clearCatalogSearchCache()
      updateDebugState({
        fullCatalogReady: true,
        fullCatalogProblems: result.problems.length,
      })
      debugLog('full-catalog-loaded', `${result.problems.length} problems`, Date.now() - started)
      return result
    } catch {
      if (generation !== fullCatalogGeneration) {
        return fullCatalogLoad ?? ts.fullCatalog
      }
      return null
    }
  })()

  fullCatalogLoad = pending
  try {
    return await pending
  } finally {
    if (fullCatalogLoad === pending) fullCatalogLoad = null
  }
}

async function refreshTrainingProgressSnapshot() {
  const generation = fullCatalogGeneration
  const started = Date.now()
  try {
    const result = await invokeCommand<NSSCTFCatalogSearchResult>('list_nssctf_catalog', {
      query: FULL_CATALOG_QUERY,
    })
    if (generation !== fullCatalogGeneration) return ts.trainingProgress
    rememberProgress(result)
    if (ts.fullCatalog) {
      ts.fullCatalog = {
        ...ts.fullCatalog,
        attemptedProblemIds: result.attemptedProblemIds,
        completedProblemIds: result.completedProblemIds,
      }
    }
    updateDebugState({
      fullCatalogReady: Boolean(ts.fullCatalog),
      fullCatalogProblems: ts.fullCatalog?.problems.length ?? result.problems.length,
    })
    debugLog('training-progress-refreshed', `${result.completedProblemIds.length} completed`, Date.now() - started)
    return ts.trainingProgress
  } catch {
    return ts.trainingProgress
  }
}

function applyLocalCatalogSearch(query: NSSCTFCatalogQuery, full: NSSCTFCatalogSearchResult) {
  const wanted = new Set(query.problemIds ?? [])
  const filtered = query.problemIds
    ? full.problems.filter(problem => wanted.has(problem.platformId))
    : full.problems
  const pageSize = query.pageSize || 20
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const page = Math.min(Math.max(1, query.page), pageCount)
  return withCurrentProgress({
    problems: filtered.slice((page - 1) * pageSize, page * pageSize),
    categories: full.categories,
    attemptedProblemIds: full.attemptedProblemIds,
    completedProblemIds: full.completedProblemIds,
    total: filtered.length,
    page,
    pageSize,
    pageCount,
  })
}

function clearCatalogSearchCache() {
  catalogSearchCache.clear()
}

export function useNSSCTFTraining() {
  async function load() {
    ts.dashboardLoading = true
    try {
      ts.dashboard = await invokeCommand<NSSCTFTrainingDashboard>('get_nssctf_training_dashboard')
      ts.dashboardError = null
      return ts.dashboard
    } catch (reason) {
      ts.dashboardError = reason instanceof Error ? reason.message : String(reason)
      return null
    } finally {
      ts.dashboardLoading = false
    }
  }

  async function sync() {
    ts.dashboardSyncing = true
    try {
      const result = await invokeCommand<NSSCTFCatalogSyncResult>('sync_nssctf_catalog', {
        url: CATALOG_URL,
      })
      clearCatalogSearchCache()
      invalidateFullCatalog()
      void loadFullCatalog()
      await load()
      ts.dashboardError = null
      return result
    } catch (reason) {
      ts.dashboardError = reason instanceof Error ? reason.message : String(reason)
      return null
    } finally {
      ts.dashboardSyncing = false
    }
  }

  return {
    store: trainingStore,
    get dashboard() { return ts.dashboard },
    get loading() { return ts.dashboardLoading },
    get syncing() { return ts.dashboardSyncing },
    get error() { return ts.dashboardError },
    load,
    sync,
  }
}

export function useNSSCTFCatalog() {
  const store = createStore({
    result: null as NSSCTFCatalogSearchResult | null,
    loading: false,
    error: null as string | null,
  })
  const s = {
    get result() { return store.getState().result },
    set result(value) { store.setState({ result: value }) },
    get loading() { return store.getState().loading },
    set loading(value) { store.setState({ loading: value }) },
    get error() { return store.getState().error },
    set error(value) { store.setState({ error: value }) }
  }

  let requestGeneration = 0

  async function search(query: NSSCTFCatalogQuery) {
    const generation = ++requestGeneration
    const locallyServiceable = isLocalCatalogQuery(query)
    const full = locallyServiceable ? ts.fullCatalog : null
    if (full) {
      const next = applyLocalCatalogSearch(query, full)
      s.result = next
      s.error = null
      s.loading = false
      recordLocalHit()
      updateDebugState({
        fullCatalogReady: true,
        fullCatalogProblems: full.problems.length,
        collectionProblems: next.total,
      })
      debugLog('catalog-search', `local view=${query.problemIds ? 'collection' : 'all'} ${next.total} visible`)
      return next
    }
    const key = catalogSearchKey(query)
    const cached = catalogSearchCache.get(key)
    if (cached) {
      s.result = withCurrentProgress(cached)
      s.error = null
      s.loading = false
      recordCacheHit()
      debugLog('catalog-search', 'cache hit')
      return s.result
    }

    s.loading = true
    if (locallyServiceable) void loadFullCatalog()
    try {
      const next = await invokeCommand<NSSCTFCatalogSearchResult>('list_nssctf_catalog', {
        query,
      })
      if (generation !== requestGeneration) return s.result
      catalogSearchCache.set(key, next)
      s.result = withCurrentProgress(next)
      s.error = null
      return s.result
    } catch (reason) {
      if (generation === requestGeneration) {
        s.error = reason instanceof Error ? reason.message : String(reason)
      }
      return null
    } finally {
      if (generation === requestGeneration) s.loading = false
    }
  }

  return {
    store,
    get result() { return s.result },
    set result(value) { s.result = value },
    get loading() { return s.loading },
    set loading(value) { s.loading = value },
    get error() { return s.error },
    set error(value) { s.error = value },
    search,
    ensureLoaded: loadFullCatalog,
    refreshProgress: refreshTrainingProgressSnapshot,
  }
}
