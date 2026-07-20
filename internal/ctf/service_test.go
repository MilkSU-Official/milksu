package ctf

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/MilkSU-Official/milksu/internal/securityruntime"
)

type solvingEngine struct {
	mu         sync.Mutex
	wrongFirst bool
}

func (e *solvingEngine) Name() string  { return "scripted-ctf-engine" }
func (e *solvingEngine) Model() string { return "deterministic-test" }

func (e *solvingEngine) Propose(_ context.Context, input securityruntime.EngineInput) (securityruntime.ActionProposal, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	var state agentState
	if err := json.Unmarshal(input.RoleState, &state); err != nil {
		return securityruntime.ActionProposal{}, err
	}
	proposal := securityruntime.ActionProposal{Capability: CapabilityName}
	switch len(state.Actions) {
	case 0:
		proposal.Name = "ctf.inspect_material"
		proposal.Input, _ = json.Marshal(map[string]string{"materialId": state.Materials[0].ArtifactID})
		proposal.Rationale = "先读取用户提供的唯一材料。"
	case 1:
		proposal.Name = "ctf.decode_hex"
		proposal.Input, _ = json.Marshal(map[string]string{"artifactId": state.Materials[0].ArtifactID})
		proposal.Rationale = "观察显示材料是十六进制文本，进行确定性解码。"
	default:
		candidate := "MILKSU{typed_security_loop}"
		if e.wrongFirst && len(state.Evaluations) == 0 {
			candidate = "MILKSU{wrong_candidate}"
		}
		proposal.Name = "ctf.submit_flag"
		proposal.Input, _ = json.Marshal(map[string]string{
			"candidate": candidate, "explanation": "候选值来自十六进制解码观察。",
		})
		proposal.Rationale = "把证据支持的候选值交给独立本地判题器。"
	}
	return proposal, nil
}

type blockingEngine struct {
	called chan struct{}
	once   sync.Once
}

func (e *blockingEngine) Name() string  { return "blocking-ctf-engine" }
func (e *blockingEngine) Model() string { return "deterministic-test" }

func (e *blockingEngine) Propose(ctx context.Context, _ securityruntime.EngineInput) (securityruntime.ActionProposal, error) {
	e.once.Do(func() { close(e.called) })
	<-ctx.Done()
	return securityruntime.ActionProposal{}, ctx.Err()
}

func TestSampleChallengeRunsThroughTypedActionsAndIndependentJudge(t *testing.T) {
	core, err := securityruntime.NewService(t.TempDir(), nil)
	if err != nil {
		t.Fatal(err)
	}
	engine := &solvingEngine{}
	service, err := NewService(core, ServiceOptions{Engine: engine})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = service.Close()
		_ = core.Close()
	})

	started, err := service.StartSampleChallenge(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	waitForJob(t, service, started.Job.ID)
	projection, err := service.GetJob(context.Background(), started.Job.ID)
	if err != nil {
		t.Fatal(err)
	}
	if projection.Job.Status != securityruntime.JobSucceeded || projection.Outcome == nil || projection.Outcome.Status != securityruntime.OutcomeSucceeded {
		t.Fatalf("expected evaluator-backed success, got status=%s outcome=%+v", projection.Job.Status, projection.Outcome)
	}
	if len(projection.Experiments) != 3 {
		t.Fatalf("expected inspect, decode, submit experiments; got %d", len(projection.Experiments))
	}
	if len(projection.Evaluations) != 1 || projection.Evaluations[0].Verdict != securityruntime.VerdictPass {
		t.Fatalf("expected one passing independent evaluation, got %+v", projection.Evaluations)
	}
	if projection.Experiments[0].Action.Name != "ctf.inspect_material" || projection.Experiments[1].Action.Name != "ctf.decode_hex" || projection.Experiments[2].Action.Name != "ctf.submit_flag" {
		t.Fatalf("unexpected typed action sequence: %+v", projection.Experiments)
	}
	for _, experiment := range projection.Experiments {
		if len(experiment.ArtifactIDs) == 0 {
			t.Fatalf("experiment %d has no effect-linked artifact evidence", experiment.Number)
		}
	}
}

