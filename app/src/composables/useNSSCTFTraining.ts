import { ref } from 'vue'
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

const dashboard = ref<NSSCTFTrainingDashboard | null>(null)
const dashboardLoading = ref(false)
const dashboardSyncing = ref(false)
const dashboardError = ref<string | null>(null)
const catalogSearchCache = new Map<string, NSSCTFCatalogSearchResult>()
const fullCatalog = ref<NSSCTFCatalogSearchResult | null>(null)
const trainingProgress = ref<{
  attemptedProblemIds: number[]
  completedProblemIds: number[]
} | null>(null)

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
  if (!trainingProgress.value) return result
  return {
    ...result,
    attemptedProblemIds: trainingProgress.value.attemptedProblemIds,
    completedProblemIds: trainingProgress.value.completedProblemIds,
  }
}

function rememberProgress(result: NSSCTFCatalogSearchResult) {
  trainingProgress.value = {
    attemptedProblemIds: result.attemptedProblemIds,
    completedProblemIds: result.completedProblemIds,
  }
}

function invalidateFullCatalog() {
  fullCatalogGeneration += 1
  fullCatalog.value = null
  fullCatalogLoad = null
}

async function loadFullCatalog() {
  if (fullCatalog.value) return fullCatalog.value
  if (fullCatalogLoad) return fullCatalogLoad

  const generation = fullCatalogGeneration
  const started = Date.now()
  const pending = (async (): Promise<NSSCTFCatalogSearchResult | null> => {
    try {
      const result = await invokeCommand<NSSCTFCatalogSearchResult>('list_nssctf_catalog', {
        query: FULL_CATALOG_QUERY,
      })
      if (generation !== fullCatalogGeneration) {
        return fullCatalogLoad ?? fullCatalog.value
      }
      fullCatalog.value = result
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
        return fullCatalogLoad ?? fullCatalog.value
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
    if (generation !== fullCatalogGeneration) return trainingProgress.value
    rememberProgress(result)
    if (fullCatalog.value) {
      fullCatalog.value = {
        ...fullCatalog.value,
        attemptedProblemIds: result.attemptedProblemIds,
        completedProblemIds: result.completedProblemIds,
      }
    }
    updateDebugState({
      fullCatalogReady: Boolean(fullCatalog.value),
      fullCatalogProblems: fullCatalog.value?.problems.length ?? result.problems.length,
    })
    debugLog('training-progress-refreshed', `${result.completedProblemIds.length} completed`, Date.now() - started)
    return trainingProgress.value
  } catch {
    return trainingProgress.value
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
    dashboardLoading.value = true
    try {
      dashboard.value = await invokeCommand<NSSCTFTrainingDashboard>('get_nssctf_training_dashboard')
      dashboardError.value = null
      return dashboard.value
    } catch (reason) {
      dashboardError.value = reason instanceof Error ? reason.message : String(reason)
      return null
    } finally {
      dashboardLoading.value = false
    }
  }

  async function sync() {
    dashboardSyncing.value = true
    try {
      const result = await invokeCommand<NSSCTFCatalogSyncResult>('sync_nssctf_catalog', {
        url: CATALOG_URL,
      })
      clearCatalogSearchCache()
      invalidateFullCatalog()
      void loadFullCatalog()
      await load()
      dashboardError.value = null
      return result
    } catch (reason) {
      dashboardError.value = reason instanceof Error ? reason.message : String(reason)
      return null
    } finally {
      dashboardSyncing.value = false
    }
  }

  return {
    dashboard,
    loading: dashboardLoading,
    syncing: dashboardSyncing,
    error: dashboardError,
    load,
    sync,
  }
}

export function useNSSCTFCatalog() {
  const result = ref<NSSCTFCatalogSearchResult | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  let requestGeneration = 0

  async function search(query: NSSCTFCatalogQuery) {
    const generation = ++requestGeneration
    const locallyServiceable = isLocalCatalogQuery(query)
    const full = locallyServiceable ? fullCatalog.value : null
    if (full) {
      const next = applyLocalCatalogSearch(query, full)
      result.value = next
      error.value = null
      loading.value = false
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
      result.value = withCurrentProgress(cached)
      error.value = null
      loading.value = false
      recordCacheHit()
      debugLog('catalog-search', 'cache hit')
      return result.value
    }

    loading.value = true
    if (locallyServiceable) void loadFullCatalog()
    try {
      const next = await invokeCommand<NSSCTFCatalogSearchResult>('list_nssctf_catalog', {
        query,
      })
      if (generation !== requestGeneration) return result.value
      catalogSearchCache.set(key, next)
      result.value = withCurrentProgress(next)
      error.value = null
      return result.value
    } catch (reason) {
      if (generation === requestGeneration) {
        error.value = reason instanceof Error ? reason.message : String(reason)
      }
      return null
    } finally {
      if (generation === requestGeneration) loading.value = false
    }
  }

  return {
    result,
    loading,
    error,
    search,
    ensureLoaded: loadFullCatalog,
    refreshProgress: refreshTrainingProgressSnapshot,
  }
}
