import {
  CONTRACT_VERSION,
  EVENT_SCHEMA_VERSION,
  isTerminalStatus,
  type Action,
  type ActionStatus,
  type Artifact,
  type Attempt,
  type AttemptStatus,
  type Effect,
  type Evaluation,
  type Evidence,
  type EventKind,
  type JobProjection,
  type Observation,
  type Outcome,
  type RoleFact,
  type RuntimeEvent,
  type Step,
  type StepStatus,
} from './types.ts'
import { validateIdentifier } from './ids.ts'

export function projectEvents(events: RuntimeEvent[]): JobProjection {
  const projection: JobProjection = {
    contractVersion: CONTRACT_VERSION,
    job: {
      id: '',
      title: '',
      role: '',
      collaborationMode: '',
      status: 'queued',
      createdAt: '',
      updatedAt: '',
    },
    attempts: [],
    steps: [],
    actions: [],
    observations: [],
    artifacts: [],
    effects: [],
    evidence: [],
    evaluations: [],
    roleFacts: [],
    events: [...events],
  }
  let previousSequence = 0
  for (const [index, event] of events.entries()) {
    if (event.schemaVersion !== EVENT_SCHEMA_VERSION) {
      throw new Error(`unsupported event schema version ${event.schemaVersion}`)
    }
    if (index === 0 && event.sequence !== 1) {
      throw new Error('event sequence must start at 1')
    }
    if (index > 0 && event.sequence !== previousSequence + 1) {
      throw new Error(`event sequence gap at ${event.sequence}`)
    }
    previousSequence = event.sequence
    try {
      applyEvent(projection, event)
    } catch (error) {
      throw new Error(`apply ${event.kind}: ${error instanceof Error ? error.message : error}`)
    }
    if (event.occurredAt && projection.job.createdAt) {
      projection.job.updatedAt = event.occurredAt
    }
  }
  return projection
}

