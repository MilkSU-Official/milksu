export type JobStatus =
  | 'queued'
  | 'running'
  | 'cancelling'
  | 'recovering'
  | 'succeeded'
  | 'failed'
  | 'cancelled'

export type Verdict = 'pass' | 'fail' | 'needs_review' | 'inconclusive' | ''

export interface JobRecord {
  id: string
  title: string
  role: string
  collaborationMode: string
  status: JobStatus
  createdAt: string
  updatedAt: string
}

export interface JobSummary {
  id: string
  title: string
  role: string
  status: JobStatus
  attemptCount: number
  evidenceCount: number
  verdict?: Verdict
  createdAt: string
  updatedAt: string
}

export interface AttemptRecord {
  id: string
  jobId: string
  engine: string
  model: string
  environment: string
  evaluator: string
  status: string
  startedAt: string
  finishedAt?: string
  reason?: string
}

export interface StepRecord {
  id: string
  attemptId: string
  name: string
  description: string
  status: string
  startedAt: string
  finishedAt?: string
}

export interface ActionRecord {
  id: string
  stepId: string
  capability: string
  name: string
  status: string
  expectedEffect: {
    class: string
    idempotencyKey: string
    cleanup: string
    approval: string
    scopeCheck: string
  }
}

export interface ObservationRecord {
  id: string
  actionId: string
  summary: string
  mediaType: string
  complete: boolean
}

export interface ArtifactRecord {
  id: string
  jobId: string
  sourceActionId: string
  sha256: string
  mediaType: string
  size: number
  relativePath: string
}

export interface EffectRecord {
  id: string
  actionId: string
  class: string
  idempotencyKey: string
  state: string
  cleanup: string
  artifactId?: string
}

export interface EvidenceRecord {
  id: string
  claim: string
  observationIds: string[]
  artifactIds: string[]
  provenance: string
}

export interface EvaluationRecord {
  id: string
  evaluator: string
  version: string
  verdict: Verdict
  score: number
  summary: string
  evidenceIds: string[]
}

export interface OutcomeRecord {
  status: 'succeeded' | 'failed' | 'cancelled'
  summary: string
  evaluationId?: string
}

export interface RuntimeEvent {
  schemaVersion: number
  eventId: string
  jobId: string
  attemptId?: string
  stepId?: string
  sequence: number
  kind: string
  occurredAt: string
  payload: Record<string, unknown>
}

export interface JobProjection {
  contractVersion: string
  job: JobRecord
  attempts: AttemptRecord[]
  steps: StepRecord[]
  actions: ActionRecord[]
  observations: ObservationRecord[]
  artifacts: ArtifactRecord[]
  effects: EffectRecord[]
  evidence: EvidenceRecord[]
  evaluations: EvaluationRecord[]
  outcome?: OutcomeRecord
  events: RuntimeEvent[]
}
