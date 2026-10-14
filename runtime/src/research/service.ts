import { randomUUID } from 'node:crypto'
import { generateTraceId, normalizeTraceId } from '../trace.ts'
import { sanitizeResearchText } from './sanitize.ts'
import { ResearchStore, newCitation } from './store.ts'
import {
  MAX_QUERY_CODE_POINTS,
  MAX_REPORT_CODE_POINTS,
  MAX_RESULT_CODE_POINTS,
  MAX_TASK_CODE_POINTS,
  MAX_WORKERS_PER_BATCH,
  PHASE_COLLECTING,
  PHASE_FINALIZING,
  PHASE_FINAL_SYNTHESIS_PENDING,
  PHASE_GAP_FILL_COLLECTING,
  PHASE_GAP_FILL_WAITING,
  PHASE_SYNTHESIS_PENDING,
  PHASE_SYNTHESIZING,
  PHASE_WAITING,
  RUN_CANCELLED,
  RUN_COMPLETED,
  RUN_INTERRUPTED,
  RUN_RUNNING,
  ResearchNotFoundError,
  TASK_CANCELLED,
  TASK_COMPLETED,
  TASK_FAILED,
  TASK_INTERRUPTED,
  TASK_LAUNCHING,
  TASK_RUNNING,
  type Citation,
  type Run,
  type Snapshot,
  type Source,
  type Task,
  type WorkerUpdate,
} from './types.ts'

class Mutex {
  private chain: Promise<void> = Promise.resolve()

  run<T>(fn: () => T | Promise<T>): Promise<T> {
    const previous = this.chain
    let release!: () => void
    this.chain = new Promise((resolve) => {
      release = resolve
    })
    return previous.then(fn).finally(() => release())
  }
}

function isNotFound(error: unknown): boolean {
  if (error instanceof ResearchNotFoundError) return true
  return error instanceof Error && /no rows/i.test(error.message)
}

function batchPhases(phase: string): { waiting: string; completed: string; batch: number } | null {
  switch (phase) {
    case PHASE_COLLECTING:
      return { waiting: PHASE_WAITING, completed: PHASE_SYNTHESIZING, batch: 1 }
    case PHASE_WAITING:
      return { waiting: PHASE_WAITING, completed: PHASE_SYNTHESIS_PENDING, batch: 1 }
    case PHASE_GAP_FILL_COLLECTING:
      return { waiting: PHASE_GAP_FILL_WAITING, completed: PHASE_FINALIZING, batch: 2 }
    case PHASE_GAP_FILL_WAITING:
      return { waiting: PHASE_GAP_FILL_WAITING, completed: PHASE_FINAL_SYNTHESIS_PENDING, batch: 2 }
    default:
      return null
  }
}

function tasksForBatch(tasks: Task[], batch: number): Task[] {
  return tasks.filter((task) => task.batch === batch)
}

function allTasksTerminal(tasks: Task[]): boolean {
  if (tasks.length === 0) return false
  return !tasks.some(
    (task) => task.status === TASK_RUNNING || task.status === TASK_LAUNCHING || task.status === TASK_INTERRUPTED,
  )
}

function terminalTask(status: string): boolean {
  return status !== '' && status !== TASK_RUNNING && status !== TASK_LAUNCHING
}

function normalizeWorkerStatus(status: string): string {
  switch (String(status ?? '').trim().toLowerCase()) {
    case 'start':
    case 'running':
    case 'pending':
    case 'scheduled':
    case 'queued':
      return TASK_RUNNING
    case 'succeeded':
    case 'completed':
    case 'complete':
      return TASK_COMPLETED
    case 'failed':
    case 'error':
    case 'stopped':
    case 'timeout':
      return TASK_FAILED
    case 'cancelled':
    case 'canceled':
      return TASK_CANCELLED
    case 'interrupted':
      return TASK_INTERRUPTED
    default:
      throw new Error(`unsupported research worker status ${JSON.stringify(status)}`)
  }
}

