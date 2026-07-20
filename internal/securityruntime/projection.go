package securityruntime

import (
	"encoding/json"
	"fmt"
)

func Project(events []Event) (JobProjection, error) {
	projection := JobProjection{
		ContractVersion: ContractVersion,
		Attempts:        []Attempt{},
		Steps:           []Step{},
		Actions:         []Action{},
		Observations:    []Observation{},
		Artifacts:       []Artifact{},
		Effects:         []Effect{},
		Evidence:        []Evidence{},
		Evaluations:     []Evaluation{},
		RoleFacts:       []RoleFact{},
		Events:          append([]Event{}, events...),
	}

	var previousSequence int64
	for index, event := range events {
		if event.SchemaVersion != 1 {
			return JobProjection{}, fmt.Errorf("unsupported event schema version %d", event.SchemaVersion)
		}
		if index == 0 && event.Sequence != 1 {
			return JobProjection{}, fmt.Errorf("event sequence must start at 1")
		}
		if index > 0 && event.Sequence != previousSequence+1 {
			return JobProjection{}, fmt.Errorf("event sequence gap at %d", event.Sequence)
		}
		previousSequence = event.Sequence
		if err := applyEvent(&projection, event); err != nil {
			return JobProjection{}, fmt.Errorf("apply %s: %w", event.Kind, err)
		}
		if !event.OccurredAt.IsZero() && !projection.Job.CreatedAt.IsZero() {
			projection.Job.UpdatedAt = event.OccurredAt
		}
	}
	return projection, nil
}

