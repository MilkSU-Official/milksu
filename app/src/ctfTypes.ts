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

export interface CTFChallengeRequest {
  title: string
  statement: string
  category: string
  collaborationMode: 'delegate'
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
  collaborationMode: string
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
