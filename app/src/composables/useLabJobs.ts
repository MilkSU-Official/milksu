import { computed, ref, watch } from 'vue'

const STORAGE_KEY = 'milksu.lab-jobs.v1'

export type LabScope = 'local' | 'remote'

export interface LabJob {
  id: string
  title: string
  scope: LabScope
  request: string
  createdAt: number
  updatedAt: number
}

export interface LabJobDraft {
  scope: LabScope
  request: string
}

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage ?? null
  } catch {
    return null
  }
}

export function labScopeLabel(scope: LabScope) {
  return scope === 'local' ? '本地' : '远程'
}

export function labJobTitle(request: string) {
  const line = String(request ?? '').replace(/\s+/g, ' ').trim()
  if (!line) return '实验室作业'
  const chars = Array.from(line)
  return chars.length <= 24 ? line : `${chars.slice(0, 24).join('')}…`
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
    title: String(record.title ?? '').trim() || labJobTitle(request),
    scope: record.scope === 'local' ? 'local' : 'remote',
    request,
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

export function useLabJobs() {
  const jobs = ref<LabJob[]>(readJobs())
  const selectedId = ref('')

  watch(jobs, value => {
    try {
      storage()?.setItem(STORAGE_KEY, JSON.stringify({ jobs: value }))
    } catch {
      // Ignore quota failures.
    }
  }, { deep: true })

  const selected = computed(() => jobs.value.find(job => job.id === selectedId.value) ?? null)

  function createJob(draft: LabJobDraft) {
    const now = Date.now()
    const request = draft.request.trim()
    const job: LabJob = {
      id: crypto.randomUUID(),
      title: labJobTitle(request),
      scope: draft.scope,
      request,
      createdAt: now,
      updatedAt: now,
    }
    jobs.value = [job, ...jobs.value]
    selectedId.value = job.id
    return job
  }

  function touch(id: string) {
    jobs.value = jobs.value.map(job => (
      job.id === id ? { ...job, updatedAt: Date.now() } : job
    ))
  }

  return {
    jobs,
    selectedId,
    selected,
    createJob,
    touch,
  }
}
