import { onBeforeUnmount, onMounted, ref } from 'vue'
import { invokeCommand, listenEvent } from '@/desktop'
import type {
  CTFAgentBudgetStatus,
  CTFAgentRunCheckpoint,
  CTFChallengeRequest,
  CTFLearningRecordRequest,
  CTFProjection,
  CTFSummary,
} from '@/ctfTypes'
import type { RuntimeEvent } from '@/runtimeTypes'

/** Electron IPC cannot structured-clone Vue reactive proxies. Keep the desktop
 * boundary explicit so all CTF entry points send plain records and arrays. */
export function toDesktopCTFChallengeRequest(
  request: CTFChallengeRequest,
): CTFChallengeRequest {
  return {
    ...request,
    sourceTargets: request.sourceTargets?.map(target => ({
      kind: target.kind,
      value: target.value,
    })),
    knowledgePoints: request.knowledgePoints.map(point => String(point)),
    materials: request.materials.map(material => ({
      name: material.name,
      mediaType: material.mediaType,
      dataBase64: material.dataBase64,
      provenance: material.provenance,
      importToken: material.importToken,
      size: material.size,
      sha256: material.sha256,
    })),
  }
}

export function useCTFWorkspace() {
  const jobs = ref<CTFSummary[]>([])
  const selectedId = ref<string | null>(null)
  const projection = ref<CTFProjection | null>(null)
  const agentBudget = ref<CTFAgentBudgetStatus | null>(null)
  const agentRun = ref<CTFAgentRunCheckpoint | null>(null)
  const loading = ref(true)
  const creating = ref(false)
  const error = ref<string | null>(null)
  let refreshTimer: number | undefined
  let budgetInterval: number | undefined
  let stopListening: (() => void) | undefined

  async function loadAgentBudget(id: string | null) {
    if (!id) {
      agentBudget.value = null
      return
    }
    try {
      agentBudget.value = await invokeCommand<CTFAgentBudgetStatus>(
        'get_ctf_agent_budget_status',
        { id },
      )
    } catch {
      agentBudget.value = null
    }
  }

  async function loadAgentRun(id: string | null) {
    if (!id) {
      agentRun.value = null
      return
    }
    try {
      agentRun.value = await invokeCommand<CTFAgentRunCheckpoint | null>(
        'get_ctf_agent_run_checkpoint',
        { id },
      )
    } catch {
      agentRun.value = null
    }
  }

  async function loadAgentState(id: string | null) {
    await Promise.all([
      loadAgentBudget(id),
      loadAgentRun(id),
    ])
  }

  async function loadJobs() {
    loading.value = true
    try {
      jobs.value = await invokeCommand<CTFSummary[]>('list_ctf_jobs')
      const nextId = selectedId.value && jobs.value.some(job => job.id === selectedId.value)
        ? selectedId.value
        : jobs.value[0]?.id ?? null
      selectedId.value = nextId
      projection.value = nextId ? await invokeCommand<CTFProjection>('get_ctf_job', { id: nextId }) : null
      await loadAgentState(nextId)
      error.value = null
    } catch (reason) {
      error.value = String(reason)
    } finally {
      loading.value = false
    }
  }

  function clearError() {
    error.value = null
  }

  async function selectJob(id: string) {
    selectedId.value = id
    try {
      projection.value = await invokeCommand<CTFProjection>('get_ctf_job', { id })
      await loadAgentState(id)
      error.value = null
    } catch (reason) {
      error.value = String(reason)
    }
  }

  async function startChallenge(request: CTFChallengeRequest) {
    creating.value = true
    try {
      const started = await invokeCommand<CTFProjection>('start_ctf_challenge', {
        request: toDesktopCTFChallengeRequest(request),
      })
      selectedId.value = started.job.id
      projection.value = started
      jobs.value = await invokeCommand<CTFSummary[]>('list_ctf_jobs')
      await loadAgentState(started.job.id)
      error.value = null
      return started
    } catch (reason) {
      error.value = String(reason)
      return null
    } finally {
      creating.value = false
    }
  }

  async function recordLearning(id: string, request: CTFLearningRecordRequest) {
    try {
      projection.value = await invokeCommand<CTFProjection>('record_ctf_learning', { id, request })
      jobs.value = await invokeCommand<CTFSummary[]>('list_ctf_jobs')
      await loadAgentState(id)
      error.value = null
      return true
    } catch (reason) {
      error.value = String(reason)
      return false
    }
  }

  async function continueJob(id: string) {
    try {
      projection.value = await invokeCommand<CTFProjection>('continue_ctf_job', { id })
      jobs.value = await invokeCommand<CTFSummary[]>('list_ctf_jobs')
      await loadAgentState(id)
      error.value = null
      return true
    } catch (reason) {
      error.value = String(reason)
      return false
    }
  }

  async function reviewSubmission(id: string, accepted: boolean, summary: string) {
    try {
      projection.value = await invokeCommand<CTFProjection>('review_ctf_submission', { id, accepted, summary })
      jobs.value = await invokeCommand<CTFSummary[]>('list_ctf_jobs')
      await loadAgentState(id)
      error.value = null
      return true
    } catch (reason) {
      error.value = String(reason)
      return false
    }
  }

  async function prepareExternalSubmission(
    id: string,
    candidate: string,
    explanation: string,
  ) {
    try {
      projection.value = await invokeCommand<CTFProjection>(
        'prepare_ctf_external_submission',
        { id, candidate, explanation },
      )
      jobs.value = await invokeCommand<CTFSummary[]>('list_ctf_jobs')
      await loadAgentState(id)
      error.value = null
      return true
    } catch (reason) {
      error.value = String(reason)
      return false
    }
  }

  async function recordExternalVerdict(id: string, accepted: boolean, summary: string) {
    try {
      projection.value = await invokeCommand<CTFProjection>(
        'record_ctf_external_verdict',
        { id, accepted, summary },
      )
      jobs.value = await invokeCommand<CTFSummary[]>('list_ctf_jobs')
      await loadAgentState(id)
      error.value = null
      return true
    } catch (reason) {
      error.value = String(reason)
      return false
    }
  }

  async function cancelJob(id: string) {
    await invokeCommand('cancel_ctf_job', { id })
    await loadJobs()
  }

  async function adoptProjection(next: CTFProjection) {
    selectedId.value = next.job.id
    projection.value = next
    jobs.value = await invokeCommand<CTFSummary[]>('list_ctf_jobs')
    await loadAgentState(next.job.id)
  }

  onMounted(async () => {
    await loadJobs()
    stopListening = await listenEvent<RuntimeEvent>('job-event', () => {
      if (refreshTimer) return
      refreshTimer = window.setTimeout(() => {
        refreshTimer = undefined
        void loadJobs()
      }, 72)
    })
    budgetInterval = window.setInterval(() => {
      void loadAgentBudget(selectedId.value)
    }, 30_000)
  })

  onBeforeUnmount(() => {
    stopListening?.()
    if (refreshTimer) window.clearTimeout(refreshTimer)
    if (budgetInterval) window.clearInterval(budgetInterval)
  })

  return {
    jobs,
    selectedId,
    projection,
    agentBudget,
    agentRun,
    loading,
    creating,
    error,
    loadJobs,
    loadAgentBudget,
    loadAgentRun,
    loadAgentState,
    clearError,
    selectJob,
    startChallenge,
    recordLearning,
    continueJob,
    reviewSubmission,
    prepareExternalSubmission,
    recordExternalVerdict,
    cancelJob,
    adoptProjection,
  }
}
