import { createStore } from '@/lib/reactStore'
import { invokeCommand } from '@/desktop'
import { t } from '@/lib/uiLocale'

const STORAGE_KEY = 'milksu.lab-jobs.v1'

export type LabScope = 'local' | 'remote'

export interface LabJob {
  id: string
  title: string
  scope: LabScope
  request: string
  packageId?: string
  challengeId?: string
  createdAt: number
  updatedAt: number
}

export interface LabJobDraft {
  scope: LabScope
  request: string
  title?: string
  packageId?: string
  challengeId?: string
}

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage ?? null
  } catch {
    return null
  }
}

export function labScopeLabel(scope: LabScope) {
  return scope === 'local' ? t('本地', 'Local') : t('远程', 'Remote')
}

export function labJobTitle(request: string) {
  const line = String(request ?? '').replace(/\s+/g, ' ').trim()
  if (!line) return t('实验室作业', 'Lab job')
  const chars = Array.from(line)
  return chars.length <= 24 ? line : `${chars.slice(0, 24).join('')}…`
}

function clipLabTitle(value: string, fallback = '') {
  const line = String(value ?? '').replace(/\s+/g, ' ').trim()
  if (!line) return fallback
  return Array.from(line).slice(0, 40).join('')
}

function normalizeJob(raw: unknown): LabJob | null {
  if (!raw || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>
  const id = String(record.id ?? '').trim()
  if (!id) return null
  const request = String(record.request ?? '').trim()
    || [record.protocol, record.address].map(value => String(value ?? '').trim()).filter(Boolean).join(' ')
  const createdAt = Number(record.createdAt)
  const updatedAt = Number(record.updatedAt)
  return {
    id,
    title: clipLabTitle(String(record.title ?? ''), labJobTitle(request)) || labJobTitle(request),
    scope: record.scope === 'local' ? 'local' : 'remote',
    request,
    packageId: String(record.packageId ?? '').trim() || undefined,
    challengeId: String(record.challengeId ?? '').trim() || undefined,
    createdAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : Date.now(),
  }
}

function readJobs(): LabJob[] {
  const raw = storage()?.getItem(STORAGE_KEY)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as { jobs?: unknown[] }
    return Array.isArray(parsed.jobs)
      ? parsed.jobs.flatMap(item => {
          const job = normalizeJob(item)
          return job ? [job] : []
        })
      : []
  } catch {
    return []
  }
}

type LabJobsState = {
  jobs: LabJob[]
  selectedId: string
}

export const labJobsStore = createStore<LabJobsState>({
  jobs: readJobs(),
  selectedId: '',
})

labJobsStore.subscribe(() => {
  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify({ jobs: labJobsStore.getState().jobs }))
  } catch {
    // Ignore quota failures.
  }
})

async function persistJob(job: LabJob) {
  try {
    await invokeCommand('save_lab_job', { job })
  } catch {
    // Renderer tests and a missing Runtime keep the local list.
  }
}

export async function hydrateLabJobsFromBackend() {
  try {
    const remote = await invokeCommand<unknown[]>('list_lab_jobs')
    const next = Array.isArray(remote)
      ? remote.flatMap(item => {
          const job = normalizeJob(item)
          return job ? [job] : []
        })
      : []
    if (next.length) {
      labJobsStore.setState({ jobs: next })
      return
    }
    await Promise.all(labJobsStore.getState().jobs.map(job => persistJob(job)))
  } catch {
    // Keep the local cache when Desktop RPC is unavailable.
  }
}

export function applyLabJobRecord(record: Partial<LabJob> & { id?: string }) {
  const job = normalizeJob(record)
  if (!job) return null
  const { jobs } = labJobsStore.getState()
  const existing = jobs.find(item => item.id === job.id)
  const next = existing
    ? jobs.map(item => item.id === job.id ? { ...item, ...job, updatedAt: Date.now() } : item)
    : [job, ...jobs]
  labJobsStore.setState({ jobs: next })
  void persistJob(next.find(item => item.id === job.id) ?? job)
  return job
}

export function removeLabJobIds(ids: string[]) {
  const targets = new Set(ids.map(id => id.trim()).filter(Boolean))
  if (!targets.size) return
  const { jobs, selectedId } = labJobsStore.getState()
  labJobsStore.setState({
    jobs: jobs.filter(job => !targets.has(job.id)),
    selectedId: targets.has(selectedId) ? '' : selectedId,
  })
}

export function resetLabJobsForTests() {
  labJobsStore.setState({ jobs: readJobs(), selectedId: '' })
}

export function createLabJobsRuntime() {
  function createJob(draft: LabJobDraft) {
    const now = Date.now()
    const request = draft.request.trim()
    const job: LabJob = {
      id: crypto.randomUUID(),
      title: clipLabTitle(draft.title ?? '', labJobTitle(request)) || labJobTitle(request),
      scope: draft.scope,
      request,
      packageId: draft.packageId,
      challengeId: draft.challengeId,
      createdAt: now,
      updatedAt: now,
    }
    labJobsStore.setState({
      jobs: [job, ...labJobsStore.getState().jobs],
      selectedId: job.id,
    })
    void persistJob(job)
    return job
  }

  function rename(id: string, title: string) {
    const normalized = clipLabTitle(title)
    if (!normalized) return
    const jobs = labJobsStore.getState().jobs.map(job => (
      job.id === id ? { ...job, title: normalized, updatedAt: Date.now() } : job
    ))
    labJobsStore.setState({ jobs })
    const updated = jobs.find(job => job.id === id)
    if (updated) void persistJob(updated)
  }

  function focusChallenge(id: string, challengeId: string, request?: string) {
    const nextRequest = String(request ?? '').trim()
    const jobs = labJobsStore.getState().jobs.map(job => (
      job.id === id
        ? {
            ...job,
            challengeId,
            request: nextRequest || job.request,
            updatedAt: Date.now(),
          }
        : job
    ))
    labJobsStore.setState({ jobs })
    const updated = jobs.find(job => job.id === id)
    if (updated) void persistJob(updated)
  }

  function touch(id: string) {
    labJobsStore.setState({
      jobs: labJobsStore.getState().jobs.map(job => (
        job.id === id ? { ...job, updatedAt: Date.now() } : job
      )),
    })
  }

  return {
    store: labJobsStore,
    get jobs() { return labJobsStore.getState().jobs },
    set jobs(value: LabJob[]) { labJobsStore.setState({ jobs: value }) },
    get selectedId() { return labJobsStore.getState().selectedId },
    set selectedId(value: string) { labJobsStore.setState({ selectedId: value }) },
    get selected() {
      const { jobs, selectedId } = labJobsStore.getState()
      return jobs.find(job => job.id === selectedId) ?? null
    },
    createJob,
    rename,
    focusChallenge,
    touch,
  }
}

export function useLabJobs() {
  return createLabJobsRuntime()
}

export type LabJobsRuntime = ReturnType<typeof createLabJobsRuntime>
