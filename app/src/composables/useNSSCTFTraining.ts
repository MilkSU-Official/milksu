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

  async function search(query: NSSCTFCatalogQuery) {
    loading.value = true
    try {
      result.value = await invokeCommand<NSSCTFCatalogSearchResult>('list_nssctf_catalog', {
        query,
      })
      error.value = null
      return result.value
    } catch (reason) {
      error.value = reason instanceof Error ? reason.message : String(reason)
      return null
    } finally {
      loading.value = false
    }
  }

  return { result, loading, error, search }
}