func TestFailedSubmissionDoesNotEndTheAgentLoop(t *testing.T) {
	core, err := securityruntime.NewService(t.TempDir(), nil)
	if err != nil {
		t.Fatal(err)
	}
	service, err := NewService(core, ServiceOptions{Engine: &solvingEngine{wrongFirst: true}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = service.Close()
		_ = core.Close()
	})

	started, err := service.StartSampleChallenge(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	waitForJob(t, service, started.Job.ID)
	projection, err := service.GetJob(context.Background(), started.Job.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(projection.Evaluations) != 2 || projection.Evaluations[0].Verdict != securityruntime.VerdictFail || projection.Evaluations[1].Verdict != securityruntime.VerdictPass {
		t.Fatalf("expected fail then pass, got %+v", projection.Evaluations)
	}
	if len(projection.Submissions) != 2 || projection.Job.Status != securityruntime.JobSucceeded {
		t.Fatalf("expected two submissions and eventual success, got submissions=%d status=%s", len(projection.Submissions), projection.Job.Status)
	}
}

func TestExpectedFlagIsNotPersistedAsChallengeInputOrExposedToEngine(t *testing.T) {
	core, err := securityruntime.NewService(t.TempDir(), nil)
	if err != nil {
		t.Fatal(err)
	}
	engine := &blockingEngine{called: make(chan struct{})}
	service, err := NewService(core, ServiceOptions{Engine: engine})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = service.Close()
		_ = core.Close()
	})
	const secret = "SECRET{judge_input_must_stay_outside_model_state}"
	started, err := service.StartChallenge(context.Background(), ChallengeRequest{
		Title: "Secret judge input", Statement: "Inspect the material.", Category: "misc",
		CollaborationMode: "delegate", ExpectedFlag: secret,
		Materials: []MaterialRequest{{
			Name: "note.txt", MediaType: "text/plain",
			DataBase64: base64.StdEncoding.EncodeToString([]byte("unrelated material")),
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	select {
	case <-engine.called:
	case <-time.After(2 * time.Second):
		t.Fatal("engine was not called")
	}
	coreProjection, err := core.GetJob(context.Background(), started.Job.ID)
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(coreProjection)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(encoded), secret) {
		t.Fatal("plaintext expected flag was persisted in the event projection")
	}
	challenge, err := challengeFromProjection(coreProjection)
	if err != nil {
		t.Fatal(err)
	}
	input, err := buildAgentInput(coreProjection, challenge, coreProjection.Attempts[0], coreProjection.Steps[0])
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(input.RoleState), secret) || strings.Contains(string(input.RoleState), challenge.Judge.ExpectedFlagSHA256) {
		t.Fatal("judge answer material leaked into agent role state")
	}
}

func TestCancellationLeavesARecoverableFactChainWithCancelledOutcome(t *testing.T) {
	core, err := securityruntime.NewService(t.TempDir(), nil)
	if err != nil {
		t.Fatal(err)
	}
	engine := &blockingEngine{called: make(chan struct{})}
	service, err := NewService(core, ServiceOptions{Engine: engine})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = service.Close()
		_ = core.Close()
	})
	started, err := service.StartSampleChallenge(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	select {
	case <-engine.called:
	case <-time.After(2 * time.Second):
		t.Fatal("engine was not called")
	}
	if err := service.CancelJob(context.Background(), started.Job.ID); err != nil {
		t.Fatal(err)
	}
	waitForJob(t, service, started.Job.ID)
	projection, err := service.GetJob(context.Background(), started.Job.ID)
	if err != nil {
		t.Fatal(err)
	}
	if projection.Job.Status != securityruntime.JobCancelled || projection.Outcome == nil || projection.Outcome.Status != securityruntime.OutcomeCancelled {
		t.Fatalf("expected cancelled outcome, got status=%s outcome=%+v", projection.Job.Status, projection.Outcome)
	}
	if len(projection.Attempts) != 1 || projection.Attempts[0].Status != securityruntime.AttemptInterrupted {
		t.Fatalf("expected interrupted attempt, got %+v", projection.Attempts)
	}
	if len(projection.Experiments) != 1 || projection.Experiments[0].Status != securityruntime.StepFailed {
		t.Fatalf("expected the in-flight experiment to be terminal, got %+v", projection.Experiments)
	}
}

func TestApplicationShutdownClosesTheExperimentAndRecoveryStartsANewAttempt(t *testing.T) {
	core, err := securityruntime.NewService(t.TempDir(), nil)
	if err != nil {
		t.Fatal(err)
	}
	blocking := &blockingEngine{called: make(chan struct{})}
	first, err := NewService(core, ServiceOptions{Engine: blocking})
	if err != nil {
		t.Fatal(err)
	}
	started, err := first.StartSampleChallenge(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	select {
	case <-blocking.called:
	case <-time.After(2 * time.Second):
		t.Fatal("engine was not called")
	}
	if err := first.Close(); err != nil {
		t.Fatal(err)
	}
	interrupted, err := first.GetJob(context.Background(), started.Job.ID)
	if err != nil {
		t.Fatal(err)
	}
	if interrupted.Attempts[0].Status != securityruntime.AttemptInterrupted || interrupted.Experiments[0].Status != securityruntime.StepFailed {
		t.Fatalf("shutdown left non-terminal work behind: attempts=%+v experiments=%+v", interrupted.Attempts, interrupted.Experiments)
	}

	second, err := NewService(core, ServiceOptions{Engine: &solvingEngine{}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = second.Close()
		_ = core.Close()
	})
	if err := second.Recover(context.Background()); err != nil {
		t.Fatal(err)
	}
	waitForJob(t, second, started.Job.ID)
	recovered, err := second.GetJob(context.Background(), started.Job.ID)
	if err != nil {
		t.Fatal(err)
	}
	if recovered.Job.Status != securityruntime.JobSucceeded || len(recovered.Attempts) != 2 {
		t.Fatalf("recovery did not finish in a new attempt: status=%s attempts=%+v", recovered.Job.Status, recovered.Attempts)
	}
}

func TestChallengeIntakeRejectsPathLikeMaterialNames(t *testing.T) {
	_, err := validateRequest(ChallengeRequest{
		Title: "Unsafe material", Statement: "Inspect", ExpectedFlag: "flag{x}",
		Materials: []MaterialRequest{{
			Name: "../outside.txt", MediaType: "text/plain",
			DataBase64: base64.StdEncoding.EncodeToString([]byte("x")),
		}},
	})
	if err == nil {
		t.Fatal("expected path-like material name to be rejected")
	}
}

func TestFlagSubmissionRequiresAnEvidenceExplanation(t *testing.T) {
	input, err := json.Marshal(map[string]string{"candidate": "flag{x}"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := NewCapability(nil).EffectSpec("ctf.submit_flag", input); err == nil {
		t.Fatal("expected an unsupported bare candidate without evidence explanation")
	}
}

func TestProjectionUsesEmptyArraysAcrossTheDesktopContract(t *testing.T) {
	challenge := Challenge{
		ID: "challenge_contract", Title: "Contract", Statement: "Text only", Category: "misc",
		CollaborationMode: "delegate", Materials: []Material{}, KnowledgePoints: []string{},
		Judge:      JudgeSpec{Type: "flag.sha256", Version: "1", ExpectedFlagSHA256: hashFlag("flag{x}")},
		AdmittedAt: time.Now().UTC(),
	}
	data, err := json.Marshal(challenge)
	if err != nil {
		t.Fatal(err)
	}
	projection, err := Project(securityruntime.JobProjection{
		Job: securityruntime.Job{ID: "job_contract", Role: PackageID},
		RoleFacts: []securityruntime.RoleFact{{
			ID: "fact_contract", PackageID: PackageID, SchemaVersion: SchemaVersion,
			Kind: FactChallengeAdmitted, Data: data,
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(projection)
	if err != nil {
		t.Fatal(err)
	}
	for _, field := range []string{"attempts", "experiments", "artifacts", "evidence", "evaluations", "submissions", "events"} {
		if strings.Contains(string(encoded), `"`+field+`":null`) {
			t.Fatalf("desktop contract field %q must be [] instead of null: %s", field, encoded)
		}
	}
}

func waitForJob(t *testing.T, service *Service, jobID string) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := service.Wait(ctx, jobID); err != nil {
		t.Fatal(err)
	}
}