export class ResearchService {
  readonly store: ResearchStore
  private readonly mutex = new Mutex()

  constructor(store: ResearchStore) {
    this.store = store
  }

  static open(dataDirectory: string): ResearchService {
    return new ResearchService(ResearchStore.open(dataDirectory))
  }

  close(): void {
    this.store.close()
  }

  recover(): Promise<void> {
    return this.mutex.run(() => {
      this.store.interruptRunning()
    })
  }

  start(conversationId: string, query: string, traceId = ''): Promise<Run> {
    return this.mutex.run(() => {
      const id = String(conversationId ?? '').trim()
      const text = sanitizeResearchText(String(query ?? '')).trim()
      if (!id || !text) throw new Error('conversation and research query are required')
      if ([...text].length > MAX_QUERY_CODE_POINTS) {
        throw new Error(`research query exceeds ${MAX_QUERY_CODE_POINTS} characters`)
      }
      try {
        this.store.findUnconfirmedWorkerStop(id)
        throw new Error('a previous research worker stop is unconfirmed')
      } catch (error) {
        if (!isNotFound(error)) throw error
      }
      try {
        this.store.findActiveRun(id)
        throw new Error('this conversation already has an active research run')
      } catch (error) {
        if (!isNotFound(error)) throw error
      }
      let resolved = normalizeTraceId(traceId)
      if (!resolved) resolved = generateTraceId()
      const now = new Date()
      const run: Run = {
        id: `research_${randomUUID()}`,
        conversationId: id,
        query: text,
        status: RUN_RUNNING,
        phase: PHASE_COLLECTING,
        report: '',
        workerStopUnconfirmed: false,
        traceId: resolved,
        createdAt: now,
        updatedAt: now,
      }
      this.store.createRun(run)
      return run
    })
  }

  registerTask(conversationId: string, runId: string, prompt: string): Promise<Task> {
    return this.mutex.run(() => {
      const run = this.ownedRun(conversationId, runId)
      if (run.status !== RUN_RUNNING) throw new Error('research run is not running')
      const text = sanitizeResearchText(String(prompt ?? '')).trim()
      if (!text || [...text].length > MAX_TASK_CODE_POINTS) {
        throw new Error(`research task prompt must contain 1-${MAX_TASK_CODE_POINTS} characters`)
      }
      let batch = 0
      switch (run.phase) {
        case PHASE_COLLECTING:
          batch = 1
          break
        case PHASE_GAP_FILL_COLLECTING:
          batch = 2
          break
        default:
          throw new Error('research run is not collecting a worker batch')
      }
      const tasks = this.store.listTasks(run.id)
      let count = 0
      for (const task of tasks) {
        if (task.batch !== batch) continue
        count += 1
        if (task.status === TASK_LAUNCHING) {
          if (task.prompt === text) return task
          throw new Error('launch the previously registered worker before registering another task')
        }
        if (task.prompt !== text) continue
        if (task.status === TASK_INTERRUPTED || task.status === TASK_FAILED) {
          task.status = TASK_LAUNCHING
          task.workerId = ''
          task.result = ''
          this.store.upsertTask(task)
          return task
        }
        if (task.status === TASK_RUNNING) throw new Error('research task prompt is already registered')
      }
      if (count >= MAX_WORKERS_PER_BATCH) {
        throw new Error(`research batch exceeds ${MAX_WORKERS_PER_BATCH} workers`)
      }
      const task: Task = {
        id: `research_task_${randomUUID()}`,
        runId: run.id,
        prompt: text,
        status: TASK_LAUNCHING,
        workerId: '',
        batch,
        result: '',
      }
      this.store.upsertTask(task)
      return task
    })
  }

  list(conversationId: string): Promise<Run[]> {
    return this.mutex.run(() => {
      const id = String(conversationId ?? '').trim()
      if (!id) throw new Error('conversation id is required')
      const runs = this.store.listRuns(id, 10)
      for (const run of runs) run.report = ''
      return runs
    })
  }

