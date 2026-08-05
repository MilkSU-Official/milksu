import { ref } from 'vue'
import { invokeCommand } from '@/desktop'
import type {
  CTFShowCatalogStatus,
  CTFShowChallengeWorkspace,
  CTFShowWebSubmission,
} from '@/ctfshowTypes'
import type { CTFCollaborationMode, CTFMaterialRequest } from '@/ctfTypes'

export function useCTFShowCatalog() {
  const status = ref<CTFShowCatalogStatus | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function refresh() {
    loading.value = true
    try {
      status.value = await invokeCommand<CTFShowCatalogStatus>('get_ctfshow_catalog_status')
      error.value = null
      return status.value
    } catch (reason) {
      error.value = reason instanceof Error ? reason.message : String(reason)
      return null
    } finally {
      loading.value = false
    }
  }

  async function importChallenge(
    problemId: number,
    collaborationMode: CTFCollaborationMode,
    localMaterials: CTFMaterialRequest[] = [],
  ) {
    loading.value = true
    try {
      const workspace = await invokeCommand<CTFShowChallengeWorkspace>('import_ctfshow_challenge', {
        problemId,
        collaborationMode,
        localMaterials,
      })
      error.value = null
      return workspace
    } catch (reason) {
      error.value = reason instanceof Error ? reason.message : String(reason)
      return null
    } finally {
      loading.value = false
    }
  }

  async function submitFlag(jobId: string, candidate: string) {
    loading.value = true
    try {
      const submission = await invokeCommand<CTFShowWebSubmission>(
        'submit_ctfshow_web_flag',
        { jobId, candidate },
      )
      error.value = null
      return submission
    } catch (reason) {
      error.value = reason instanceof Error ? reason.message : String(reason)
      return null
    } finally {
      loading.value = false
    }
  }

  return {
    status,
    loading,
    error,
    refresh,
    open: (url = '') => invokeCommand('open_ctfshow_challenges', { url }),
    importChallenge,
    submitFlag,
  }
}
