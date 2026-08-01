package evalbench

import (
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"
)

type RunStatus string

const (
	RunCompleted RunStatus = "completed"
	RunFailed    RunStatus = "failed"
	RunCancelled RunStatus = "cancelled"
)

type ReportedOutcome string

const (
	OutcomeSolved   ReportedOutcome = "solved"
	OutcomeUnsolved ReportedOutcome = "unsolved"
	OutcomeUnknown  ReportedOutcome = "unknown"
)

type ModelIdentity struct {
	Provider string `json:"provider"`
	Name     string `json:"name"`
	Revision string `json:"revision,omitempty"`
}

type HarnessIdentity struct {
	Name         string `json:"name"`
	Version      string `json:"version"`
	ConfigSHA256 string `json:"configSha256"`
}

type RunMetrics struct {
	Turns        int   `json:"turns"`
	ToolCalls    int   `json:"toolCalls"`
	InputTokens  int64 `json:"inputTokens"`
	OutputTokens int64 `json:"outputTokens"`
}

type RunExecutionSummary struct {
	ExitReason         string `json:"exitReason"`
	ProviderCalls      int    `json:"providerCalls"`
	ProviderHTTPStatus int    `json:"providerHttpStatus,omitempty"`
	TimeoutMillis      int64  `json:"timeoutMillis"`
	MaxOutputTokens    int    `json:"maxOutputTokens"`
	MaxCostMicroUSD    int64  `json:"maxCostMicroUsd"`
	ActualCostMicroUSD int64  `json:"actualCostMicroUsd"`
	PricingSchedule    string `json:"pricingSchedule"`
	PricingSourceURL   string `json:"pricingSourceUrl"`
	PricingCheckedDate string `json:"pricingCheckedDate"`
}

type RunJudgeSummary struct {
	Method               string `json:"method"`
	ExpectedAnswerSHA256 string `json:"expectedAnswerSha256"`
	ActualAnswerSHA256   string `json:"actualAnswerSha256"`
	Matched              bool   `json:"matched"`
}

// RunRecord is intentionally summary-only. Its schema has no fields for
// prompts, commands, transcripts, challenge artifacts, flags, or model output.
// ResultAuthority distinguishes unverified imported summaries from the
// deterministic SHA-256 comparison performed by the safe-static runner.
type RunRecord struct {
	SchemaVersion   string               `json:"schemaVersion"`
	RunID           string               `json:"runId"`
	SourceRevision  string               `json:"sourceRevision"`
	Split           Split                `json:"split"`
	TaskID          string               `json:"taskId"`
	Model           ModelIdentity        `json:"model"`
	Harness         HarnessIdentity      `json:"harness"`
	Status          RunStatus            `json:"status"`
	ReportedOutcome ReportedOutcome      `json:"reportedOutcome"`
	ResultAuthority string               `json:"resultAuthority"`
	StartedAt       time.Time            `json:"startedAt"`
	FinishedAt      time.Time            `json:"finishedAt"`
	Metrics         RunMetrics           `json:"metrics"`
	Execution       *RunExecutionSummary `json:"execution,omitempty"`
	Judge           *RunJudgeSummary     `json:"judge,omitempty"`
}

var (
	runIDPattern  = regexp.MustCompile(`^[A-Za-z0-9._:-]+$`)
	sha256Pattern = regexp.MustCompile(`^[0-9a-f]{64}$`)
)