  deleteConversation(conversationId: string): Promise<void> {
    return this.mutex.run(() => {
      this.store.deleteConversation(conversationId)
    })
  }

  get(conversationId: string, runId: string): Promise<Snapshot> {
    return this.mutex.run(() => this.snapshot(this.ownedRun(conversationId, runId)))
  }

  sealBatch(conversationId: string, runId: string): Promise<Run> {
    return this.mutex.run(() => {
      const run = this.ownedRun(conversationId, runId)
      if (run.status !== RUN_RUNNING) throw new Error('research run is not running')
      const phases = batchPhases(run.phase)
      if (!phases || (run.phase !== PHASE_COLLECTING && run.phase !== PHASE_GAP_FILL_COLLECTING)) {
        throw new Error('research run is not collecting a worker batch')
      }
      const current = tasksForBatch(this.store.listTasks(run.id), phases.batch)
      if (current.length === 0) throw new Error('research batch has no workers')
      if (current.length > MAX_WORKERS_PER_BATCH) {
        throw new Error(`research batch exceeds ${MAX_WORKERS_PER_BATCH} workers`)
      }
      for (const task of current) {
        if (task.status === TASK_INTERRUPTED) {
          throw new Error('interrupted research tasks must be re-registered before sealing')
        }
        if (task.status === TASK_LAUNCHING || (task.status === TASK_RUNNING && task.workerId === '')) {
          throw new Error('a registered research task has not started its worker')
        }
      }
      run.phase = allTasksTerminal(current) ? phases.completed : phases.waiting
      run.updatedAt = new Date()
      this.store.updateRun(run)
      return run
    })
  }

  recordWorkerUpdates(
    conversationId: string,
    runId: string,
    updates: WorkerUpdate[],
  ): Promise<{ run: Run; ready: boolean }> {
    return this.mutex.run(() => {
      const run = this.ownedRun(conversationId, runId)
      if (run.status !== RUN_RUNNING) return { run, ready: false }
      const phases = batchPhases(run.phase)
      if (!phases) return { run, ready: false }
      const tasks = this.store.listTasks(run.id)
      const existing = new Map<string, Task>()
      const currentIds = new Set<string>()
      for (const task of tasks) {
        existing.set(task.id, task)
        if (task.batch === phases.batch) currentIds.add(task.id)
      }
      const effectiveIds: string[] = []
      const matchedInterrupted = new Set<string>()
      for (const update of updates) {
        const updateId = String(update.id ?? '').trim()
        if (!updateId) throw new Error('research worker id is required')
        let effectiveId = updateId
        if (!existing.has(effectiveId) && String(update.prompt ?? '').trim()) {
          for (const task of tasks) {
            if (task.batch !== phases.batch || task.status !== TASK_INTERRUPTED) continue
            if (task.prompt !== String(update.prompt ?? '').trim()) continue
            if (matchedInterrupted.has(task.id)) continue
            effectiveId = task.id
            matchedInterrupted.add(task.id)
            break
          }
        }
        effectiveIds.push(effectiveId)
        currentIds.add(effectiveId)
      }
      if (currentIds.size > MAX_WORKERS_PER_BATCH) {
        throw new Error(`research batch exceeds ${MAX_WORKERS_PER_BATCH} workers`)
      }
      const upserts: Task[] = []
      for (let index = 0; index < updates.length; index += 1) {
        const update = updates[index]!
        let status = normalizeWorkerStatus(update.status)
        const taskId = effectiveIds[index]!
        const previous = existing.get(taskId) ?? {
          id: taskId,
          runId: run.id,
          prompt: '',
          status: '',
          workerId: '',
          batch: phases.batch,
          result: '',
        }
        let prompt = sanitizeResearchText(String(update.prompt ?? '')).trim()
        if (!prompt) prompt = previous.prompt
        if ([...prompt].length > MAX_TASK_CODE_POINTS) {
          throw new Error(`research worker prompt exceeds ${MAX_TASK_CODE_POINTS} characters`)
        }
        const resumingInterrupted = previous.status === TASK_INTERRUPTED && status === TASK_RUNNING
        let result = sanitizeResearchText(String(update.result ?? '')).trim()
        if (!result && !resumingInterrupted) result = previous.result
        if ([...result].length > MAX_RESULT_CODE_POINTS) {
          result = [...result].slice(0, MAX_RESULT_CODE_POINTS).join('')
        }
        let workerId = String(update.workerId ?? '').trim()
        if (!workerId) workerId = previous.workerId
        if (terminalTask(previous.status) && previous.status !== TASK_INTERRUPTED && status === TASK_RUNNING) {
          status = previous.status
        }
        if (status === TASK_RUNNING && !workerId) status = TASK_LAUNCHING
        const task: Task = {
          id: taskId,
          runId: run.id,
          prompt,
          status,
          workerId,
          batch: phases.batch,
          result,
        }
        upserts.push(task)
        existing.set(task.id, task)
      }
      let ready = false
      if (run.phase === phases.waiting) {
        const current = [...existing.values()].filter((task) => task.batch === phases.batch)
        if (allTasksTerminal(current)) {
          run.phase = phases.completed
          ready = true
        }
      }
      if (upserts.length === 0) return { run, ready: false }
      run.updatedAt = new Date()
      this.store.upsertTasksAndRun(upserts, run)
      return { run, ready }
    })
  }

