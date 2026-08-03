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
  kind: 'origin' | 'directory' | 'socket' | 'ssh' | 'lab' | 'browser_tab'
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

export type CTFEndpointProtocol = 'http' | 'https' | 'tcp' | 'ssh'
export type CTFEndpointRequester = 'user' | 'agent' | 'page'
export type CTFEndpointRequestStatus = 'pending' | 'approved' | 'denied'

export interface CTFEndpointRequestInput {
  protocol: CTFEndpointProtocol
  endpoint: string
  source: string
  purpose: string
}

export interface CTFEndpointRequest {
  id: string
  protocol: CTFEndpointProtocol
  host: string
  port: number
  target: CTFTarget
  source: string
  purpose: string
  requestedBy: CTFEndpointRequester
  status: CTFEndpointRequestStatus
  requestedAt: string
  decidedAt?: string
  scope?: CTFScopeGrant
}

export interface CTFChallengeRequest {
  title: string
  statement: string
  category: string
  collaborationMode: CTFCollaborationMode
  deferAgent?: boolean
  trackName?: string
  humanGoal?: string
  sourceKind?: string
  sourceUri?: string
  sourceTargets?: CTFTarget[]
  externalPlatform?: string
  externalAttemptId?: number
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
  externalPlatform?: string
  externalAttemptId?: number
  trackName: string
  humanGoal: string
  source: CTFChallengeSource
  materials: CTFMaterial[]
  knowledgePoints: string[]
  agentPolicy: CTFAgentWorkspacePolicy
  judgeType: string
  judgeVersion: string
  admittedAt: string
}

export interface CTFExperiment {
  id: string
  attemptId: string
  number: number
  status: StepRecord['status']
  startedAt: string
  finishedAt?: string
  action?: ActionRecord
  observations: ObservationRecord[]
  artifactIds: string[]
}

export interface CTFSubmission {
  candidate: string
  externalWrongCountBefore?: number
  verdict: Verdict
  summary: string
}

export interface CTFAgentCandidate {
  id: string
  sessionId: string
  candidate: string
  explanation: string
  artifactId: string
  assessment: {
    status: 'plausible' | 'unusual'
    warnings: string[]
  }
  createdAt: string
}

export interface CTFAgentRunMetrics {
  eventCount: number
  completedTurns: number
  toolCalls: number
  toolErrors: number
  toolUsage: Record<string, number>
  lastEventType?: string
  trajectorySha256?: string
}

export interface CTFAgentProgress {
  schemaVersion: string
  phase: '首轮分诊' | '探索中' | '验证中' | '卡关复盘' | '候选复核'
  lastVerifiedFact?: string
  currentHypothesis?: string
  nextAction?: string
  strategyNextAction?: string
  deadEnds: string[]
  needsReplan: boolean
  replanReason?: string
  recommendedRole: 'solver' | 'tool-builder' | 'strategist'
  updatedAt: string
}

export interface CTFAgentRun {
  attemptId: string
  sessionId: string
  model: string
  summary: string
  metrics: CTFAgentRunMetrics
  trajectoryArtifactId?: string
  startedAt: string
  finishedAt?: string
}

export interface CTFJudgeReceipt {
  id: string
  platform: string
  status: 'accepted' | 'rejected' | 'ambiguous' | 'error'
  correct?: boolean
  summary: string
  reference: string
  recordedAt: string
}

export interface CTFLearningRecordRequest {
  kind: 'hint' | 'reflection' | 'independent_step' | 'observation' | 'goal' | 'judge_observation'
  content: string
  concept?: string
  level?: number
}

export type CTFLearningActor = 'user' | 'agent' | 'shared' | 'imported'
export type CTFLearningAssistance = 'none' | 'hint' | 'copilot' | 'delegated'

export interface CTFLearningRecord {
  id: string
  kind: CTFLearningRecordRequest['kind']
  actor: CTFLearningActor
  assistance: CTFLearningAssistance
  content: string
  concept?: string
  level?: number
  createdAt: string
}

