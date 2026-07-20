package securityruntime

import (
	"encoding/json"
	"time"
)

type EventKind string

const (
	EventJobCreated           EventKind = "job.created"
	EventJobCancelRequested   EventKind = "job.cancel.requested"
	EventJobRecoveryStarted   EventKind = "job.recovery.started"
	EventJobCompleted         EventKind = "job.completed"
	EventJobFailed            EventKind = "job.failed"
	EventJobCancelled         EventKind = "job.cancelled"
	EventAttemptStarted       EventKind = "attempt.started"
	EventAttemptCompleted     EventKind = "attempt.completed"
	EventAttemptInterrupted   EventKind = "attempt.interrupted"
	EventAttemptFailed        EventKind = "attempt.failed"
	EventEnvironmentPrepared  EventKind = "environment.prepared"
	EventEnvironmentReleased  EventKind = "environment.released"
	EventStepStarted          EventKind = "step.started"
	EventStepCompleted        EventKind = "step.completed"
	EventStepFailed           EventKind = "step.failed"
	EventActionProposed       EventKind = "action.proposed"
	EventActionStarted        EventKind = "action.started"
	EventActionCompleted      EventKind = "action.completed"
	EventActionFailed         EventKind = "action.failed"
	EventObservationCommitted EventKind = "observation.committed"
	EventArtifactCommitted    EventKind = "artifact.committed"
	EventArtifactAdmitted     EventKind = "artifact.admitted"
	EventEffectCommitted      EventKind = "effect.committed"
	EventEffectReused         EventKind = "effect.reused"
	EventEvidenceLinked       EventKind = "evidence.linked"
	EventEvaluationRecorded   EventKind = "evaluation.recorded"
	EventOutcomeDecided       EventKind = "outcome.decided"
	EventRoleFactCommitted    EventKind = "role.fact.committed"
)

type Event struct {
	SchemaVersion int             `json:"schemaVersion"`
	EventID       string          `json:"eventId"`
	JobID         string          `json:"jobId"`
	AttemptID     string          `json:"attemptId,omitempty"`
	StepID        string          `json:"stepId,omitempty"`
	Sequence      int64           `json:"sequence"`
	Kind          EventKind       `json:"kind"`
	OccurredAt    time.Time       `json:"occurredAt"`
	Payload       json.RawMessage `json:"payload"`
}

type EventDraft struct {
	JobID     string
	AttemptID string
	StepID    string
	Kind      EventKind
	Payload   any
}

type jobCreatedPayload struct {
	Job Job `json:"job"`
}

type attemptPayload struct {
	Attempt Attempt `json:"attempt"`
}

type attemptStatePayload struct {
	AttemptID string `json:"attemptId"`
	Reason    string `json:"reason,omitempty"`
}

type environmentPayload struct {
	Lease EnvironmentLease `json:"lease"`
}

type stepPayload struct {
	Step Step `json:"step"`
}

type stepStatePayload struct {
	StepID string `json:"stepId"`
	Reason string `json:"reason,omitempty"`
}

type actionPayload struct {
	Action Action `json:"action"`
}

type actionStatePayload struct {
	ActionID string `json:"actionId"`
	Reason   string `json:"reason,omitempty"`
}

type observationPayload struct {
	Observation Observation `json:"observation"`
}

type artifactPayload struct {
	Artifact Artifact `json:"artifact"`
	Created  bool     `json:"created"`
}

type roleFactPayload struct {
	Fact RoleFact `json:"fact"`
}

type effectPayload struct {
	Effect Effect `json:"effect"`
}

type evidencePayload struct {
	Evidence Evidence `json:"evidence"`
}

type evaluationPayload struct {
	Evaluation Evaluation `json:"evaluation"`
}

type outcomePayload struct {
	Outcome Outcome `json:"outcome"`
}

type reasonPayload struct {
	Reason string `json:"reason"`
}

type recoveryPayload struct {
	PreviousAttemptID string `json:"previousAttemptId,omitempty"`
}
