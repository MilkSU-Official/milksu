import type {
  ArtifactRecord,
  AttemptRecord,
  EvidenceRecord,
  EvaluationRecord,
  JobRecord,
  JobStatus,
  ObservationRecord,
  OutcomeRecord,
  RuntimeEvent,
  StepRecord,
  ActionRecord,
  Verdict,
} from './runtimeTypes'

export interface CTFMaterialRequest {
  name: string
  mediaType: string
  dataBase64: string
  provenance: string
}

export type CTFCollaborationMode = 'coach' | 'copilot' | 'delegate'

export interface CTFTarget {
  kind: 'origin' | 'directory' | 'socket' | 'lab' | 'browser_tab'
  value: string
}

export interface CTFScopeGrant {
  id: string
  source: string
  purpose: string
  targets: CTFTarget[]
  grantedBy: string
  createdAt: string
  expiresAt: string
  revocable: boolean
  revokedAt?: string
}

export interface CTFChallengeSource {
  kind: string
  uri?: string
  scope: CTFScopeGrant
}

export interface CTFChallengeRequest {
  title: string
  statement: string
  category: string
  collaborationMode: CTFCollaborationMode
  trackName?: string
  humanGoal?: string
  sourceKind?: string
  sourceUri?: string
  expectedFlag: string
  knowledgePoints: string[]
  materials: CTFMaterialRequest[]
}

export interface CTFMaterial {
  artifactId: string
  name: string
  mediaType: string
  sha256: string
  size: number
  provenance: string
}

export interface CTFChallenge {
  id: string
  title: string
  statement: string
  category: string
  collaborationMode: CTFCollaborationMode
  trackName: string
  humanGoal: string
  source: CTFChallengeSource
  materials: CTFMaterial[]
  knowledgePoints: string[]
  judgeType: string
  judgeVersion: string
  admittedAt: string
}

export interface CTFExperiment {
  id: string
  number: number
  status: StepRecord['status']
  action?: ActionRecord
  observations: ObservationRecord[]
  artifactIds: string[]
}

export interface CTFSubmission {
  candidate: string
  verdict: Verdict
  summary: string
}

export interface CTFLearningRecordRequest {
  kind: 'hint' | 'reflection' | 'independent_step' | 'goal'
  content: string
  concept?: string
  level?: number
}

export interface CTFLearningRecord {
  id: string
  kind: CTFLearningRecordRequest['kind']
  content: string
  concept?: string
  level?: number
  createdAt: string
}

export interface CTFHumanOutcome {
  goal: string
  knowledgePoints: string[]
  hintCount: number
  reflectionCount: number
  independentSteps: number
  summary: string
}

export interface CTFProjection {
  contractVersion: string
  job: JobRecord
  challenge: CTFChallenge
  attempts: AttemptRecord[]
  experiments: CTFExperiment[]
  artifacts: ArtifactRecord[]
  evidence: EvidenceRecord[]
  evaluations: EvaluationRecord[]
  submissions: CTFSubmission[]
  learning: CTFLearningRecord[]
  humanOutcome: CTFHumanOutcome
  outcome?: OutcomeRecord
  events: RuntimeEvent[]
}

export interface CTFSummary {
  id: string
  title: string
  category: string
  status: JobStatus
  experimentCount: number
  verdict?: Verdict
  updatedAt: string
}