  claimContinuation(conversationId: string, runId: string): Promise<{ run: Run; claimed: boolean }> {
    return this.mutex.run(() => {
      const run = this.ownedRun(conversationId, runId)
      if (run.status !== RUN_RUNNING) return { run, claimed: false }
      switch (run.phase) {
        case PHASE_SYNTHESIS_PENDING:
          run.phase = PHASE_SYNTHESIZING
          break
        case PHASE_FINAL_SYNTHESIS_PENDING:
          run.phase = PHASE_FINALIZING
          break
        default:
          return { run, claimed: false }
      }
      run.updatedAt = new Date()
      this.store.updateRun(run)
      return { run, claimed: true }
    })
  }

  beginGapFill(conversationId: string, runId: string): Promise<Run> {
    return this.mutex.run(() => {
      const run = this.ownedRun(conversationId, runId)
      if (run.status !== RUN_RUNNING || run.phase !== PHASE_SYNTHESIZING) {
        throw new Error('research run is not ready for a gap-fill batch')
      }
      run.phase = PHASE_GAP_FILL_COLLECTING
      run.updatedAt = new Date()
      this.store.updateRun(run)
      return run
    })
  }

  addSource(
    conversationId: string,
    runId: string,
    sourceURL: string,
    title: string,
    extract: string,
  ): Promise<Source> {
    return this.mutex.run(() => {
      const run = this.ownedRun(conversationId, runId)
      if (run.status !== RUN_RUNNING) throw new Error('research run is not running')
      return this.store.addSource(run.id, sourceURL, title, new Date(), Buffer.from(extract, 'utf8'))
    })
  }

  readSource(conversationId: string, sourceId: string): Promise<{ source: Source; extract: string }> {
    return this.mutex.run(() => {
      const { source, data } = this.store.readSource(sourceId)
      this.ownedRun(conversationId, source.runId)
      return { source, extract: data.toString('utf8') }
    })
  }

  readReport(conversationId: string, runId: string): Promise<string> {
    return this.mutex.run(() => {
      const run = this.ownedRun(conversationId, runId)
      if (!run.report) throw new Error('research run has no saved report')
      return run.report
    })
  }

  recordCitation(
    conversationId: string,
    runId: string,
    claim: string,
    sourceId: string,
    verdict: string,
    reason: string,
  ): Promise<Citation> {
    return this.mutex.run(() => {
      const citation = newCitation(runId, claim, sourceId, verdict, reason)
      const run = this.ownedRun(conversationId, citation.runId)
      if (run.status !== RUN_RUNNING) throw new Error('research run is not running')
      this.store.addCitation(citation)
      return citation
    })
  }