function applyEvent(projection: JobProjection, event: RuntimeEvent): void {
  switch (event.kind) {
    case 'job.created': {
      const payload = payloadOf<{ job: JobProjection['job'] }>(event)
      if (projection.job.id) throw new Error('job already exists')
      if (payload.job.id !== event.jobId) throw new Error('job payload does not match event job')
      projection.job = { ...payload.job, status: 'queued' }
      return
    }
    case 'job.cancel.requested':
      if (isTerminalStatus(projection.job.status)) throw new Error('cannot cancel terminal job')
      projection.job.status = 'cancelling'
      return
    case 'job.recovery.started':
      if (isTerminalStatus(projection.job.status)) throw new Error('cannot recover terminal job')
      projection.job.status = 'recovering'
      return
    case 'job.completed':
      requireOutcome(projection, 'succeeded', 'completed job requires succeeded outcome')
      projection.job.status = 'succeeded'
      return
    case 'job.failed':
      requireOutcome(projection, 'failed', 'failed job requires failed outcome')
      projection.job.status = 'failed'
      return
    case 'job.cancelled':
      requireOutcome(projection, 'cancelled', 'cancelled job requires cancelled outcome')
      projection.job.status = 'cancelled'
      return
    case 'attempt.started': {
      if (isTerminalStatus(projection.job.status)) throw new Error('cannot start attempt for terminal job')
      const payload = payloadOf<{ attempt: Attempt }>(event)
      if (payload.attempt.jobId !== event.jobId) throw new Error('attempt does not belong to event job')
      if (payload.attempt.id !== event.attemptId) throw new Error('attempt payload does not match event attempt')
      validateIdentifier('attempt id', payload.attempt.id)
      if (payload.attempt.status !== 'running' || hasId(projection.attempts, payload.attempt.id)) {
        throw new Error('attempt must be a new running attempt')
      }
      if (projection.attempts.some((attempt) => attempt.status === 'running')) {
        throw new Error('cannot start a second running attempt')
      }
      projection.attempts.push(payload.attempt)
      projection.job.status = 'running'
      return
    }
    case 'attempt.completed':
      updateAttempt(projection, event, 'completed')
      return
    case 'attempt.interrupted':
      updateAttempt(projection, event, 'interrupted')
      projection.job.status = 'recovering'
      return
    case 'attempt.failed':
      updateAttempt(projection, event, 'failed')
      return
    case 'step.started': {
      const payload = payloadOf<{ step: Step }>(event)
      if (!hasId(projection.attempts, payload.step.attemptId)) throw new Error('step references unknown attempt')
      if (payload.step.id !== event.stepId || payload.step.attemptId !== event.attemptId) {
        throw new Error('step payload does not match event references')
      }
      validateIdentifier('step id', payload.step.id)
      if (payload.step.status !== 'running' || hasId(projection.steps, payload.step.id)) {
        throw new Error('step must be a new running step')
      }
      projection.steps.push(payload.step)
      return
    }
    case 'step.completed':
      updateStep(projection, event, 'completed')
      return
    case 'step.failed':
      updateStep(projection, event, 'failed')
      return
    case 'action.proposed': {
      const payload = payloadOf<{ action: Action }>(event)
      if (!hasId(projection.steps, payload.action.stepId)) throw new Error('action references unknown step')
      if (payload.action.stepId !== event.stepId) throw new Error('action payload does not match event step')
      validateIdentifier('action id', payload.action.id)
      if (payload.action.status !== 'proposed' || hasId(projection.actions, payload.action.id)) {
        throw new Error('action must be a new proposed action')
      }
      const effect = payload.action.expectedEffect
      if (!effect?.class || !effect.idempotencyKey) {
        throw new Error('action must declare effect class and idempotency key')
      }
      if (!effect.cleanup || !effect.approval || !effect.scopeCheck) {
        throw new Error('action must declare cleanup, approval, and scope check')
      }
      projection.actions.push(payload.action)
      return
    }
    case 'action.started':
      updateAction(projection, event, 'running')
      return
    case 'action.completed':
      updateAction(projection, event, 'completed')
      return
    case 'action.failed':
      updateAction(projection, event, 'failed')
      return
    case 'observation.committed': {
      const payload = payloadOf<{ observation: Observation }>(event)
      if (!hasId(projection.actions, payload.observation.actionId)) {
        throw new Error('observation references unknown action')
      }
      validateIdentifier('observation id', payload.observation.id)
      if (hasId(projection.observations, payload.observation.id)) {
        throw new Error('observation id is already committed')
      }
      projection.observations.push(payload.observation)
      return
    }
    case 'artifact.committed': {
      const payload = payloadOf<{ artifact: Artifact }>(event)
      const artifact = { ...payload.artifact }
      if (artifact.jobId !== event.jobId || !hasId(projection.actions, artifact.sourceActionId ?? '')) {
        throw new Error('artifact provenance is not a committed action in this job')
      }
      if (!artifact.source) artifact.source = `action:${artifact.sourceActionId}`
      if (!artifact.id || hasId(projection.artifacts, artifact.id)) {
        throw new Error('artifact must have a unique identity')
      }
      projection.artifacts.push(artifact)
      return
    }
    case 'artifact.admitted': {
      const payload = payloadOf<{ artifact: Artifact }>(event)
      if (payload.artifact.jobId !== event.jobId || payload.artifact.sourceActionId || !payload.artifact.source) {
        throw new Error('admitted artifact requires job-owned intake provenance')
      }
      if (!payload.artifact.id || hasId(projection.artifacts, payload.artifact.id)) {
        throw new Error('artifact must have a unique identity')
      }
      projection.artifacts.push(payload.artifact)
      return
    }
    case 'effect.committed':
    case 'effect.reused': {
      const payload = payloadOf<{ effect: Effect }>(event)
      if (!hasId(projection.actions, payload.effect.actionId) || !hasId(projection.artifacts, payload.effect.artifactId ?? '')) {
        throw new Error('effect references unknown action or artifact')
      }
      validateIdentifier('effect id', payload.effect.id)
      if (hasId(projection.effects, payload.effect.id)) throw new Error('effect id is already committed')
      projection.effects.push(payload.effect)
      return
    }
    case 'evidence.linked': {
      const payload = payloadOf<{ evidence: Evidence }>(event)
      if (!payload.evidence.observationIds?.length || !payload.evidence.artifactIds?.length) {
        throw new Error('evidence requires observation and artifact references')
      }
      validateIdentifier('evidence id', payload.evidence.id)
      if (hasId(projection.evidence, payload.evidence.id)) throw new Error('evidence id is already linked')
      for (const id of payload.evidence.observationIds) {
        if (!hasId(projection.observations, id)) throw new Error('evidence references unknown observation')
      }
      for (const id of payload.evidence.artifactIds) {
        if (!hasId(projection.artifacts, id)) throw new Error('evidence references unknown artifact')
      }
      projection.evidence.push(payload.evidence)
      return
    }
    case 'evaluation.recorded': {
      const payload = payloadOf<{ evaluation: Evaluation }>(event)
      if (!payload.evaluation.evaluator || !payload.evaluation.version || !payload.evaluation.evidenceIds?.length) {
        throw new Error('evaluation requires evaluator version and evidence')
      }
      validateIdentifier('evaluation id', payload.evaluation.id)
      if (hasId(projection.evaluations, payload.evaluation.id)) {
        throw new Error('evaluation id is already recorded')
      }
      if (payload.evaluation.score < 0 || payload.evaluation.score > 1) {
        throw new Error('evaluation score must be between 0 and 1')
      }
      if (!['pass', 'fail', 'needs_review', 'inconclusive'].includes(payload.evaluation.verdict)) {
        throw new Error('unsupported evaluation verdict')
      }
      for (const id of payload.evaluation.evidenceIds) {
        if (!hasId(projection.evidence, id)) throw new Error('evaluation references unknown evidence')
      }
      projection.evaluations.push(payload.evaluation)
      return
    }
    case 'outcome.decided': {
      const payload = payloadOf<{ outcome: Outcome }>(event)
      if (projection.outcome) throw new Error('job outcome is already decided')
      if (!['succeeded', 'failed', 'cancelled'].includes(payload.outcome.status)) {
        throw new Error('unsupported outcome status')
      }
      if (payload.outcome.status === 'succeeded' && !hasPassingEvaluation(projection, payload.outcome.evaluationId ?? '')) {
        throw new Error('succeeded outcome requires referenced passing evaluation')
      }
      if (payload.outcome.evaluationId && !hasId(projection.evaluations, payload.outcome.evaluationId)) {
        throw new Error('outcome references unknown evaluation')
      }
      projection.outcome = payload.outcome
      return
    }
    case 'role.fact.committed': {
      const payload = payloadOf<{ fact: RoleFact }>(event)
      const fact = payload.fact
      validateIdentifier('role fact id', fact.id)
      if (!fact.packageId || fact.packageId !== projection.job.role || !fact.schemaVersion || !fact.kind) {
        throw new Error('role fact does not match the job package')
      }
      if ((fact.attemptId ?? '') !== (event.attemptId ?? '') || (fact.stepId ?? '') !== (event.stepId ?? '')) {
        throw new Error('role fact payload does not match event scope')
      }
      if (fact.data == null || hasId(projection.roleFacts, fact.id)) {
        throw new Error('role fact requires unique identity and valid data')
      }
      if (fact.attemptId && !hasId(projection.attempts, fact.attemptId)) {
        throw new Error('role fact references unknown attempt')
      }
      if (fact.stepId && !hasId(projection.steps, fact.stepId)) {
        throw new Error('role fact references unknown step')
      }
      for (const id of fact.artifactIds ?? []) {
        if (!hasId(projection.artifacts, id)) throw new Error('role fact references unknown artifact')
      }
      for (const id of fact.evidenceIds ?? []) {
        if (!hasId(projection.evidence, id)) throw new Error('role fact references unknown evidence')
      }
      projection.roleFacts.push(fact)
      return
    }
    case 'environment.prepared':
    case 'environment.released':
      return
    default:
      throw new Error(`unknown event kind ${JSON.stringify(event.kind as EventKind)}`)
  }
}

