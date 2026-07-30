import type {
  ActionRecord,
  ArtifactRecord,
  EvidenceRecord,
  EvaluationRecord,
  JobRecord,
  JobStatus,
  ObservationRecord,
  OutcomeRecord,
  RuntimeEvent,
  StepRecord,
  Verdict,
} from './runtimeTypes'
import type { CTFScopeGrant } from './ctfTypes'

export interface VulnTarget {
  id: string
  name: string
  version: string
  component: string
  fixture: string
  collaborationMode: string
  scope: CTFScopeGrant
  sourceArtifactId: string
  readmeArtifactId: string
  admittedAt: string
}

export interface VulnAttackSurface {
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

export interface VulnHypothesis {
  id: string
  statement: string
  status: string
  rationale: string
  nextExperiment: string
  recordedAt: string
  evidenceIds: string[]
}

export interface VulnRootCause {
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

export interface VulnEnvironmentFingerprint {
  compiler: string
  sanitizer: string
  os: string
  architecture: string
}

export interface VulnReproductionRun {
  number: number
  exitCode: number
  sanitizerLog: string
  observedAt: string
}

export interface VulnReproductionRequest {
  triggerSha256: string
  triggerSize: number
  environment: VulnEnvironmentFingerprint
  runs: VulnReproductionRun[]
  cleanRunAttested: boolean
  attestation: string
}

export interface VulnReproduction {
  id: string
  triggerSha256: string
  triggerSize: number
  environment: VulnEnvironmentFingerprint
  runs: VulnReproductionRun[]
  stableRuns: number
  totalRuns: number
  fingerprint: string
  summary: string
  cleanRunAttested: boolean
  attestation: string
  recordedAt: string
  evidenceIds: string[]
  artifactIds: string[]
}

export interface VulnLearningRecordRequest {
  kind: 'reflection' | 'independent_step' | 'variant'
  content: string
  concept?: string
}

export interface VulnLearningRecord {
  id: string
  kind: VulnLearningRecordRequest['kind']
  content: string
  concept?: string
  createdAt: string
}

export interface VulnHumanOutcome {
  goal: string
  reflectionCount: number
  independentSteps: number
  variantCount: number
  summary: string
}

export interface VulnExperiment {
  id: string
  number: number
  name: string
  description: string
  status: StepRecord['status']
  action?: ActionRecord
  observations: ObservationRecord[]
  artifactIds: string[]
}

export interface VulnProjection {
  contractVersion: string
  job: JobRecord
  target: VulnTarget
  attackSurface?: VulnAttackSurface
  hypotheses: VulnHypothesis[]
  experiments: VulnExperiment[]
  reproduction?: VulnReproduction
  rootCause?: VulnRootCause
  artifacts: ArtifactRecord[]
  evidence: EvidenceRecord[]
  evaluations: EvaluationRecord[]
  learning: VulnLearningRecord[]
  humanOutcome: VulnHumanOutcome
  outcome?: OutcomeRecord
  events: RuntimeEvent[]
}

export interface VulnSummary {
  id: string
  title: string
  version: string
  status: JobStatus
  hypothesisCount: number
  reproductionState: string
  verdict?: Verdict
  updatedAt: string
}