func applyEvent(projection *JobProjection, event Event) error {
	switch event.Kind {
	case EventJobCreated:
		var payload jobCreatedPayload
		if err := decodePayload(event, &payload); err != nil {
			return err
		}
		if projection.Job.ID != "" {
			return fmt.Errorf("job already exists")
		}
		if payload.Job.ID != event.JobID {
			return fmt.Errorf("job payload does not match event job")
		}
		projection.Job = payload.Job
		projection.Job.Status = JobQueued
	case EventJobCancelRequested:
		if projection.Terminal() {
			return fmt.Errorf("cannot cancel terminal job")
		}
		projection.Job.Status = JobCancelling
	case EventJobRecoveryStarted:
		if projection.Terminal() {
			return fmt.Errorf("cannot recover terminal job")
		}
		projection.Job.Status = JobRecovering
	case EventJobCompleted:
		if projection.Terminal() {
			return fmt.Errorf("job is already terminal")
		}
		if projection.Outcome == nil || projection.Outcome.Status != OutcomeSucceeded {
			return fmt.Errorf("completed job requires succeeded outcome")
		}
		projection.Job.Status = JobSucceeded
	case EventJobFailed:
		if projection.Terminal() {
			return fmt.Errorf("job is already terminal")
		}
		if projection.Outcome == nil || projection.Outcome.Status != OutcomeFailed {
			return fmt.Errorf("failed job requires failed outcome")
		}
		projection.Job.Status = JobFailed
	case EventJobCancelled:
		if projection.Terminal() {
			return fmt.Errorf("job is already terminal")
		}
		if projection.Outcome == nil || projection.Outcome.Status != OutcomeCancelled {
			return fmt.Errorf("cancelled job requires cancelled outcome")
		}
		projection.Job.Status = JobCancelled
	case EventAttemptStarted:
		if projection.Terminal() {
			return fmt.Errorf("cannot start attempt for terminal job")
		}
		var payload attemptPayload
		if err := decodePayload(event, &payload); err != nil {
			return err
		}
		if payload.Attempt.JobID != event.JobID {
			return fmt.Errorf("attempt does not belong to event job")
		}
		if payload.Attempt.ID != event.AttemptID {
			return fmt.Errorf("attempt payload does not match event attempt")
		}
		if err := validateIdentifier("attempt id", payload.Attempt.ID); err != nil {
			return err
		}
		if payload.Attempt.Status != AttemptRunning || hasAttempt(*projection, payload.Attempt.ID) {
			return fmt.Errorf("attempt must be a new running attempt")
		}
		for _, attempt := range projection.Attempts {
			if attempt.Status == AttemptRunning {
				return fmt.Errorf("cannot start a second running attempt")
			}
		}
		projection.Attempts = append(projection.Attempts, payload.Attempt)
		projection.Job.Status = JobRunning
	case EventAttemptCompleted:
		var payload attemptStatePayload
		if err := decodePayload(event, &payload); err != nil {
			return err
		}
		return updateAttempt(projection, payload.AttemptID, AttemptCompleted, payload.Reason, event)
	case EventAttemptInterrupted:
		var payload attemptStatePayload
		if err := decodePayload(event, &payload); err != nil {
			return err
		}
		if err := updateAttempt(projection, payload.AttemptID, AttemptInterrupted, payload.Reason, event); err != nil {
			return err
		}
		projection.Job.Status = JobRecovering
		return nil
	case EventAttemptFailed:
		var payload attemptStatePayload
		if err := decodePayload(event, &payload); err != nil {
			return err
		}
		return updateAttempt(projection, payload.AttemptID, AttemptFailed, payload.Reason, event)
	case EventStepStarted:
		var payload stepPayload
		if err := decodePayload(event, &payload); err != nil {
			return err
		}
		if !hasAttempt(*projection, payload.Step.AttemptID) {
			return fmt.Errorf("step references unknown attempt")
		}
		if payload.Step.ID != event.StepID || payload.Step.AttemptID != event.AttemptID {
			return fmt.Errorf("step payload does not match event references")
		}
		if err := validateIdentifier("step id", payload.Step.ID); err != nil {
			return err
		}
		if payload.Step.Status != StepRunning || hasStep(*projection, payload.Step.ID) {
			return fmt.Errorf("step must be a new running step")
		}
		projection.Steps = append(projection.Steps, payload.Step)
	case EventStepCompleted:
		return updateStepFromEvent(projection, event, StepCompleted)
	case EventStepFailed:
		return updateStepFromEvent(projection, event, StepFailed)
	case EventActionProposed:
		var payload actionPayload
		if err := decodePayload(event, &payload); err != nil {
			return err
		}
		if !hasStep(*projection, payload.Action.StepID) {
			return fmt.Errorf("action references unknown step")
		}
		if payload.Action.StepID != event.StepID {
			return fmt.Errorf("action payload does not match event step")
		}
		if err := validateIdentifier("action id", payload.Action.ID); err != nil {
			return err
		}
		if payload.Action.Status != ActionProposed || hasAction(*projection, payload.Action.ID) {
			return fmt.Errorf("action must be a new proposed action")
		}
		if payload.Action.ExpectedEffect.Class == "" || payload.Action.ExpectedEffect.IdempotencyKey == "" {
			return fmt.Errorf("action must declare effect class and idempotency key")
		}
		if payload.Action.ExpectedEffect.Cleanup == "" || payload.Action.ExpectedEffect.Approval == "" || payload.Action.ExpectedEffect.ScopeCheck == "" {
			return fmt.Errorf("action must declare cleanup, approval, and scope check")
		}
		projection.Actions = append(projection.Actions, payload.Action)
	case EventActionStarted:
		return updateActionFromEvent(projection, event, ActionRunning)
	case EventActionCompleted:
		return updateActionFromEvent(projection, event, ActionCompleted)
	case EventActionFailed:
		return updateActionFromEvent(projection, event, ActionFailed)
	case EventObservationCommitted:
		var payload observationPayload
		if err := decodePayload(event, &payload); err != nil {
			return err
		}
		if !hasAction(*projection, payload.Observation.ActionID) {
			return fmt.Errorf("observation references unknown action")
		}
		if err := validateIdentifier("observation id", payload.Observation.ID); err != nil {
			return err
		}
		if hasObservation(*projection, payload.Observation.ID) {
			return fmt.Errorf("observation id is already committed")
		}
		projection.Observations = append(projection.Observations, payload.Observation)
	case EventArtifactCommitted:
		var payload artifactPayload
		if err := decodePayload(event, &payload); err != nil {
			return err
		}
		if payload.Artifact.JobID != event.JobID || !hasAction(*projection, payload.Artifact.SourceActionID) {
			return fmt.Errorf("artifact provenance is not a committed action in this job")
		}
		if payload.Artifact.Source == "" {
			// Backward compatibility for M1 events written before Source became
			// explicit. SourceActionID remains the authoritative provenance.
			payload.Artifact.Source = "action:" + payload.Artifact.SourceActionID
		}
		if payload.Artifact.ID == "" || hasArtifact(*projection, payload.Artifact.ID) {
			return fmt.Errorf("artifact must have a unique identity")
		}
		projection.Artifacts = append(projection.Artifacts, payload.Artifact)
	case EventArtifactAdmitted:
		var payload artifactPayload
		if err := decodePayload(event, &payload); err != nil {
			return err
		}
		if payload.Artifact.JobID != event.JobID || payload.Artifact.SourceActionID != "" || payload.Artifact.Source == "" {
			return fmt.Errorf("admitted artifact requires job-owned intake provenance")
		}
		if payload.Artifact.ID == "" || hasArtifact(*projection, payload.Artifact.ID) {
			return fmt.Errorf("artifact must have a unique identity")
		}
		projection.Artifacts = append(projection.Artifacts, payload.Artifact)
	case EventEffectCommitted, EventEffectReused:
		var payload effectPayload
		if err := decodePayload(event, &payload); err != nil {
			return err
		}
		if !hasAction(*projection, payload.Effect.ActionID) || !hasArtifact(*projection, payload.Effect.ArtifactID) {
			return fmt.Errorf("effect references unknown action or artifact")
		}
		if err := validateIdentifier("effect id", payload.Effect.ID); err != nil {
			return err
		}
		if hasEffect(*projection, payload.Effect.ID) {
			return fmt.Errorf("effect id is already committed")
		}
		projection.Effects = append(projection.Effects, payload.Effect)
	case EventEvidenceLinked:
		var payload evidencePayload
		if err := decodePayload(event, &payload); err != nil {
			return err
		}
		if len(payload.Evidence.ObservationIDs) == 0 || len(payload.Evidence.ArtifactIDs) == 0 {
			return fmt.Errorf("evidence requires observation and artifact references")
		}
		if err := validateIdentifier("evidence id", payload.Evidence.ID); err != nil {
			return err
		}
		if hasEvidence(*projection, payload.Evidence.ID) {
			return fmt.Errorf("evidence id is already linked")
		}
		for _, id := range payload.Evidence.ObservationIDs {
			if !hasObservation(*projection, id) {
				return fmt.Errorf("evidence references unknown observation")
			}
		}
		for _, id := range payload.Evidence.ArtifactIDs {
			if !hasArtifact(*projection, id) {
				return fmt.Errorf("evidence references unknown artifact")
			}
		}
		projection.Evidence = append(projection.Evidence, payload.Evidence)
	case EventEvaluationRecorded:
		var payload evaluationPayload
		if err := decodePayload(event, &payload); err != nil {
			return err
		}
		if payload.Evaluation.Evaluator == "" || payload.Evaluation.Version == "" || len(payload.Evaluation.EvidenceIDs) == 0 {
			return fmt.Errorf("evaluation requires evaluator version and evidence")
		}
		if err := validateIdentifier("evaluation id", payload.Evaluation.ID); err != nil {
			return err
		}
		if hasEvaluation(*projection, payload.Evaluation.ID) {
			return fmt.Errorf("evaluation id is already recorded")
		}
		if payload.Evaluation.Score < 0 || payload.Evaluation.Score > 1 {
			return fmt.Errorf("evaluation score must be between 0 and 1")
		}
		switch payload.Evaluation.Verdict {
		case VerdictPass, VerdictFail, VerdictNeedsReview, VerdictInconclusive:
		default:
			return fmt.Errorf("unsupported evaluation verdict")
		}
		for _, id := range payload.Evaluation.EvidenceIDs {
			if !hasEvidence(*projection, id) {
				return fmt.Errorf("evaluation references unknown evidence")
			}
		}
		projection.Evaluations = append(projection.Evaluations, payload.Evaluation)
	case EventOutcomeDecided:
		var payload outcomePayload
		if err := decodePayload(event, &payload); err != nil {
			return err
		}
		if projection.Outcome != nil {
			return fmt.Errorf("job outcome is already decided")
		}
		switch payload.Outcome.Status {
		case OutcomeSucceeded, OutcomeFailed, OutcomeCancelled:
		default:
			return fmt.Errorf("unsupported outcome status")
		}
		if payload.Outcome.Status == OutcomeSucceeded && !hasPassingEvaluation(*projection, payload.Outcome.EvaluationID) {
			return fmt.Errorf("succeeded outcome requires referenced passing evaluation")
		}
		if payload.Outcome.EvaluationID != "" && !hasEvaluation(*projection, payload.Outcome.EvaluationID) {
			return fmt.Errorf("outcome references unknown evaluation")
		}
		projection.Outcome = &payload.Outcome
	case EventRoleFactCommitted:
		var payload roleFactPayload
		if err := decodePayload(event, &payload); err != nil {
			return err
		}
		fact := payload.Fact
		if err := validateIdentifier("role fact id", fact.ID); err != nil {
			return err
		}
		if fact.PackageID == "" || fact.PackageID != projection.Job.Role || fact.SchemaVersion == "" || fact.Kind == "" {
			return fmt.Errorf("role fact does not match the job package")
		}
		if fact.AttemptID != event.AttemptID || fact.StepID != event.StepID {
			return fmt.Errorf("role fact payload does not match event scope")
		}
		if len(fact.Data) == 0 || !json.Valid(fact.Data) || hasRoleFact(*projection, fact.ID) {
			return fmt.Errorf("role fact requires unique identity and valid data")
		}
		if fact.AttemptID != "" && !hasAttempt(*projection, fact.AttemptID) {
			return fmt.Errorf("role fact references unknown attempt")
		}
		if fact.StepID != "" && !hasStep(*projection, fact.StepID) {
			return fmt.Errorf("role fact references unknown step")
		}
		for _, id := range fact.ArtifactIDs {
			if !hasArtifact(*projection, id) {
				return fmt.Errorf("role fact references unknown artifact")
			}
		}
		for _, id := range fact.EvidenceIDs {
			if !hasEvidence(*projection, id) {
				return fmt.Errorf("role fact references unknown evidence")
			}
		}
		projection.RoleFacts = append(projection.RoleFacts, fact)
	case EventEnvironmentPrepared, EventEnvironmentReleased:
		// Environment facts remain visible in Events in v1alpha1. A dedicated
		// Environment projection is added when the real provider lands.
	default:
		return fmt.Errorf("unknown event kind %q", event.Kind)
	}
	return nil
}

