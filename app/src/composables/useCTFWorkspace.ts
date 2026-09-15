import { createStore } from '@/lib/reactStore'
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

/** Electron IPC cannot structured-clone proxies. Keep the desktop
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
  const store = createStore({
    jobs: [] as CTFSummary[],
    selectedId: null as string | null,
    projection: null as CTFProjection | null,
    agentBudget: null as CTFAgentBudgetStatus | null,
    agentRun: null as CTFAgentRunCheckpoint | null,
    loading: true,
    creating: false,
    error: null as string | null,
  })
  const s = {
    get jobs() { return store.getState().jobs },
    set jobs(value) { store.setState({ jobs: value }) },
    get selectedId() { return store.getState().selectedId },
    set selectedId(value) { store.setState({ selectedId: value }) },
    get projection() { return store.getState().projection },
    set projection(value) { store.setState({ projection: value }) },
    get agentBudget() { return store.getState().agentBudget },
    set agentBudget(value) { store.setState({ agentBudget: value }) },
    get agentRun() { return store.getState().agentRun },
    set agentRun(value) { store.setState({ agentRun: value }) },
    get loading() { return store.getState().loading },
    set loading(value) { store.setState({ loading: value }) },
    get creating() { return store.getState().creating },
    set creating(value) { store.setState({ creating: value }) },
    get error() { return store.getState().error },
    set error(value) { store.setState({ error: value }) }
  }

  let refreshTimer: number | undefined
  let budgetInterval: number | undefined
  let stopListening: (() => void) | undefined

  async function loadAgentBudget(id: string | null) {
    if (!id) {
      s.agentBudget = null
      return
    }
    try {
      s.agentBudget = await invokeCommand<CTFAgentBudgetStatus>(
        'get_ctf_agent_budget_status',
        { id },
      )
    } catch {
      s.agentBudget = null
    }
  }

  async function loadAgentRun(id: string | null) {
    if (!id) {
      s.agentRun = null
      return
    }
    try {
      s.agentRun = await invokeCommand<CTFAgentRunCheckpoint | null>(
        'get_ctf_agent_run_checkpoint',
        { id },
      )
    } catch {
      s.agentRun = null
    }
  }

  async function loadAgentState(id: string | null) {
    await Promise.all([
      loadAgentBudget(id),
      loadAgentRun(id),
    ])
  }

  async function loadJobs() {
    s.loading = true
    try {
      s.jobs = await invokeCommand<CTFSummary[]>('list_ctf_jobs')
      const nextId = s.selectedId && s.jobs.some(job => job.id === s.selectedId)
        ? s.selectedId
        : s.jobs[0]?.id ?? null
      s.selectedId = nextId
      s.projection = nextId ? await invokeCommand<CTFProjection>('get_ctf_job', { id: nextId }) : null
      await loadAgentState(nextId)
      s.error = null
    } catch (reason) {
      s.error = String(reason)
    } finally {
      s.loading = false
    }
  }

  async function selectJob(id: string) {
    s.selectedId = id
    try {
      s.projection = await invokeCommand<CTFProjection>('get_ctf_job', { id })
      await loadAgentState(id)
      s.error = null
    } catch (reason) {
      s.error = String(reason)
    }
  }

  async function startChallenge(request: CTFChallengeRequest) {
    s.creating = true
    try {
      const started = await invokeCommand<CTFProjection>('start_ctf_challenge', {
        request: toDesktopCTFChallengeRequest(request),
      })
      s.selectedId = started.job.id
      s.projection = started
      s.jobs = await invokeCommand<CTFSummary[]>('list_ctf_jobs')
      await loadAgentState(started.job.id)
      s.error = null
      return started
    } catch (reason) {
      s.error = String(reason)
      return null
    } finally {
      s.creating = false
    }
  }

  async function recordLearning(id: string, request: CTFLearningRecordRequest) {
    try {
      s.projection = await invokeCommand<CTFProjection>('record_ctf_learning', { id, request })
      s.jobs = await invokeCommand<CTFSummary[]>('list_ctf_jobs')
      await loadAgentState(id)
      s.error = null
      return true
    } catch (reason) {
      s.error = String(reason)
      return false
    }
  }

  async function reviewSubmission(id: string, accepted: boolean, summary: string) {
    try {
      s.projection = await invokeCommand<CTFProjection>('review_ctf_submission', { id, accepted, summary })
      s.jobs = await invokeCommand<CTFSummary[]>('list_ctf_jobs')
      await loadAgentState(id)
      s.error = null
      return true
    } catch (reason) {
      s.error = String(reason)
      return false
    }
  }

  async function prepareExternalSubmission(
    id: string,
    candidate: string,
    explanation: string,
  ) {
    try {
      s.projection = await invokeCommand<CTFProjection>(
        'prepare_ctf_external_submission',
        { id, candidate, explanation },
      )
      s.jobs = await invokeCommand<CTFSummary[]>('list_ctf_jobs')
      await loadAgentState(id)
      s.error = null
      return true
    } catch (reason) {
      s.error = String(reason)
      return false
    }
  }

  async function recordExternalVerdict(id: string, accepted: boolean, summary: string) {
    try {
      s.projection = await invokeCommand<CTFProjection>(
        'record_ctf_external_verdict',
        { id, accepted, summary },
      )
      s.jobs = await invokeCommand<CTFSummary[]>('list_ctf_jobs')
      await loadAgentState(id)
      s.error = null
      return true
    } catch (reason) {
      s.error = String(reason)
      return false
    }
  }

  async function cancelJob(id: string) {
    await invokeCommand('cancel_ctf_job', { id })
    await loadJobs()
  }

  async function adoptProjection(next: CTFProjection) {
    s.selectedId = next.job.id
    s.projection = next
    s.jobs = await invokeCommand<CTFSummary[]>('list_ctf_jobs')
    await loadAgentState(next.job.id)
  }

  async function start() {
    await loadJobs()
    stopListening = await listenEvent<RuntimeEvent>('job-event', () => {
      if (refreshTimer) return
      refreshTimer = window.setTimeout(() => {
        refreshTimer = undefined
        void loadJobs()
      }, 72)
    })
    budgetInterval = window.setInterval(() => {
      void loadAgentBudget(s.selectedId)
    }, 30_000)
  }

  function stop() {
    stopListening?.()
    if (refreshTimer) window.clearTimeout(refreshTimer)
    if (budgetInterval) window.clearInterval(budgetInterval)
  }

  return {
    store,
    get jobs() { return s.jobs },
    set jobs(value) { s.jobs = value },
    get selectedId() { return s.selectedId },
    set selectedId(value) { s.selectedId = value },
    get projection() { return s.projection },
    set projection(value) { s.projection = value },
    get agentBudget() { return s.agentBudget },
    set agentBudget(value) { s.agentBudget = value },
    get agentRun() { return s.agentRun },
    set agentRun(value) { s.agentRun = value },
    get loading() { return s.loading },
    set loading(value) { s.loading = value },
    get creating() { return s.creating },
    set creating(value) { s.creating = value },
    get error() { return s.error },
    set error(value) { s.error = value },
    loadJobs,
    loadAgentBudget,
    loadAgentRun,
    loadAgentState,
    selectJob,
    startChallenge,
    recordLearning,
    reviewSubmission,
    prepareExternalSubmission,
    recordExternalVerdict,
    cancelJob,
    adoptProjection,
    start,
    stop,
  }
}
