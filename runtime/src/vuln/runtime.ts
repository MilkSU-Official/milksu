import { createHash } from 'node:crypto'
import { chmodSync, mkdirSync, readFileSync, writeFileSync, existsSync, openSync, closeSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { EventStore } from './event-store.ts'
import { newId, validateIdentifier } from './ids.ts'
import {
  isTerminalStatus,
  type ActionStatus,
  type Artifact,
  type Attempt,
  type AttemptStatus,
  type Effect,
  type EnvironmentLease,
  type Evaluation,
  type EventScope,
  type Evidence,
  type Job,
  type JobProjection,
  type JobStatus,
  type Observation,
  type Outcome,
  type RoleFact,
  type Step,
  type StepStatus,
} from './types.ts'

export class ArtifactStore {
  readonly root: string

  constructor(root: string) {
    this.root = root
    mkdirSync(root, { recursive: true, mode: 0o700 })
  }

  put(jobId: string, sourceActionId: string, mediaType: string, data: Uint8Array): { artifact: Artifact; created: boolean } {
    validateIdentifier('source action id', sourceActionId)
    return this.write(jobId, sourceActionId, `action:${sourceActionId}`, mediaType, data)
  }

  admit(jobId: string, source: string, mediaType: string, data: Uint8Array): { artifact: Artifact; created: boolean } {
    if (!source) throw new Error('artifact source is required')
    return this.write(jobId, '', source, mediaType, data)
  }

  read(artifact: Artifact): Buffer {
    validateIdentifier('job id', artifact.jobId)
    if (artifact.sha256.length !== 64) throw new Error('invalid artifact digest')
    const expected = `${artifact.jobId}/${artifact.sha256}`
    if (artifact.relativePath !== expected) throw new Error('artifact path does not match identity')
    const filePath = join(this.root, artifact.jobId, artifact.sha256)
    verifyFile(filePath, artifact.sha256)
    return readFileSync(filePath)
  }

  private write(
    jobId: string,
    sourceActionId: string,
    source: string,
    mediaType: string,
    data: Uint8Array,
  ): { artifact: Artifact; created: boolean } {
    validateIdentifier('job id', jobId)
    if (sourceActionId) validateIdentifier('source action id', sourceActionId)
    if (!mediaType) throw new Error('artifact media type is required')
    const digest = createHash('sha256').update(data).digest('hex')
    const directory = join(this.root, jobId)
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    const filePath = join(directory, digest)
    let created = true
    if (existsSync(filePath)) {
      created = false
      verifyFile(filePath, digest)
    } else {
      const fd = openSync(filePath, 'wx', 0o600)
      try {
        writeFileSync(fd, data)
      } catch (error) {
        closeSync(fd)
        try {
          unlinkSync(filePath)
        } catch {
          // ignore
        }
        throw error
      }
      closeSync(fd)
      try {
        chmodSync(filePath, 0o600)
      } catch {
        // ignore
      }
    }
    const artifact: Artifact = {
      id: newId('artifact'),
      jobId,
      source,
      sha256: digest,
      mediaType,
      size: data.byteLength,
      relativePath: `${jobId}/${digest}`,
    }
    if (sourceActionId) artifact.sourceActionId = sourceActionId
    return { artifact, created }
  }
}

function verifyFile(path: string, expected: string): void {
  const digest = createHash('sha256').update(readFileSync(path)).digest('hex')
  if (digest !== expected) throw new Error('artifact digest mismatch')
}

export class JobRuntime {
  readonly store: EventStore
  readonly artifacts: ArtifactStore

  constructor(store: EventStore, artifacts: ArtifactStore) {
    this.store = store
    this.artifacts = artifacts
  }

  static open(root: string): JobRuntime {
    mkdirSync(root, { recursive: true, mode: 0o700 })
    const store = EventStore.open(join(root, 'events.sqlite3'))
    const artifacts = new ArtifactStore(join(root, 'artifacts'))
    return new JobRuntime(store, artifacts)
  }

  close(): void {
    this.store.close()
  }

  createJob(job: Job): Promise<void> {
    return this.append({ jobId: job.id, kind: 'job.created', payload: { job } }).then(() => undefined)
  }

  requestCancellation(jobId: string, reason: string): Promise<void> {
    return this.append({ jobId, kind: 'job.cancel.requested', payload: { reason } }).then(() => undefined)
  }

  recordRecovery(jobId: string, previousAttemptId: string): Promise<void> {
    return this.append({
      jobId,
      kind: 'job.recovery.started',
      payload: previousAttemptId ? { previousAttemptId } : {},
    }).then(() => undefined)
  }

  startAttempt(attempt: Attempt): Promise<void> {
    return this.append({
      jobId: attempt.jobId,
      attemptId: attempt.id,
      kind: 'attempt.started',
      payload: { attempt },
    }).then(() => undefined)
  }

  finishAttempt(jobId: string, attemptId: string, status: AttemptStatus, reason: string): Promise<void> {
    const kind = status === 'interrupted'
      ? 'attempt.interrupted'
      : status === 'failed'
        ? 'attempt.failed'
        : status === 'completed'
          ? 'attempt.completed'
          : ''
    if (!kind) throw new Error(`unsupported terminal attempt status ${JSON.stringify(status)}`)
    return this.append({
      jobId,
      attemptId,
      kind,
      payload: reason ? { attemptId, reason } : { attemptId },
    }).then(() => undefined)
  }

  recordEnvironment(scope: EventScope, lease: EnvironmentLease, prepared: boolean): Promise<void> {
    return this.append({
      jobId: scope.jobId,
      attemptId: scope.attemptId,
      stepId: scope.stepId,
      kind: prepared ? 'environment.prepared' : 'environment.released',
      payload: { lease },
    }).then(() => undefined)
  }

  startStep(scope: EventScope, step: Step): Promise<void> {
    return this.append({
      jobId: scope.jobId,
      attemptId: scope.attemptId,
      stepId: step.id,
      kind: 'step.started',
      payload: { step },
    }).then(() => undefined)
  }

  finishStep(scope: EventScope, status: StepStatus, reason: string): Promise<void> {
    const kind = status === 'failed' ? 'step.failed' : status === 'completed' ? 'step.completed' : ''
    if (!kind) throw new Error(`unsupported terminal step status ${JSON.stringify(status)}`)
    return this.append({
      jobId: scope.jobId,
      attemptId: scope.attemptId,
      stepId: scope.stepId,
      kind,
      payload: reason ? { stepId: scope.stepId, reason } : { stepId: scope.stepId },
    }).then(() => undefined)
  }

  proposeAction(scope: EventScope, action: unknown): Promise<void> {
    return this.append({
      jobId: scope.jobId,
      attemptId: scope.attemptId,
      stepId: scope.stepId,
      kind: 'action.proposed',
      payload: { action },
    }).then(() => undefined)
  }

  setActionStatus(scope: EventScope, actionId: string, status: ActionStatus, reason: string): Promise<void> {
    const kind = status === 'running'
      ? 'action.started'
      : status === 'completed'
        ? 'action.completed'
        : status === 'failed'
          ? 'action.failed'
          : ''
    if (!kind) throw new Error(`unsupported action status ${JSON.stringify(status)}`)
    return this.append({
      jobId: scope.jobId,
      attemptId: scope.attemptId,
      stepId: scope.stepId,
      kind,
      payload: reason ? { actionId, reason } : { actionId },
    }).then(() => undefined)
  }

  commitObservation(scope: EventScope, observation: Observation): Promise<void> {
    return this.append({
      jobId: scope.jobId,
      attemptId: scope.attemptId,
      stepId: scope.stepId,
      kind: 'observation.committed',
      payload: { observation },
    }).then(() => undefined)
  }

  async admitArtifact(jobId: string, source: string, mediaType: string, data: Uint8Array): Promise<{ artifact: Artifact; created: boolean }> {
    const { artifact, created } = this.artifacts.admit(jobId, source, mediaType, data)
    await this.append({
      jobId,
      kind: 'artifact.admitted',
      payload: { artifact, created },
    })
    return { artifact, created }
  }

  commitEffect(scope: EventScope, effect: Effect, reused: boolean): Promise<void> {
    return this.append({
      jobId: scope.jobId,
      attemptId: scope.attemptId,
      stepId: scope.stepId,
      kind: reused ? 'effect.reused' : 'effect.committed',
      payload: { effect },
    }).then(() => undefined)
  }

  linkEvidence(scope: EventScope, evidence: Evidence): Promise<void> {
    return this.append({
      jobId: scope.jobId,
      attemptId: scope.attemptId,
      stepId: scope.stepId,
      kind: 'evidence.linked',
      payload: { evidence },
    }).then(() => undefined)
  }

  recordEvaluation(scope: EventScope, evaluation: Evaluation): Promise<void> {
    return this.append({
      jobId: scope.jobId,
      attemptId: scope.attemptId,
      stepId: scope.stepId,
      kind: 'evaluation.recorded',
      payload: { evaluation },
    }).then(() => undefined)
  }

  decideOutcome(scope: EventScope, outcome: Outcome): Promise<void> {
    return this.append({
      jobId: scope.jobId,
      attemptId: scope.attemptId,
      stepId: scope.stepId,
      kind: 'outcome.decided',
      payload: { outcome },
    }).then(() => undefined)
  }

  finishJob(jobId: string, status: JobStatus, reason: string): Promise<void> {
    const kind = status === 'succeeded'
      ? 'job.completed'
      : status === 'cancelled'
        ? 'job.cancelled'
        : status === 'failed'
          ? 'job.failed'
          : ''
    if (!kind) throw new Error(`unsupported terminal job status ${JSON.stringify(status)}`)
    return this.append({ jobId, kind, payload: { reason } }).then(() => undefined)
  }

  commitRoleFact(scope: EventScope, fact: RoleFact): Promise<void> {
    return this.append({
      jobId: scope.jobId,
      attemptId: scope.attemptId,
      stepId: scope.stepId,
      kind: 'role.fact.committed',
      payload: { fact },
    }).then(() => undefined)
  }

  listJobs(): Promise<JobProjection[]> {
    return this.store.projections()
  }

  getJob(jobId: string): Promise<JobProjection> {
    return this.store.projection(jobId)
  }

  private append(draft: Parameters<EventStore['append']>[0]) {
    return this.store.append(draft)
  }
}

export function latestState(projection: JobProjection): {
  attempt?: Attempt
  step?: Step
  action?: JobProjection['actions'][number]
} {
  const state: {
    attempt?: Attempt
    step?: Step
    action?: JobProjection['actions'][number]
  } = {}
  if (projection.attempts.length > 0) {
    state.attempt = projection.attempts[projection.attempts.length - 1]
  }
  if (state.attempt) {
    for (let index = projection.steps.length - 1; index >= 0; index -= 1) {
      if (projection.steps[index].attemptId === state.attempt.id) {
        state.step = projection.steps[index]
        break
      }
    }
  }
  if (state.step) {
    for (let index = projection.actions.length - 1; index >= 0; index -= 1) {
      if (projection.actions[index].stepId === state.step.id) {
        state.action = projection.actions[index]
        break
      }
    }
  }
  return state
}

export function jobIsTerminal(projection: JobProjection): boolean {
  return isTerminalStatus(projection.job.status)
}
