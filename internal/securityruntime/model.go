package securityruntime

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
	"time"
)

const ContractVersion = "runtime.milksu.dev/v1alpha1"

const WalkingSkeletonRole = "system.walking-skeleton"

var validIdentifier = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_.:-]{0,191}$`)

type JobStatus string

const (
	JobQueued     JobStatus = "queued"
	JobRunning    JobStatus = "running"
	JobCancelling JobStatus = "cancelling"
	JobRecovering JobStatus = "recovering"
	JobSucceeded  JobStatus = "succeeded"
	JobFailed     JobStatus = "failed"
	JobCancelled  JobStatus = "cancelled"
)

type AttemptStatus string

const (
	AttemptRunning     AttemptStatus = "running"
	AttemptCompleted   AttemptStatus = "completed"
	AttemptInterrupted AttemptStatus = "interrupted"
	AttemptFailed      AttemptStatus = "failed"
)

type StepStatus string

const (
	StepRunning   StepStatus = "running"
	StepCompleted StepStatus = "completed"
	StepFailed    StepStatus = "failed"
)

type ActionStatus string

const (
	ActionProposed  ActionStatus = "proposed"
	ActionRunning   ActionStatus = "running"
	ActionCompleted ActionStatus = "completed"
	ActionFailed    ActionStatus = "failed"
)

type Verdict string

const (
	VerdictPass         Verdict = "pass"
	VerdictFail         Verdict = "fail"
	VerdictNeedsReview  Verdict = "needs_review"
	VerdictInconclusive Verdict = "inconclusive"
)

type OutcomeStatus string

const (
	OutcomeSucceeded OutcomeStatus = "succeeded"
	OutcomeFailed    OutcomeStatus = "failed"
	OutcomeCancelled OutcomeStatus = "cancelled"
)

type Job struct {
	ID                string    `json:"id"`
	Title             string    `json:"title"`
	Role              string    `json:"role"`
	CollaborationMode string    `json:"collaborationMode"`
	Status            JobStatus `json:"status"`
	CreatedAt         time.Time `json:"createdAt"`
	UpdatedAt         time.Time `json:"updatedAt"`
}

type Attempt struct {
	ID          string        `json:"id"`
	JobID       string        `json:"jobId"`
	Engine      string        `json:"engine"`
	Model       string        `json:"model"`
	Environment string        `json:"environment"`
	Evaluator   string        `json:"evaluator"`
	Status      AttemptStatus `json:"status"`
	StartedAt   time.Time     `json:"startedAt"`
	FinishedAt  *time.Time    `json:"finishedAt,omitempty"`
	Reason      string        `json:"reason,omitempty"`
}

type Step struct {
	ID          string     `json:"id"`
	AttemptID   string     `json:"attemptId"`
	Name        string     `json:"name"`
	Description string     `json:"description"`
	Status      StepStatus `json:"status"`
	StartedAt   time.Time  `json:"startedAt"`
	FinishedAt  *time.Time `json:"finishedAt,omitempty"`
}

type EffectSpec struct {
	Class          string `json:"class"`
	IdempotencyKey string `json:"idempotencyKey"`
	Cleanup        string `json:"cleanup"`
	Approval       string `json:"approval"`
	ScopeCheck     string `json:"scopeCheck"`
}

type Action struct {
	ID             string          `json:"id"`
	StepID         string          `json:"stepId"`
	Capability     string          `json:"capability"`
	Name           string          `json:"name"`
	Input          json.RawMessage `json:"input"`
	Rationale      string          `json:"rationale,omitempty"`
	ExpectedEffect EffectSpec      `json:"expectedEffect"`
	Status         ActionStatus    `json:"status"`
}

type Observation struct {
	ID        string `json:"id"`
	ActionID  string `json:"actionId"`
	Summary   string `json:"summary"`
	MediaType string `json:"mediaType"`
	Complete  bool   `json:"complete"`
}

type Artifact struct {
	ID             string `json:"id"`
	JobID          string `json:"jobId"`
	SourceActionID string `json:"sourceActionId,omitempty"`
	Source         string `json:"source"`
	SHA256         string `json:"sha256"`
	MediaType      string `json:"mediaType"`
	Size           int64  `json:"size"`
	RelativePath   string `json:"relativePath"`
}

// RoleFact is the generic L4 envelope for immutable L2 state. The shared
// Runtime validates identity and references; each Role Package owns Data and
// its state transitions.
type RoleFact struct {
	ID            string          `json:"id"`
	PackageID     string          `json:"packageId"`
	SchemaVersion string          `json:"schemaVersion"`
	Kind          string          `json:"kind"`
	AttemptID     string          `json:"attemptId,omitempty"`
	StepID        string          `json:"stepId,omitempty"`
	ArtifactIDs   []string        `json:"artifactIds,omitempty"`
	EvidenceIDs   []string        `json:"evidenceIds,omitempty"`
	Data          json.RawMessage `json:"data"`
}

type Effect struct {
	ID             string `json:"id"`
	ActionID       string `json:"actionId"`
	Class          string `json:"class"`
	IdempotencyKey string `json:"idempotencyKey"`
	State          string `json:"state"`
	Cleanup        string `json:"cleanup"`
	ArtifactID     string `json:"artifactId,omitempty"`
}

type Evidence struct {
	ID             string   `json:"id"`
	Claim          string   `json:"claim"`
	ObservationIDs []string `json:"observationIds"`
	ArtifactIDs    []string `json:"artifactIds"`
	Provenance     string   `json:"provenance"`
}

type Evaluation struct {
	ID          string   `json:"id"`
	Evaluator   string   `json:"evaluator"`
	Version     string   `json:"version"`
	Verdict     Verdict  `json:"verdict"`
	Score       float64  `json:"score"`
	Summary     string   `json:"summary"`
	EvidenceIDs []string `json:"evidenceIds"`
}

type Outcome struct {
	Status       OutcomeStatus `json:"status"`
	Summary      string        `json:"summary"`
	EvaluationID string        `json:"evaluationId,omitempty"`
}

type EnvironmentLease struct {
	ID         string `json:"id"`
	Provider   string `json:"provider"`
	Target     string `json:"target"`
	Resettable bool   `json:"resettable"`
}

type JobProjection struct {
	ContractVersion string        `json:"contractVersion"`
	Job             Job           `json:"job"`
	Attempts        []Attempt     `json:"attempts"`
	Steps           []Step        `json:"steps"`
	Actions         []Action      `json:"actions"`
	Observations    []Observation `json:"observations"`
	Artifacts       []Artifact    `json:"artifacts"`
	Effects         []Effect      `json:"effects"`
	Evidence        []Evidence    `json:"evidence"`
	Evaluations     []Evaluation  `json:"evaluations"`
	RoleFacts       []RoleFact    `json:"roleFacts"`
	Outcome         *Outcome      `json:"outcome,omitempty"`
	Events          []Event       `json:"events"`
}

type JobSummary struct {
	ID            string    `json:"id"`
	Title         string    `json:"title"`
	Role          string    `json:"role"`
	Status        JobStatus `json:"status"`
	AttemptCount  int       `json:"attemptCount"`
	EvidenceCount int       `json:"evidenceCount"`
	Verdict       Verdict   `json:"verdict,omitempty"`
	CreatedAt     time.Time `json:"createdAt"`
	UpdatedAt     time.Time `json:"updatedAt"`
}

func (p JobProjection) Summary() JobSummary {
	var verdict Verdict
	if len(p.Evaluations) > 0 {
		verdict = p.Evaluations[len(p.Evaluations)-1].Verdict
	}
	return JobSummary{
		ID:            p.Job.ID,
		Title:         p.Job.Title,
		Role:          p.Job.Role,
		Status:        p.Job.Status,
		AttemptCount:  len(p.Attempts),
		EvidenceCount: len(p.Evidence),
		Verdict:       verdict,
		CreatedAt:     p.Job.CreatedAt,
		UpdatedAt:     p.Job.UpdatedAt,
	}
}

func (p JobProjection) Terminal() bool {
	switch p.Job.Status {
	case JobSucceeded, JobFailed, JobCancelled:
		return true
	default:
		return false
	}
}

func validateIdentifier(name, value string) error {
	if !validIdentifier.MatchString(value) {
		return fmt.Errorf("invalid %s", name)
	}
	return nil
}

func validateTitle(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", fmt.Errorf("title is required")
	}
	if len([]rune(value)) > 120 {
		return "", fmt.Errorf("title is too long")
	}
	return value, nil
}

type EngineInput struct {
	Projection JobProjection
	Attempt    Attempt
	Step       Step
	RolePrompt string
	RoleState  json.RawMessage
}

type ActionProposal struct {
	Capability     string
	Name           string
	Input          json.RawMessage
	Rationale      string
	ExpectedEffect EffectSpec
}

// AgentEngine is MilkSU's narrow L5 boundary. It deliberately does not copy a
// model provider, session, compaction, or generic tool-loop interface.
type AgentEngine interface {
	Name() string
	Model() string
	Propose(context.Context, EngineInput) (ActionProposal, error)
}

// AgentAttemptLifecycle is optional. Adapters with persistent sessions use it
// to release one Attempt without coupling the Runtime to an engine SDK.
type AgentAttemptLifecycle interface {
	CloseAttempt(context.Context, string) error
}

type ArtifactDraft struct {
	MediaType string
	Data      []byte
}

type CapabilityResult struct {
	Summary   string
	MediaType string
	Complete  bool
	Artifacts []ArtifactDraft
}

type Capability interface {
	Name() string
	Execute(context.Context, Action) (CapabilityResult, error)
}

type Environment interface {
	Name() string
	Prepare(context.Context, Job, Attempt) (EnvironmentLease, error)
	Release(context.Context, EnvironmentLease) error
}

type ArtifactReader interface {
	Read(context.Context, Artifact) ([]byte, error)
}

type EvaluationInput struct {
	Projection JobProjection
	Evidence   Evidence
	Reader     ArtifactReader
}

type EvaluationDecision struct {
	Verdict Verdict
	Score   float64
	Summary string
}

type Evaluator interface {
	Name() string
	Version() string
	Evaluate(context.Context, EvaluationInput) (EvaluationDecision, error)
}