func ValidateRunRecord(record RunRecord) error {
	if record.SchemaVersion != RunSchemaVersion {
		return fmt.Errorf("unsupported run schema %q", record.SchemaVersion)
	}
	if !runIDPattern.MatchString(record.RunID) || len(record.RunID) > 200 {
		return errors.New("run id is invalid")
	}
	if record.SourceRevision != NYUCTFBenchRevision {
		return fmt.Errorf("run source revision must be pinned to %s", NYUCTFBenchRevision)
	}
	if err := validateSplit(record.Split); err != nil {
		return err
	}
	if !taskIDPattern.MatchString(record.TaskID) || len(record.TaskID) > 200 {
		return errors.New("run task id is invalid")
	}
	if err := validateIdentity("model provider", record.Model.Provider); err != nil {
		return err
	}
	if err := validateIdentity("model name", record.Model.Name); err != nil {
		return err
	}
	if len(record.Model.Revision) > 200 || strings.ContainsAny(record.Model.Revision, "\r\n") {
		return errors.New("model revision is invalid")
	}
	if err := validateIdentity("harness name", record.Harness.Name); err != nil {
		return err
	}
	if err := validateIdentity("harness version", record.Harness.Version); err != nil {
		return err
	}
	if !sha256Pattern.MatchString(record.Harness.ConfigSHA256) {
		return errors.New("harness config digest must be a lowercase SHA-256")
	}
	switch record.ResultAuthority {
	case ReportedResultAuthority:
		if record.Judge != nil {
			return errors.New("reported-only run cannot include a deterministic judge")
		}
	case DeterministicStaticAnswerAuthority:
		if record.Status != RunCompleted || record.Judge == nil {
			return errors.New("deterministic static authority requires a completed run and judge record")
		}
		if err := validateRunJudge(*record.Judge, record.ReportedOutcome); err != nil {
			return err
		}
	default:
		return fmt.Errorf("unsupported result authority %q", record.ResultAuthority)
	}
	if record.StartedAt.IsZero() || record.FinishedAt.IsZero() {
		return errors.New("run timestamps are required")
	}
	if !record.FinishedAt.After(record.StartedAt) {
		return errors.New("run finish time must be after start time")
	}
	if _, offset := record.StartedAt.Zone(); offset != 0 {
		return errors.New("run start time must use UTC")
	}
	if _, offset := record.FinishedAt.Zone(); offset != 0 {
		return errors.New("run finish time must use UTC")
	}
	if record.Metrics.Turns < 0 || record.Metrics.ToolCalls < 0 ||
		record.Metrics.InputTokens < 0 || record.Metrics.OutputTokens < 0 {
		return errors.New("run metrics cannot be negative")
	}
	if record.Execution != nil {
		if err := validateRunExecution(*record.Execution); err != nil {
			return err
		}
	}
	switch record.Status {
	case RunCompleted:
		if record.ReportedOutcome != OutcomeSolved && record.ReportedOutcome != OutcomeUnsolved {
			return errors.New("completed run must report solved or unsolved")
		}
	case RunFailed, RunCancelled:
		if record.ReportedOutcome != OutcomeUnknown {
			return errors.New("failed or cancelled run must report an unknown outcome")
		}
	default:
		return fmt.Errorf("unsupported run status %q", record.Status)
	}
	return nil
}

func validateRunJudge(judge RunJudgeSummary, outcome ReportedOutcome) error {
	if judge.Method != "trim-space-sha256" {
		return errors.New("unsupported deterministic judge method")
	}
	if !sha256Pattern.MatchString(judge.ExpectedAnswerSHA256) ||
		!sha256Pattern.MatchString(judge.ActualAnswerSHA256) {
		return errors.New("deterministic judge requires lowercase SHA-256 digests")
	}
	if judge.Matched != (outcome == OutcomeSolved) {
		return errors.New("deterministic judge result does not match reported outcome")
	}
	return nil
}

func validateRunExecution(execution RunExecutionSummary) error {
	if strings.TrimSpace(execution.ExitReason) == "" ||
		len(execution.ExitReason) > 100 ||
		strings.ContainsAny(execution.ExitReason, "\r\n") {
		return errors.New("run exit reason is invalid")
	}
	if execution.ProviderCalls < 0 || execution.ProviderCalls > 1 {
		return errors.New("non-interactive run must make zero or one provider call")
	}
	if execution.ProviderHTTPStatus != 0 &&
		(execution.ProviderHTTPStatus < 400 || execution.ProviderHTTPStatus > 599) {
		return errors.New("provider HTTP status is invalid")
	}
	if execution.TimeoutMillis < 1 || execution.TimeoutMillis > 120_000 ||
		execution.MaxOutputTokens < 1 || execution.MaxOutputTokens > 512 ||
		execution.MaxCostMicroUSD < 0 || execution.MaxCostMicroUSD > 1_000_000 ||
		execution.ActualCostMicroUSD < 0 || execution.ActualCostMicroUSD > 1_000_000_000 {
		return errors.New("run execution budget or cost is invalid")
	}
	if strings.TrimSpace(execution.PricingSchedule) == "" {
		return errors.New("run execution pricing schedule is required")
	}
	if strings.TrimSpace(execution.PricingSourceURL) == "" ||
		strings.TrimSpace(execution.PricingCheckedDate) == "" {
		return errors.New("run execution pricing provenance is required")
	}
	return nil
}

func DecodeRunRecord(data []byte) (RunRecord, error) {
	var record RunRecord
	if err := decodeStrictJSON(data, &record); err != nil {
		return RunRecord{}, fmt.Errorf("decode run record: %w", err)
	}
	if err := ValidateRunRecord(record); err != nil {
		return RunRecord{}, fmt.Errorf("validate run record: %w", err)
	}
	return record, nil
}

func EncodeRunRecord(record RunRecord) ([]byte, error) {
	if err := ValidateRunRecord(record); err != nil {
		return nil, err
	}
	data, err := json.MarshalIndent(record, "", "  ")
	if err != nil {
		return nil, err
	}
	return append(data, '\n'), nil
}

func validateIdentity(label, value string) error {
	if strings.TrimSpace(value) == "" || len(value) > 200 || strings.ContainsAny(value, "\r\n") {
		return fmt.Errorf("%s is invalid", label)
	}
	return nil
}
