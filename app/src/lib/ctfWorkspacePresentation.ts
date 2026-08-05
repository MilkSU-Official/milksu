import type { CTFEndpointRequestStatus } from '@/ctfTypes'

export interface CTFWorkspacePresentationInput {
  terminal: boolean
  hasAgentRecoveryPoint: boolean
  experimentCount: number
  evidenceCount: number
  artifactCount: number
  agentRunCount: number
  agentCandidateCount: number
  submissionCount: number
  judgeReceiptCount: number
  evaluationCount: number
  learningCount: number
  hintCount: number
  reflectionCount: number
  independentStepCount: number
  endpointRequestStatuses: CTFEndpointRequestStatus[]
  candidate: string
  platformReview: boolean
}

export interface CTFWorkspacePresentation {
  pendingEndpointCount: number
  showAgentComposer: boolean
  showTrajectory: boolean
  showEndpointAction: boolean
  showSubmissionAction: boolean
  showActionRail: boolean
  showDebrief: boolean
  showEvidenceSummary: boolean
  showEndpointHistory: boolean
  showReviewMain: boolean
  showReviewSidebar: boolean
  hasReviewActivity: boolean
}

export function deriveCTFWorkspacePresentation(
  input: CTFWorkspacePresentationInput,
): CTFWorkspacePresentation {
  const pendingEndpointCount = input.endpointRequestStatuses.filter(
    status => status === 'pending',
  ).length
  const hasAgentActivity = input.hasAgentRecoveryPoint
    || input.agentRunCount > 0
    || input.experimentCount > 0
    || input.evidenceCount > 0
  const showTrajectory = input.agentRunCount > 0
    || input.experimentCount > 0
    || input.evidenceCount > 0
  const showEndpointAction = !input.terminal && pendingEndpointCount > 0
  const hasEndpointDecision = input.endpointRequestStatuses.some(
    status => status !== 'pending',
  )
  const showSubmissionAction = !input.terminal && (
    Boolean(input.candidate.trim())
    || input.agentCandidateCount > 0
    || input.platformReview
  )
  const showDebrief = input.terminal
    || showTrajectory
    || input.agentCandidateCount > 0
    || input.submissionCount > 0
    || input.judgeReceiptCount > 0
    || input.evaluationCount > 0
    || input.learningCount > 0
    || input.hintCount > 0
    || input.reflectionCount > 0
    || input.independentStepCount > 0
  const showEvidenceSummary = input.experimentCount > 0
    || input.evidenceCount > 0
    || input.artifactCount > 0
    || input.judgeReceiptCount > 0
    || input.evaluationCount > 0
  const showEndpointHistory = hasEndpointDecision
  const showReviewMain = showDebrief
    || input.artifactCount > 0
    || input.agentRunCount > 0
    || input.agentCandidateCount > 0
  const showReviewSidebar = showEvidenceSummary || showEndpointHistory
  const hasReviewActivity = showReviewMain || showReviewSidebar

  return {
    pendingEndpointCount,
    showAgentComposer: !input.terminal && hasAgentActivity,
    showTrajectory,
    showEndpointAction,
    showSubmissionAction,
    showActionRail: showEndpointAction || showSubmissionAction,
    showDebrief,
    showEvidenceSummary,
    showEndpointHistory,
    showReviewMain,
    showReviewSidebar,
    hasReviewActivity,
  }
}