export interface CTFTrainingContribution {
  primaryActor: CTFLearningActor
  assistance: CTFLearningAssistance
  userRecords: number
  agentRecords: number
  sharedRecords: number
  importedRecords: number
  userIndependentSteps: number
  userAssistedSteps: number
}

export interface CTFHumanOutcome {
  goal: string
  knowledgePoints: string[]
  hintCount: number
  reflectionCount: number
  independentSteps: number
  contribution: CTFTrainingContribution
  summary: string
}

export interface CTFDebriefCandidate {
  candidate: string
  verdict: Verdict
  summary: string
}

export interface CTFDebrief {
  status: 'in_progress' | 'succeeded' | 'failed' | 'cancelled'
  summary: string
  keyObservations: string[]
  failureBranches: string[]
  candidates: CTFDebriefCandidate[]
  knowledgePoints: string[]
  hintCount: number
  reflectionCount: number
  independentSteps: number
  evidenceCount: number
  artifactCount: number
  needsReflection: boolean
  recommendedNextAction: string
}

export interface CTFArtifactPreview {
  artifact: ArtifactRecord
  previewable: boolean
  truncated: boolean
  content?: string
  reason?: string
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
  agentRuns: CTFAgentRun[]
  agentCandidates: CTFAgentCandidate[]
  submissions: CTFSubmission[]
  judgeReceipts: CTFJudgeReceipt[]
  endpointRequests: CTFEndpointRequest[]
  networkScopes: CTFScopeGrant[]
  learning: CTFLearningRecord[]
  humanOutcome: CTFHumanOutcome
  debrief: CTFDebrief
  outcome?: OutcomeRecord
  events: RuntimeEvent[]
}

export interface CTFAgentWorkspaceBudget {
  maxTurns: number
  maxWallMinutes: number
  maxWrongSubmissions: number
}

export interface CTFAgentBudgetStatus {
  budget: CTFAgentWorkspaceBudget
  usedTurns: number
  remainingTurns: number
  elapsedWallSeconds: number
  remainingWallSeconds: number
  wrongSubmissions: number
  remainingWrongSubmissions: number
  firstTurnStartedAt?: string
  checkedAt: string
  exhausted: boolean
  reason?: 'turn-budget-exhausted'
    | 'time-budget-exhausted'
    | 'wrong-submission-budget-exhausted'
}

export interface CTFAgentWorkspacePolicy {
  mode: CTFCollaborationMode
  label: string
  autonomy: 'guided' | 'joint' | 'independent' | 'bounded-builder' | 'review-only'
  startBehavior: string
  candidateRule: string
  allowedTools: string[]
  execution: {
    workspaceOnly: boolean
    defaultCommandTimeoutSeconds: number
    maxCommandTimeoutSeconds: number
    maxToolEventOutputBytes: number
  }
  budget: CTFAgentWorkspaceBudget
}

export interface CTFAgentMaterialInspection {
  detectedType: string
  archiveFormat?: string
  entryCount?: number
  uncompressedBytes?: number
  reviewRequired: boolean
  warnings: string[]
}

export interface CTFAgentWorkspaceMaterial {
  artifactId: string
  name: string
  mediaType: string
  sha256: string
  size: number
  provenance: string
  relativePath: string
  extractedPaths: string[]
  inspection: CTFAgentMaterialInspection
}

export interface CTFAgentWorkspaceHandoff {
  jobId: string
  conversationId: string
  role: 'solver' | 'tool-builder' | 'strategist'
  title: string
  workspacePath: string
  prompt: string
  policy: CTFAgentWorkspacePolicy
  budget: CTFAgentWorkspaceBudget
  materials: CTFAgentWorkspaceMaterial[]
  run: CTFAgentRunCheckpoint
}

export interface CTFToolRequestSummary {
  name: string
  relativePath: string
  status: 'pending' | 'ready' | 'blocked' | 'unknown'
  title: string
  updatedAt: string
}

export interface CTFToolWorkshopState {
  schemaVersion: string
  requests: CTFToolRequestSummary[]
  pendingCount: number
  readyCount: number
  blockedCount: number
  unknownCount: number
  toolCount: number
  latestRequest?: CTFToolRequestSummary
}

