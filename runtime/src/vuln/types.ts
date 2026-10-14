import type { ScopeGrant } from './policy.ts'

export const PACKAGE_ID = 'vuln.research'
export const SCHEMA_VERSION = 'vuln.milksu.dev/v1alpha1'
export const CONTRACT_VERSION = 'runtime.milksu.dev/v1alpha1'
export const EVENT_SCHEMA_VERSION = 1

export const FACT_TARGET_ADMITTED = 'target.admitted'
export const FACT_ATTACK_SURFACE_RECORDED = 'attack_surface.recorded'
export const FACT_HYPOTHESIS_RECORDED = 'hypothesis.recorded'
export const FACT_REPRODUCTION_RECORDED = 'reproduction.recorded'
export const FACT_ROOT_CAUSE_RECORDED = 'root_cause.recorded'
export const FACT_LEARNING_RECORDED = 'learning.recorded'
export const FACT_LEARNING_FORGOTTEN = 'learning.forgotten'
export const FACT_ASSET_VERIFICATION_RECORDED = 'asset_verification.recorded'

export type JobStatus =
  | 'queued'
  | 'running'
  | 'cancelling'
  | 'recovering'
  | 'succeeded'
  | 'failed'
  | 'cancelled'

export type AttemptStatus = 'running' | 'completed' | 'interrupted' | 'failed'
export type StepStatus = 'running' | 'completed' | 'failed'
export type ActionStatus = 'proposed' | 'running' | 'completed' | 'failed'
export type Verdict = 'pass' | 'fail' | 'needs_review' | 'inconclusive' | ''
export type OutcomeStatus = 'succeeded' | 'failed' | 'cancelled'

export type Job = {
  id: string
  title: string
  role: string
  collaborationMode: string
  status: JobStatus
  createdAt: string
  updatedAt: string
}

export type Attempt = {
  id: string
  jobId: string
  engine: string
  model: string
  environment: string
  evaluator: string
  status: AttemptStatus
  startedAt: string
  finishedAt?: string
  reason?: string
}

export type Step = {
  id: string
  attemptId: string
  name: string
  description: string
  status: StepStatus
  startedAt: string
  finishedAt?: string
}

export type EffectSpec = {
  class: string
  idempotencyKey: string
  cleanup: string
  approval: string
  scopeCheck: string
}

export type Action = {
  id: string
  stepId: string
  capability: string
  name: string
  input: unknown
  rationale?: string
  expectedEffect: EffectSpec
  status: ActionStatus
}

export type Observation = {
  id: string
  actionId: string
  summary: string
  mediaType: string
  complete: boolean
}

export type Artifact = {
  id: string
  jobId: string
  sourceActionId?: string
  source: string
  sha256: string
  mediaType: string
  size: number
  relativePath: string
}

export type RoleFact = {
  id: string
  packageId: string
  schemaVersion: string
  kind: string
  attemptId?: string
  stepId?: string
  artifactIds?: string[]
  evidenceIds?: string[]
  data: unknown
}

export type Effect = {
  id: string
  actionId: string
  class: string
  idempotencyKey: string
  state: string
  cleanup: string
  artifactId?: string
}

export type Evidence = {
  id: string
  claim: string
  observationIds: string[]
  artifactIds: string[]
  provenance: string
}

export type Evaluation = {
  id: string
  evaluator: string
  version: string
  verdict: Verdict
  score: number
  summary: string
  evidenceIds: string[]
}

export type Outcome = {
  status: OutcomeStatus
  summary: string
  evaluationId?: string
}

export type EnvironmentLease = {
  id: string
  provider: string
  target: string
  resettable: boolean
}

