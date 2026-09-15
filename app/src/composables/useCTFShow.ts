import { createStore } from '@/lib/reactStore'
import { invokeCommand } from '@/desktop'
import type {
  CTFShowCatalogStatus,
  CTFShowChallengeWorkspace,
  CTFShowWebSubmission,
} from '@/ctfshowTypes'
import type { CTFCollaborationMode, CTFMaterialRequest } from '@/ctfTypes'

export function useCTFShowCatalog() {
  const store = createStore({
    status: null as CTFShowCatalogStatus | null,
    loading: false,
    error: null as string | null,
  })
  const s = {
    get status() { return store.getState().status },
    set status(value) { store.setState({ status: value }) },
    get loading() { return store.getState().loading },
    set loading(value) { store.setState({ loading: value }) },
    get error() { return store.getState().error },
    set error(value) { store.setState({ error: value }) }
  }


  async function refresh() {
    s.loading = true
    try {
      s.status = await invokeCommand<CTFShowCatalogStatus>('get_ctfshow_catalog_status')
      s.error = null
      return s.status
    } catch (reason) {
      s.error = reason instanceof Error ? reason.message : String(reason)
      return null
    } finally {
      s.loading = false
    }
  }

  async function importChallenge(
    problemId: number,
    collaborationMode: CTFCollaborationMode,
    localMaterials: CTFMaterialRequest[] = [],
  ) {
    s.loading = true
    try {
      const workspace = await invokeCommand<CTFShowChallengeWorkspace>('import_ctfshow_challenge', {
        problemId,
        collaborationMode,
        localMaterials,
      })
      s.error = null
      return workspace
    } catch (reason) {
      s.error = reason instanceof Error ? reason.message : String(reason)
      return null
    } finally {
      s.loading = false
    }
  }

  async function submitFlag(jobId: string, candidate: string) {
    s.loading = true
    try {
      const submission = await invokeCommand<CTFShowWebSubmission>(
        'submit_ctfshow_web_flag',
        { jobId, candidate },
      )
      s.error = null
      return submission
    } catch (reason) {
      s.error = reason instanceof Error ? reason.message : String(reason)
      return null
    } finally {
      s.loading = false
    }
  }

  return {
    store,
    get status() { return s.status },
    set status(value) { s.status = value },
    get loading() { return s.loading },
    set loading(value) { s.loading = value },
    get error() { return s.error },
    set error(value) { s.error = value },
    refresh,
    open: (url = '') => invokeCommand('open_ctfshow_challenges', { url }),
    importChallenge,
    submitFlag,
  }
}
