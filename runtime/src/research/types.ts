export const RUN_RUNNING = 'running'
export const RUN_COMPLETED = 'completed'
export const RUN_FAILED = 'failed'
export const RUN_CANCELLED = 'cancelled'
export const RUN_INTERRUPTED = 'interrupted'

export const TASK_LAUNCHING = 'launching'
export const TASK_RUNNING = 'running'
export const TASK_COMPLETED = 'completed'
export const TASK_FAILED = 'failed'
export const TASK_CANCELLED = 'cancelled'
export const TASK_INTERRUPTED = 'interrupted'

export const PHASE_COLLECTING = 'collecting'
export const PHASE_WAITING = 'waiting'
export const PHASE_SYNTHESIS_PENDING = 'synthesis_pending'
export const PHASE_SYNTHESIZING = 'synthesizing'
export const PHASE_GAP_FILL_COLLECTING = 'gap_fill_collecting'
export const PHASE_GAP_FILL_WAITING = 'gap_fill_waiting'
export const PHASE_FINAL_SYNTHESIS_PENDING = 'final_synthesis_pending'
export const PHASE_FINALIZING = 'finalizing'

export const CITATION_SUPPORTED = 'supported'
export const CITATION_UNSUPPORTED = 'unsupported'

export const MAX_SOURCE_BYTES = 16 * 1024
export const MAX_QUERY_CODE_POINTS = 2000
export const MAX_TASK_CODE_POINTS = 16000
export const MAX_RESULT_CODE_POINTS = 8000
export const MAX_REPORT_CODE_POINTS = 30000
export const MAX_WORKERS_PER_BATCH = 4
export const MAX_CITATION_CLAIM_CODE_POINTS = 2000
export const MAX_CITATION_REASON_CODE_POINTS = 1200

export const RESEARCH_RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,191}$/

export const SUPPORTED_DATABASE_VERSION = 4
export const RESEARCH_V1_MIGRATION_NAME = 'create research store'
export const RESEARCH_V2_MIGRATION_NAME = 'track unconfirmed worker stops'
export const RESEARCH_V3_MIGRATION_NAME = 'track research worker launching state'
export const RESEARCH_V4_MIGRATION_NAME = 'record research run trace id'

export class ResearchNotFoundError extends Error {
  constructor(message = 'no rows') {
    super(message)
    this.name = 'ResearchNotFoundError'
  }
}

export type Run = {
  id: string
  conversationId: string
  query: string
  status: string
  phase: string
  report: string
  workerStopUnconfirmed: boolean
  traceId: string
  createdAt: Date
  updatedAt: Date
}

export type Task = {
  id: string
  runId: string
  prompt: string
  status: string
  workerId: string
  batch: number
  result: string
}

export type Source = {
  id: string
  runId: string
  url: string
  title: string
  retrievedAt: Date
  artifactRef: string
}

export type Citation = {
  runId: string
  claim: string
  sourceId: string
  verdict: string
  reason: string
}

export type WorkerUpdate = {
  id: string
  prompt?: string
  status: string
  workerId?: string
  result?: string
}

export type Snapshot = {
  run: Run
  tasks: Task[]
  sources: Source[]
  citations: Citation[]
}

export function validRunStatus(status: string): boolean {
  switch (status) {
    case RUN_RUNNING:
    case RUN_COMPLETED:
    case RUN_FAILED:
    case RUN_CANCELLED:
    case RUN_INTERRUPTED:
      return true
    default:
      return false
  }
}

export function validTaskStatus(status: string): boolean {
  switch (status) {
    case TASK_LAUNCHING:
    case TASK_RUNNING:
    case TASK_COMPLETED:
    case TASK_FAILED:
    case TASK_CANCELLED:
    case TASK_INTERRUPTED:
      return true
    default:
      return false
  }
}

export function validRunPhase(phase: string): boolean {
  switch (phase) {
    case PHASE_COLLECTING:
    case PHASE_WAITING:
    case PHASE_SYNTHESIS_PENDING:
    case PHASE_SYNTHESIZING:
    case PHASE_GAP_FILL_COLLECTING:
    case PHASE_GAP_FILL_WAITING:
    case PHASE_FINAL_SYNTHESIS_PENDING:
    case PHASE_FINALIZING:
      return true
    default:
      return false
  }
}

export function formatResearchTime(value: Date): string {
  const iso = new Date(value).toISOString()
  if (!iso.endsWith('Z')) return iso
  const [head, frac] = iso.slice(0, -1).split('.')
  const nanos = (frac ?? '0').padEnd(9, '0').slice(0, 9)
  return `${head}.${nanos}Z`
}

export function parseResearchTime(value: string): Date {
  const date = new Date(String(value ?? '').trim())
  if (Number.isNaN(date.getTime())) {
    throw new Error(`parse research time: ${value}`)
  }
  return date
}

export function jsonTime(value: Date): string {
  return new Date(value).toISOString()
}

export function publicRun(run: Run): Record<string, unknown> {
  const value: Record<string, unknown> = {
    id: run.id,
    conversationId: run.conversationId,
    query: run.query,
    status: run.status,
    phase: run.phase,
    traceId: run.traceId,
    createdAt: jsonTime(run.createdAt),
    updatedAt: jsonTime(run.updatedAt),
  }
  if (run.report) value.report = run.report
  if (run.workerStopUnconfirmed) value.workerStopUnconfirmed = true
  return value
}

export function publicTask(task: Task): Record<string, unknown> {
  const value: Record<string, unknown> = {
    id: task.id,
    runId: task.runId,
    prompt: task.prompt,
    status: task.status,
    workerId: task.workerId,
    batch: task.batch,
  }
  if (task.result) value.result = task.result
  return value
}

export function publicSource(source: Source): Record<string, unknown> {
  return {
    id: source.id,
    runId: source.runId,
    url: source.url,
    title: source.title,
    retrievedAt: jsonTime(source.retrievedAt),
    artifactRef: source.artifactRef,
  }
}

export function publicCitation(citation: Citation): Record<string, unknown> {
  const value: Record<string, unknown> = {
    runId: citation.runId,
    claim: citation.claim,
    sourceId: citation.sourceId,
    verdict: citation.verdict,
  }
  if (citation.reason) value.reason = citation.reason
  return value
}

export function publicSnapshot(snapshot: Snapshot): Record<string, unknown> {
  return {
    run: publicRun(snapshot.run),
    tasks: snapshot.tasks.map(publicTask),
    sources: snapshot.sources.map(publicSource),
    citations: snapshot.citations.map(publicCitation),
  }
}