export type EventKind =
  | 'job.created'
  | 'job.cancel.requested'
  | 'job.recovery.started'
  | 'job.completed'
  | 'job.failed'
  | 'job.cancelled'
  | 'attempt.started'
  | 'attempt.completed'
  | 'attempt.interrupted'
  | 'attempt.failed'
  | 'environment.prepared'
  | 'environment.released'
  | 'step.started'
  | 'step.completed'
  | 'step.failed'
  | 'action.proposed'
  | 'action.started'
  | 'action.completed'
  | 'action.failed'
  | 'observation.committed'
  | 'artifact.committed'
  | 'artifact.admitted'
  | 'effect.committed'
  | 'effect.reused'
  | 'evidence.linked'
  | 'evaluation.recorded'
  | 'outcome.decided'
  | 'role.fact.committed'

export type RuntimeEvent = {
  schemaVersion: number
  eventId: string
  jobId: string
  attemptId?: string
  stepId?: string
  sequence: number
  kind: EventKind
  occurredAt: string
  payload: unknown
}

export type EventDraft = {
  jobId: string
  attemptId?: string
  stepId?: string
  kind: EventKind
  payload: unknown
}

export type JobProjection = {
  contractVersion: string
  job: Job
  attempts: Attempt[]
  steps: Step[]
  actions: Action[]
  observations: Observation[]
  artifacts: Artifact[]
  effects: Effect[]
  evidence: Evidence[]
  evaluations: Evaluation[]
  roleFacts: RoleFact[]
  outcome?: Outcome
  events: RuntimeEvent[]
}

export type EventScope = {
  jobId: string
  attemptId?: string
  stepId?: string
}

export type Target = {
  id: string
  name: string
  version: string
  component: string
  fixture: string
  collaborationMode: string
  scope: ScopeGrant
  sourceArtifactId: string
  readmeArtifactId: string
  admittedAt: string
}

export type AttackSurface = {
  id: string
  entryPoint: string
  input: string
  dataFlow: string
  sink: string
  sourceLine: number
  summary: string
  recordedAt: string
  evidenceIds: string[]
}

export type Hypothesis = {
  id: string
  statement: string
  status: string
  rationale: string
  nextExperiment: string
  recordedAt: string
  evidenceIds: string[]
}

export type RootCause = {
  id: string
  summary: string
  technicalDetail: string
  impact: string
  exploitability: string
  sourceLine: number
  status: string
  recordedAt: string
  evidenceIds: string[]
}

export type LearningRecordRequest = {
  kind: string
  content: string
  concept?: string
}

export type AssetVerificationRequest = {
  name: string
  address: string
  environment: string
  status?: string
  summary?: string
}

export type TrackingWorkspaceRequest = {
  cveId: string
  title: string
  summary?: string
  referenceHref?: string
}

export type LearningRecord = {
  id: string
  kind: string
  content: string
  concept?: string
  createdAt: string
}

export type AssetVerification = {
  id: string
  name: string
  address: string
  environment: string
  status: string
  summary?: string
  recordedAt: string
}

export type HumanOutcomeView = {
  goal: string
  reflectionCount: number
  independentSteps: number
  variantCount: number
  summary: string
}

export type ExperimentView = {
  id: string
  number: number
  name: string
  description: string
  status: StepStatus
  action?: Action
  observations: Observation[]
  artifactIds: string[]
}

export type VulnProjection = {
  contractVersion: string
  job: Job
  target: Target
  attackSurface?: AttackSurface
  hypotheses: Hypothesis[]
  experiments: ExperimentView[]
  reproduction?: unknown
  rootCause?: RootCause
  artifacts: Artifact[]
  evidence: Evidence[]
  evaluations: Evaluation[]
  learning: LearningRecord[]
  assetVerifications: AssetVerification[]
  humanOutcome: HumanOutcomeView
  outcome?: Outcome
  events: RuntimeEvent[]
}

export type VulnSummary = {
  id: string
  title: string
  version: string
  status: JobStatus
  hypothesisCount: number
  reproductionState: string
  verdict?: Verdict
  updatedAt: string
}

export function isTerminalStatus(status: JobStatus): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'cancelled'
}
