import { describe, expect, it } from 'vitest'
import {
  deriveCTFWorkspacePresentation,
  type CTFWorkspacePresentationInput,
} from './ctfWorkspacePresentation'

function state(
  overrides: Partial<CTFWorkspacePresentationInput> = {},
): CTFWorkspacePresentationInput {
  return {
    terminal: false,
    hasAgentRecoveryPoint: false,
    experimentCount: 0,
    evidenceCount: 0,
    artifactCount: 0,
    agentRunCount: 0,
    agentCandidateCount: 0,
    submissionCount: 0,
    judgeReceiptCount: 0,
    evaluationCount: 0,
    learningCount: 0,
    hintCount: 0,
    reflectionCount: 0,
    independentStepCount: 0,
    endpointRequestStatuses: [],
    candidate: '',
    platformReview: false,
    ...overrides,
  }
}

describe('deriveCTFWorkspacePresentation', () => {
  it('keeps a new challenge focused on its statement and primary Agent action', () => {
    expect(deriveCTFWorkspacePresentation(state())).toEqual({
      pendingEndpointCount: 0,
      showAgentComposer: false,
      showTrajectory: false,
      showEndpointAction: false,
      showSubmissionAction: false,
      showActionRail: false,
      hasReviewActivity: false,
    })
  })

  it('shows only the exact Endpoint decision when an address needs approval', () => {
    expect(deriveCTFWorkspacePresentation(state({
      endpointRequestStatuses: ['approved', 'pending', 'denied'],
    }))).toMatchObject({
      pendingEndpointCount: 1,
      showEndpointAction: true,
      showSubmissionAction: false,
      showActionRail: true,
    })
  })

  it('shows the submission action only after a candidate exists', () => {
    expect(deriveCTFWorkspacePresentation(state({
      agentCandidateCount: 1,
      candidate: 'flag{verified_candidate}',
    }))).toMatchObject({
      showEndpointAction: false,
      showSubmissionAction: true,
      showActionRail: true,
      hasReviewActivity: true,
    })
  })

  it('reveals trajectory, composer, and review after real solve activity', () => {
    expect(deriveCTFWorkspacePresentation(state({
      hasAgentRecoveryPoint: true,
      agentRunCount: 1,
      experimentCount: 2,
      evidenceCount: 1,
    }))).toMatchObject({
      showAgentComposer: true,
      showTrajectory: true,
      showActionRail: false,
      hasReviewActivity: true,
    })
  })

  it('does not offer stale solve actions after a terminal outcome', () => {
    expect(deriveCTFWorkspacePresentation(state({
      terminal: true,
      endpointRequestStatuses: ['pending'],
      candidate: 'flag{done}',
    }))).toMatchObject({
      showAgentComposer: false,
      showEndpointAction: false,
      showSubmissionAction: false,
      showActionRail: false,
      hasReviewActivity: true,
    })
  })
})
