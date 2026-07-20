package securityruntime

import (
	"context"
	"fmt"
)

// EventScope identifies the core objects a committed fact belongs to.
type EventScope struct {
	JobID     string
	AttemptID string
	StepID    string
}

func NewIdentifier(prefix string) string {
	return newID(prefix)
}

func (s *Service) CreateJob(ctx context.Context, job Job) error {
	_, err := s.append(ctx, EventDraft{JobID: job.ID, Kind: EventJobCreated, Payload: jobCreatedPayload{Job: job}})
	return err
}

func (s *Service) RequestCancellation(ctx context.Context, jobID, reason string) error {
	_, err := s.append(ctx, EventDraft{JobID: jobID, Kind: EventJobCancelRequested, Payload: reasonPayload{Reason: reason}})
	return err
}

func (s *Service) RecordRecovery(ctx context.Context, jobID, previousAttemptID string) error {
	_, err := s.append(ctx, EventDraft{
		JobID: jobID, Kind: EventJobRecoveryStarted,
		Payload: recoveryPayload{PreviousAttemptID: previousAttemptID},
	})
	return err
}

func (s *Service) StartAttempt(ctx context.Context, attempt Attempt) error {
	_, err := s.append(ctx, EventDraft{
		JobID: attempt.JobID, AttemptID: attempt.ID, Kind: EventAttemptStarted,
		Payload: attemptPayload{Attempt: attempt},
	})
	return err
}

func (s *Service) FinishAttempt(ctx context.Context, jobID, attemptID string, status AttemptStatus, reason string) error {
	kind := EventAttemptCompleted
	switch status {
	case AttemptCompleted:
	case AttemptInterrupted:
		kind = EventAttemptInterrupted
	case AttemptFailed:
		kind = EventAttemptFailed
	default:
		return fmt.Errorf("unsupported terminal attempt status %q", status)
	}
	_, err := s.append(ctx, EventDraft{
		JobID: jobID, AttemptID: attemptID, Kind: kind,
		Payload: attemptStatePayload{AttemptID: attemptID, Reason: reason},
	})
	return err
}

func (s *Service) RecordEnvironment(ctx context.Context, scope EventScope, lease EnvironmentLease, prepared bool) error {
	kind := EventEnvironmentReleased
	if prepared {
		kind = EventEnvironmentPrepared
	}
	_, err := s.append(ctx, EventDraft{
		JobID: scope.JobID, AttemptID: scope.AttemptID, StepID: scope.StepID,
		Kind: kind, Payload: environmentPayload{Lease: lease},
	})
	return err
}

func (s *Service) StartStep(ctx context.Context, scope EventScope, step Step) error {
	_, err := s.append(ctx, EventDraft{
		JobID: scope.JobID, AttemptID: scope.AttemptID, StepID: step.ID,
		Kind: EventStepStarted, Payload: stepPayload{Step: step},
	})
	return err
}

func (s *Service) FinishStep(ctx context.Context, scope EventScope, status StepStatus, reason string) error {
	kind := EventStepCompleted
	switch status {
	case StepCompleted:
	case StepFailed:
		kind = EventStepFailed
	default:
		return fmt.Errorf("unsupported terminal step status %q", status)
	}
	_, err := s.append(ctx, EventDraft{
		JobID: scope.JobID, AttemptID: scope.AttemptID, StepID: scope.StepID,
		Kind: kind, Payload: stepStatePayload{StepID: scope.StepID, Reason: reason},
	})
	return err
}

func (s *Service) ProposeAction(ctx context.Context, scope EventScope, action Action) error {
	_, err := s.append(ctx, EventDraft{
		JobID: scope.JobID, AttemptID: scope.AttemptID, StepID: scope.StepID,
		Kind: EventActionProposed, Payload: actionPayload{Action: action},
	})
	return err
}

func (s *Service) SetActionStatus(ctx context.Context, scope EventScope, actionID string, status ActionStatus, reason string) error {
	kind := EventActionStarted
	switch status {
	case ActionRunning:
	case ActionCompleted:
		kind = EventActionCompleted
	case ActionFailed:
		kind = EventActionFailed
	default:
		return fmt.Errorf("unsupported action status %q", status)
	}
	_, err := s.append(ctx, EventDraft{
		JobID: scope.JobID, AttemptID: scope.AttemptID, StepID: scope.StepID,
		Kind: kind, Payload: actionStatePayload{ActionID: actionID, Reason: reason},
	})
	return err
}

