package ctf

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/MilkSU-Official/milksu/internal/securityruntime"
)

type coachingEngine struct{}

func (coachingEngine) Name() string  { return "scripted-coach-engine" }
func (coachingEngine) Model() string { return "deterministic-test" }

func (coachingEngine) Propose(_ context.Context, input securityruntime.EngineInput) (securityruntime.ActionProposal, error) {
	var state agentState
	if err := json.Unmarshal(input.RoleState, &state); err != nil {
		return securityruntime.ActionProposal{}, err
	}
	value, _ := json.Marshal(map[string]any{
		"hint":     "先区分编码表示与原始字节。",
		"concept":  "encoding",
		"question": "两个十六进制字符通常表示多少个字节？",
		"level":    1,
	})
	return securityruntime.ActionProposal{
		Capability: CapabilityName,
		Name:       "ctf.coach_hint",
		Input:      value,
		Rationale:  "根据学习目标给出一条不泄露答案的分级提示。",
	}, nil
}

type submissionEngine struct{}

func (submissionEngine) Name() string  { return "scripted-submission-engine" }
func (submissionEngine) Model() string { return "deterministic-test" }

func (submissionEngine) Propose(_ context.Context, _ securityruntime.EngineInput) (securityruntime.ActionProposal, error) {
	value, _ := json.Marshal(map[string]string{
		"candidate":   "flag{candidate_from_evidence}",
		"explanation": "候选值来自当前任务保存的题面证据。",
	})
	return securityruntime.ActionProposal{
		Capability: CapabilityName,
		Name:       "ctf.submit_flag",
		Input:      value,
		Rationale:  "保存候选值，等待外部平台或用户独立确认。",
	}, nil
}

func TestCoachModeRecordsOneHintAndWaitsForLearner(t *testing.T) {
	core, err := securityruntime.NewService(t.TempDir(), nil)
	if err != nil {
		t.Fatal(err)
	}
	service, err := NewService(core, ServiceOptions{Engine: coachingEngine{}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = service.Close()
		_ = core.Close()
	})

	started, err := service.StartChallenge(context.Background(), ChallengeRequest{
		Title:             "Coach checkpoint",
		Statement:         "Explain how to reason about a hexadecimal payload.",
		Category:          "misc",
		CollaborationMode: "coach",
		TrackName:         "Encoding foundations",
		HumanGoal:         "Explain the representation before attempting a solution.",
		SourceKind:        "url",
		SourceURI:         "https://ctf.example/challenges/encoding",
		KnowledgePoints:   []string{"hexadecimal encoding"},
	})
	if err != nil {
		t.Fatal(err)
	}
	waitForJob(t, service, started.Job.ID)

	projection, err := service.GetJob(context.Background(), started.Job.ID)
	if err != nil {
		t.Fatal(err)
	}
	if projection.Job.Status == securityruntime.JobSucceeded || projection.Outcome != nil {
		t.Fatalf("coach must wait for the learner instead of claiming completion: status=%s outcome=%+v", projection.Job.Status, projection.Outcome)
	}
	if len(projection.Attempts) != 1 || projection.Attempts[0].Status != securityruntime.AttemptCompleted {
		t.Fatalf("expected one completed coaching turn, got %+v", projection.Attempts)
	}
	if len(projection.Learning) != 1 || projection.Learning[0].Kind != "hint" || projection.HumanOutcome.HintCount != 1 {
		t.Fatalf("expected one projected hint, got learning=%+v humanOutcome=%+v", projection.Learning, projection.HumanOutcome)
	}
	if projection.Challenge.Source.Kind != "url" || len(projection.Challenge.Source.Scope.Targets) != 1 || projection.Challenge.Source.Scope.Targets[0].Value != "https://ctf.example" {
		t.Fatalf("expected an exact normalized source grant, got %+v", projection.Challenge.Source)
	}

	projection, err = service.RecordLearning(context.Background(), started.Job.ID, LearningRecordRequest{
		Kind: "reflection", Content: "Two hexadecimal digits encode one byte.", Concept: "encoding",
	})
	if err != nil {
		t.Fatal(err)
	}
	if projection.HumanOutcome.ReflectionCount != 1 || projection.HumanOutcome.HintCount != 1 {
		t.Fatalf("expected hint and reflection to remain independently projected, got %+v", projection.HumanOutcome)
	}

	if _, err := service.ContinueJob(context.Background(), started.Job.ID); err != nil {
		t.Fatal(err)
	}
	waitForJob(t, service, started.Job.ID)
	projection, err = service.GetJob(context.Background(), started.Job.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(projection.Attempts) != 2 || projection.HumanOutcome.HintCount != 2 {
		t.Fatalf("expected a second explicit coaching turn, got attempts=%d humanOutcome=%+v", len(projection.Attempts), projection.HumanOutcome)
	}
}

func TestExternalJudgeRequiresUserReviewBeforeSuccess(t *testing.T) {
	core, err := securityruntime.NewService(t.TempDir(), nil)
	if err != nil {
		t.Fatal(err)
	}
	service, err := NewService(core, ServiceOptions{Engine: submissionEngine{}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = service.Close()
		_ = core.Close()
	})

	started, err := service.StartChallenge(context.Background(), ChallengeRequest{
		Title:             "External platform checkpoint",
		Statement:         "Submit a candidate to the authorized competition platform.",
		Category:          "misc",
		CollaborationMode: "delegate",
		SourceKind:        "url",
		SourceURI:         "https://ctf.example/challenges/manual",
	})
	if err != nil {
		t.Fatal(err)
	}
	waitForJob(t, service, started.Job.ID)

	projection, err := service.GetJob(context.Background(), started.Job.ID)
	if err != nil {
		t.Fatal(err)
	}
	if projection.Outcome != nil || len(projection.Evaluations) != 1 || projection.Evaluations[0].Verdict != securityruntime.VerdictNeedsReview {
		t.Fatalf("external candidate must wait for independent review: outcome=%+v evaluations=%+v", projection.Outcome, projection.Evaluations)
	}

	projection, err = service.ReviewSubmission(context.Background(), started.Job.ID, true, "Authorized platform accepted the candidate.")
	if err != nil {
		t.Fatal(err)
	}
	if projection.Job.Status != securityruntime.JobSucceeded || projection.Outcome == nil || len(projection.Evaluations) != 2 || projection.Evaluations[1].Verdict != securityruntime.VerdictPass {
		t.Fatalf("expected user-confirmed external success, got status=%s outcome=%+v evaluations=%+v", projection.Job.Status, projection.Outcome, projection.Evaluations)
	}
}

func TestCoachModeDeniesAgentSubmission(t *testing.T) {
	core, err := securityruntime.NewService(t.TempDir(), nil)
	if err != nil {
		t.Fatal(err)
	}
	service, err := NewService(core, ServiceOptions{Engine: submissionEngine{}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = service.Close()
		_ = core.Close()
	})

	started, err := service.StartChallenge(context.Background(), ChallengeRequest{
		Title: "Coach boundary", Statement: "Do not solve this for the learner.", Category: "misc", CollaborationMode: "coach",
	})
	if err != nil {
		t.Fatal(err)
	}
	waitForJob(t, service, started.Job.ID)
	projection, err := service.GetJob(context.Background(), started.Job.ID)
	if err != nil {
		t.Fatal(err)
	}
	if projection.Job.Status != securityruntime.JobFailed || projection.Outcome == nil || !strings.Contains(projection.Outcome.Summary, "coach mode denied") {
		t.Fatalf("coach submission must be denied by the harness, got status=%s outcome=%+v", projection.Job.Status, projection.Outcome)
	}
}