  complete(conversationId: string, runId: string, report: string): Promise<Run> {
    return this.mutex.run(() => {
      const run = this.ownedRun(conversationId, runId)
      if (run.status !== RUN_RUNNING || (run.phase !== PHASE_SYNTHESIZING && run.phase !== PHASE_FINALIZING)) {
        throw new Error('research run is not ready to complete')
      }
      const text = sanitizeResearchText(String(report ?? '')).trim()
      if (!text) throw new Error('research report is required')
      if ([...text].length > MAX_REPORT_CODE_POINTS) {
        throw new Error(`research report exceeds ${MAX_REPORT_CODE_POINTS} characters`)
      }
      run.status = RUN_COMPLETED
      run.phase = PHASE_FINALIZING
      run.report = text
      run.updatedAt = new Date()
      this.store.updateRun(run)
      return run
    })
  }

  cancel(conversationId: string, runId: string): Promise<Run> {
    return this.mutex.run(() => {
      const run = this.ownedRun(conversationId, runId)
      if (run.status === RUN_CANCELLED) return run
      if (run.status !== RUN_RUNNING && run.status !== RUN_INTERRUPTED) {
        throw new Error('research run is not active or interrupted')
      }
      run.status = RUN_CANCELLED
      run.phase = PHASE_FINALIZING
      run.updatedAt = new Date()
      this.store.cancelRun(run)
      return run
    })
  }

  setWorkerStopUnconfirmed(conversationId: string, runId: string, unconfirmed: boolean): Promise<Run> {
    return this.mutex.run(() => {
      const run = this.ownedRun(conversationId, runId)
      if (run.status !== RUN_CANCELLED) throw new Error('research run is not cancelled')
      this.store.setWorkerStopUnconfirmed(run.conversationId, run.id, unconfirmed)
      run.workerStopUnconfirmed = unconfirmed
      return run
    })
  }

  resume(conversationId: string, runId: string): Promise<Snapshot> {
    return this.mutex.run(() => {
      const run = this.ownedRun(conversationId, runId)
      if (run.status !== RUN_INTERRUPTED) throw new Error('research run is not interrupted')
      try {
        const active = this.store.findActiveRun(run.conversationId)
        if (active.id !== run.id) throw new Error('this conversation already has an active research run')
      } catch (error) {
        if (!isNotFound(error)) throw error
      }
      switch (run.phase) {
        case PHASE_WAITING:
          run.phase = PHASE_COLLECTING
          break
        case PHASE_GAP_FILL_WAITING:
          run.phase = PHASE_GAP_FILL_COLLECTING
          break
        case PHASE_SYNTHESIS_PENDING:
          run.phase = PHASE_SYNTHESIZING
          break
        case PHASE_FINAL_SYNTHESIS_PENDING:
          run.phase = PHASE_FINALIZING
          break
        default:
          break
      }
      run.status = RUN_RUNNING
      run.updatedAt = new Date()
      this.store.updateRun(run)
      return this.snapshot(run)
    })
  }

  markInterrupted(conversationId: string, runId: string): Promise<void> {
    return this.mutex.run(() => {
      const run = this.ownedRun(conversationId, runId)
      if (run.status !== RUN_RUNNING) return
      run.status = RUN_INTERRUPTED
      run.updatedAt = new Date()
      this.store.interruptRun(run)
    })
  }

  private ownedRun(conversationId: string, runId: string): Run {
    const conversation = String(conversationId ?? '').trim()
    const id = String(runId ?? '').trim()
    if (!conversation || !id) throw new Error('conversation and research run id are required')
    const run = this.store.getRun(id)
    if (run.conversationId !== conversation) {
      throw new Error('research run does not belong to this conversation')
    }
    return run
  }

  private snapshot(run: Run): Snapshot {
    const tasks = this.store.listTasks(run.id)
    const sources = this.store.listSources(run.id)
    const citations = this.store.listCitations(run.id)
    run.report = ''
    return { run, tasks, sources, citations }
  }
}