func decodePayload(event Event, target any) error {
	if err := json.Unmarshal(event.Payload, target); err != nil {
		return fmt.Errorf("decode payload: %w", err)
	}
	return nil
}

func updateAttempt(projection *JobProjection, id string, status AttemptStatus, reason string, event Event) error {
	if id != event.AttemptID {
		return fmt.Errorf("attempt payload does not match event attempt")
	}
	for index := range projection.Attempts {
		if projection.Attempts[index].ID == id {
			if projection.Attempts[index].Status != AttemptRunning {
				return fmt.Errorf("attempt %q is already terminal", id)
			}
			projection.Attempts[index].Status = status
			projection.Attempts[index].Reason = reason
			finishedAt := event.OccurredAt
			projection.Attempts[index].FinishedAt = &finishedAt
			return nil
		}
	}
	return fmt.Errorf("attempt %q not found", id)
}

func updateStepFromEvent(projection *JobProjection, event Event, status StepStatus) error {
	var payload stepStatePayload
	if err := decodePayload(event, &payload); err != nil {
		return err
	}
	if payload.StepID != event.StepID {
		return fmt.Errorf("step payload does not match event step")
	}
	for index := range projection.Steps {
		if projection.Steps[index].ID == payload.StepID {
			if projection.Steps[index].Status != StepRunning {
				return fmt.Errorf("step %q is already terminal", payload.StepID)
			}
			projection.Steps[index].Status = status
			finishedAt := event.OccurredAt
			projection.Steps[index].FinishedAt = &finishedAt
			return nil
		}
	}
	return fmt.Errorf("step %q not found", payload.StepID)
}