func (s *Service) CommitObservation(ctx context.Context, scope EventScope, observation Observation) error {
	_, err := s.append(ctx, EventDraft{
		JobID: scope.JobID, AttemptID: scope.AttemptID, StepID: scope.StepID,
		Kind: EventObservationCommitted, Payload: observationPayload{Observation: observation},
	})
	return err
}

func (s *Service) AdmitArtifact(ctx context.Context, jobID, source, mediaType string, data []byte) (Artifact, bool, error) {
	artifact, created, err := s.artifacts.Admit(ctx, jobID, source, mediaType, data)
	if err != nil {
		return Artifact{}, false, err
	}
	_, err = s.appendCommitted(EventDraft{
		JobID: jobID, Kind: EventArtifactAdmitted,
		Payload: artifactPayload{Artifact: artifact, Created: created},
	})
	return artifact, created, err
}

func (s *Service) CommitActionArtifact(ctx context.Context, scope EventScope, actionID, mediaType string, data []byte) (Artifact, bool, bool, error) {
	artifact, created, err := s.artifacts.Put(ctx, scope.JobID, actionID, mediaType, data)
	if err != nil {
		return Artifact{}, false, false, err
	}
	if !created {
		projection, projectionErr := s.store.Projection(ctx, scope.JobID)
		if projectionErr != nil {
			return Artifact{}, false, false, projectionErr
		}
		for _, existing := range projection.Artifacts {
			if existing.SHA256 == artifact.SHA256 && existing.MediaType == artifact.MediaType {
				return existing, false, true, nil
			}
		}
	}
	_, err = s.appendCommitted(EventDraft{
		JobID: scope.JobID, AttemptID: scope.AttemptID, StepID: scope.StepID,
		Kind: EventArtifactCommitted, Payload: artifactPayload{Artifact: artifact, Created: created},
	})
	return artifact, created, false, err
}

func (s *Service) ReadArtifact(ctx context.Context, artifact Artifact) ([]byte, error) {
	return s.artifacts.Read(ctx, artifact)
}

func (s *Service) CommitEffect(ctx context.Context, scope EventScope, effect Effect, reused bool) error {
	kind := EventEffectCommitted
	if reused {
		kind = EventEffectReused
	}
	_, err := s.append(ctx, EventDraft{
		JobID: scope.JobID, AttemptID: scope.AttemptID, StepID: scope.StepID,
		Kind: kind, Payload: effectPayload{Effect: effect},
	})
	return err
}

func (s *Service) LinkEvidence(ctx context.Context, scope EventScope, evidence Evidence) error {
	_, err := s.append(ctx, EventDraft{
		JobID: scope.JobID, AttemptID: scope.AttemptID, StepID: scope.StepID,
		Kind: EventEvidenceLinked, Payload: evidencePayload{Evidence: evidence},
	})
	return err
}

func (s *Service) RecordEvaluation(ctx context.Context, scope EventScope, evaluation Evaluation) error {
	_, err := s.append(ctx, EventDraft{
		JobID: scope.JobID, AttemptID: scope.AttemptID, StepID: scope.StepID,
		Kind: EventEvaluationRecorded, Payload: evaluationPayload{Evaluation: evaluation},
	})
	return err
}

func (s *Service) DecideOutcome(ctx context.Context, scope EventScope, outcome Outcome) error {
	_, err := s.append(ctx, EventDraft{
		JobID: scope.JobID, AttemptID: scope.AttemptID, StepID: scope.StepID,
		Kind: EventOutcomeDecided, Payload: outcomePayload{Outcome: outcome},
	})
	return err
}

func (s *Service) FinishJob(ctx context.Context, jobID string, status JobStatus, reason string) error {
	kind := EventJobFailed
	switch status {
	case JobSucceeded:
		kind = EventJobCompleted
	case JobFailed:
	case JobCancelled:
		kind = EventJobCancelled
	default:
		return fmt.Errorf("unsupported terminal job status %q", status)
	}
	_, err := s.append(ctx, EventDraft{JobID: jobID, Kind: kind, Payload: reasonPayload{Reason: reason}})
	return err
}

func (s *Service) CommitRoleFact(ctx context.Context, scope EventScope, fact RoleFact) error {
	_, err := s.append(ctx, EventDraft{
		JobID: scope.JobID, AttemptID: scope.AttemptID, StepID: scope.StepID,
		Kind: EventRoleFactCommitted, Payload: roleFactPayload{Fact: fact},
	})
	return err
}
