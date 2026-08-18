import { ref } from 'vue'
import { invokeCommand } from '@/desktop'
import type {
  NSSCTFCatalogQuery,
  NSSCTFCatalogSearchResult,
  NSSCTFCatalogSyncResult,
  NSSCTFTrainingDashboard,
} from '@/nssctfTrainingTypes'

const CATALOG_URL = 'https://www.nssctf.cn/problem'

const dashboard = ref<NSSCTFTrainingDashboard | null>(null)
const dashboardLoading = ref(false)
const dashboardSyncing = ref(false)
const dashboardError = ref<string | null>(null)
const catalogSearchCache = new Map<string, NSSCTFCatalogSearchResult>()
const fullCatalog = ref<NSSCTFCatalogSearchResult | null>(null)
const fullCatalogLoading = ref(false)

function catalogSearchKey(query: NSSCTFCatalogQuery) {
  return JSON.stringify({
    query: query.query.trim(),
    category: query.category,
    page: query.page,
    pageSize: query.pageSize,
    problemIds: query.problemIds ? [...query.problemIds].sort((left, right) => left - right) : undefined,
  })
}

function isLocalCatalogQuery(query: NSSCTFCatalogQuery) {
  return query.query.trim() === '' && (query.category === '' || query.category === 'all')
}

async function loadFullCatalog() {
  if (fullCatalog.value || fullCatalogLoading.value) return fullCatalog.value
  fullCatalogLoading.value = true
  try {
    const result = await invokeCommand<NSSCTFCatalogSearchResult>('list_nssctf_catalog', {
      query: { query: '', category: 'all', page: 1, pageSize: 0 },
    })
    fullCatalog.value = result
    clearCatalogSearchCache()
    return result
  } finally {
    fullCatalogLoading.value = false
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
  return {
    problems: filtered.slice((page - 1) * pageSize, page * pageSize),
    categories: full.categories,
    attemptedProblemIds: full.attemptedProblemIds,
    completedProblemIds: full.completedProblemIds,
    total: filtered.length,
    page,
    pageSize,
    pageCount,
  }
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
      fullCatalog.value = null
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
      result.value = applyLocalCatalogSearch(query, full)
      error.value = null
      loading.value = false
      return result.value
    }
    const key = catalogSearchKey(query)
    const cached = catalogSearchCache.get(key)
    if (cached) {
      result.value = cached
      error.value = null
      loading.value = false
      return cached
    }

    loading.value = true
    if (locallyServiceable) void loadFullCatalog()
    try {
      const next = await invokeCommand<NSSCTFCatalogSearchResult>('list_nssctf_catalog', {
        query,
      })
      catalogSearchCache.set(key, next)
      if (generation === requestGeneration) {
        result.value = next
        error.value = null
      }
      return next
    } catch (reason) {
      if (generation === requestGeneration) {
        error.value = reason instanceof Error ? reason.message : String(reason)
      }
      return null
    } finally {
      if (generation === requestGeneration) loading.value = false
    }
  }

  return { result, loading, error, search, ensureLoaded: loadFullCatalog }
}