func updateActionFromEvent(projection *JobProjection, event Event, status ActionStatus) error {
	var payload actionStatePayload
	if err := decodePayload(event, &payload); err != nil {
		return err
	}
	for index := range projection.Actions {
		if projection.Actions[index].ID == payload.ActionID {
			current := projection.Actions[index].Status
			valid := current == ActionProposed && (status == ActionRunning || status == ActionFailed) ||
				current == ActionRunning && (status == ActionCompleted || status == ActionFailed)
			if !valid {
				return fmt.Errorf("invalid action transition %s -> %s", current, status)
			}
			projection.Actions[index].Status = status
			return nil
		}
	}
	return fmt.Errorf("action %q not found", payload.ActionID)
}

func hasPassingEvaluation(projection JobProjection, id string) bool {
	for _, evaluation := range projection.Evaluations {
		if evaluation.ID == id && evaluation.Verdict == VerdictPass {
			return true
		}
	}
	return false
}

func hasAttempt(projection JobProjection, id string) bool {
	for _, value := range projection.Attempts {
		if value.ID == id {
			return true
		}
	}
	return false
}

func hasStep(projection JobProjection, id string) bool {
	for _, value := range projection.Steps {
		if value.ID == id {
			return true
		}
	}
	return false
}

func hasAction(projection JobProjection, id string) bool {
	for _, value := range projection.Actions {
		if value.ID == id {
			return true
		}
	}
	return false
}

func hasObservation(projection JobProjection, id string) bool {
	for _, value := range projection.Observations {
		if value.ID == id {
			return true
		}
	}
	return false
}

func hasArtifact(projection JobProjection, id string) bool {
	for _, value := range projection.Artifacts {
		if value.ID == id {
			return true
		}
	}
	return false
}

func hasEvidence(projection JobProjection, id string) bool {
	for _, value := range projection.Evidence {
		if value.ID == id {
			return true
		}
	}
	return false
}

func hasEffect(projection JobProjection, id string) bool {
	for _, value := range projection.Effects {
		if value.ID == id {
			return true
		}
	}
	return false
}

func hasEvaluation(projection JobProjection, id string) bool {
	for _, value := range projection.Evaluations {
		if value.ID == id {
			return true
		}
	}
	return false
}

func hasRoleFact(projection JobProjection, id string) bool {
	for _, value := range projection.RoleFacts {
		if value.ID == id {
			return true
		}
	}
	return false
}