export interface CTFTrainingMemory {
  id: string
  schemaVersion: string
  kind: 'technique' | 'failure-lesson'
  verification: 'judge-verified' | 'user-confirmed' | 'failure-observed' | 'legacy-untyped'
  actor: CTFLearningActor
  assistance: CTFLearningAssistance
  title: string
  summary: string
  category: string
  tags: string[]
  sourceJobId: string
  sourceSessionId?: string
  evidenceRefs: string[]
  confidence: number
  path: string
  createdAt: string
  updatedAt: string
  archivedAt?: string
  archivedReason?: string
  recall?: CTFTrainingMemoryRecall
}

export interface CTFTrainingMemoryRecall {
  schemaVersion: string
  score: number
  reasons: string[]
  evidence: CTFTrainingMemoryEvidenceLink[]
}

export interface CTFTrainingMemoryEvidenceLink {
  kind: 'job' | 'session' | 'trajectory' | 'judge' | 'hint' | 'step' | 'failure' | string
  id: string
  label: string
}

export interface CTFAgentRunCheckpoint {
  schemaVersion: string
  jobId: string
  conversationId: string
  status: 'ready' | 'running' | 'awaiting-user' | 'paused' | 'failed'
  exitReason?: string
  model?: string
  startedAt: string
  updatedAt: string
  metrics: CTFAgentRunMetrics
  lastToolFingerprint?: string
  repeatedToolUses?: number
  lastFailureFingerprint?: string
  repeatedFailures?: number
  lastAssistantSummary?: string
  notesExcerpt?: string
  candidateCount: number
  latestCandidateSha256?: string
  progress?: CTFAgentProgress
}

export interface CTFAgentReplayEvent {
  sequence: number
  type: string
  timestamp?: string
  engine?: string
  toolName?: string
  text?: string
  error?: string
  truncated?: boolean
}

export interface CTFAgentReplay {
  schemaVersion: string
  jobId: string
  conversationId: string
  status: CTFAgentRunCheckpoint['status']
  exitReason?: string
  metrics: CTFAgentRunMetrics
  events: CTFAgentReplayEvent[]
  truncated: boolean
}

export interface CTFTrainingReportMaterial {
  name: string
  mediaType: string
  sha256: string
  size: number
  provenance: string
  detectedType: string
  archiveFormat?: string
  extractedFiles: number
  reviewRequired: boolean
  inspectionWarnings: string[]
}

export interface CTFTrainingReportJudge {
  platform: string
  status: string
  correct?: boolean
  summary: string
  reference: string
  recordedAt: string
}

export interface CTFTrainingReport {
  schemaVersion: string
  generatedAt: string
  jobId: string
  title: string
  trackName: string
  category: string
  collaborationMode: CTFCollaborationMode
  externalPlatform?: string
  sourceUri?: string
  status: string
  verified: boolean
  outcomeSummary?: string
  knowledgePoints: string[]
  materials: CTFTrainingReportMaterial[]
  toolUsage: Record<string, number>
  toolWorkshop?: {
    requests: CTFToolRequestSummary[]
    toolCount: number
    builderTurns: number
    builderToolCalls: number
    builderToolErrors: number
  }
  keyObservations: string[]
  failureBranches: string[]
  judgeReceipts: CTFTrainingReportJudge[]
  contribution: CTFTrainingContribution
  stats: {
    attempts: number
    experiments: number
    evidence: number
    artifacts: number
    completedTurns: number
    toolCalls: number
    toolErrors: number
    hints: number
    independentSteps: number
    reflections: number
    candidates: number
  }
  latestCandidateSha256?: string
  markdown: string
}

export interface CTFTrainingReportExport {
  report: CTFTrainingReport
  jsonPath: string
  markdownPath: string
}

export interface CTFSummary {
  id: string
  title: string
  category: string
  externalPlatform?: string
  externalAttemptId?: number
  status: JobStatus
  experimentCount: number
  verdict?: Verdict
  pendingSubmission: boolean
  pendingJudge: boolean
  updatedAt: string
}