function payloadOf<T>(event: RuntimeEvent): T {
  return event.payload as T
}

function requireOutcome(projection: JobProjection, status: Outcome['status'], message: string): void {
  if (isTerminalStatus(projection.job.status)) throw new Error('job is already terminal')
  if (!projection.outcome || projection.outcome.status !== status) throw new Error(message)
}

function updateAttempt(projection: JobProjection, event: RuntimeEvent, status: AttemptStatus): void {
  const payload = payloadOf<{ attemptId: string; reason?: string }>(event)
  if (payload.attemptId !== event.attemptId) throw new Error('attempt payload does not match event attempt')
  const attempt = projection.attempts.find((value) => value.id === payload.attemptId)
  if (!attempt) throw new Error(`attempt ${JSON.stringify(payload.attemptId)} not found`)
  if (attempt.status !== 'running') throw new Error(`attempt ${JSON.stringify(payload.attemptId)} is already terminal`)
  attempt.status = status
  if (payload.reason) attempt.reason = payload.reason
  attempt.finishedAt = event.occurredAt
}

function updateStep(projection: JobProjection, event: RuntimeEvent, status: StepStatus): void {
  const payload = payloadOf<{ stepId: string }>(event)
  if (payload.stepId !== event.stepId) throw new Error('step payload does not match event step')
  const step = projection.steps.find((value) => value.id === payload.stepId)
  if (!step) throw new Error(`step ${JSON.stringify(payload.stepId)} not found`)
  if (step.status !== 'running') throw new Error(`step ${JSON.stringify(payload.stepId)} is already terminal`)
  step.status = status
  step.finishedAt = event.occurredAt
}

function updateAction(projection: JobProjection, event: RuntimeEvent, status: ActionStatus): void {
  const payload = payloadOf<{ actionId: string }>(event)
  const action = projection.actions.find((value) => value.id === payload.actionId)
  if (!action) throw new Error(`action ${JSON.stringify(payload.actionId)} not found`)
  const current = action.status
  const valid = (current === 'proposed' && (status === 'running' || status === 'failed'))
    || (current === 'running' && (status === 'completed' || status === 'failed'))
  if (!valid) throw new Error(`invalid action transition ${current} -> ${status}`)
  action.status = status
}

function hasId(values: Array<{ id: string }>, id: string): boolean {
  return Boolean(id) && values.some((value) => value.id === id)
}

function hasPassingEvaluation(projection: JobProjection, id: string): boolean {
  return projection.evaluations.some((evaluation) => evaluation.id === id && evaluation.verdict === 'pass')
}
