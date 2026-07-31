package ctf

import (
	"context"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/MilkSU-Official/milksu/internal/securitypolicy"
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

type textDecodeEngine struct{}

func (textDecodeEngine) Name() string  { return "text-decode-ctf-engine" }
func (textDecodeEngine) Model() string { return "deterministic-test" }

func (textDecodeEngine) Propose(_ context.Context, input securityruntime.EngineInput) (securityruntime.ActionProposal, error) {
	var state agentState
	if err := json.Unmarshal(input.RoleState, &state); err != nil {
		return securityruntime.ActionProposal{}, err
	}
	proposal := securityruntime.ActionProposal{Capability: CapabilityName}
	if len(state.Actions) == 0 {
		proposal.Name = "ctf.decode_text"
		proposal.Input, _ = json.Marshal(map[string]any{
			"source": "TlNTQ1RGe3R5cGVkX3RleHRfZGVjb2RlfQ==", "encoding": "auto", "maxLayers": 4,
		})
		proposal.Rationale = "题面包含 Base64 文本，先用确定性文本转换得到可核查结果。"
		return proposal, nil
	}
	proposal.Name = "ctf.submit_flag"
	proposal.Input, _ = json.Marshal(map[string]string{
		"candidate": "NSSCTF{typed_text_decode}", "explanation": "候选来自已记录的 Base64 解码观察。",
	})
	proposal.Rationale = "将确定性解码得到的候选交给外部平台 Judge。"
	return proposal, nil
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

func TestTextDecodeFeedsExternalPlatformSubmissionGate(t *testing.T) {
	core, err := securityruntime.NewService(t.TempDir(), nil)
	if err != nil {
		t.Fatal(err)
	}
	service, err := NewService(core, ServiceOptions{Engine: textDecodeEngine{}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = service.Close()
		_ = core.Close()
	})

	started, err := service.StartChallenge(context.Background(), ChallengeRequest{
		Title: "NSSCTF Base64", Statement: "Decode the provided text.", Category: "misc",
		CollaborationMode: "delegate", TrackName: "NSSCTF", HumanGoal: "解释并完成题目",
		SourceKind: "url", SourceURI: "https://www.nssctf.cn/problem/7533",
		ExternalPlatform: "nssctf-web", ExternalAttemptID: 7533,
	})
	if err != nil {
		t.Fatal(err)
	}
	waitForJob(t, service, started.Job.ID)
	projection, err := service.GetJob(context.Background(), started.Job.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(projection.Experiments) != 2 ||
		projection.Experiments[0].Action == nil ||
		projection.Experiments[0].Action.Name != "ctf.decode_text" {
		t.Fatalf("unexpected external text-decode experiments: %#v", projection.Experiments)
	}
	if len(projection.Submissions) != 1 ||
		projection.Submissions[0].Candidate != "NSSCTF{typed_text_decode}" ||
		projection.Submissions[0].Verdict != securityruntime.VerdictNeedsReview {
		t.Fatalf("decoded candidate did not reach the external Judge gate: %#v", projection.Submissions)
	}
	if projection.Outcome != nil || projection.Job.Status != securityruntime.JobRunning {
		t.Fatalf("external platform candidate was incorrectly treated as success: status=%s outcome=%#v", projection.Job.Status, projection.Outcome)
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

func TestRecoveryLeavesDeferredWorkspaceQueuedUntilExplicitContinue(t *testing.T) {
	core, err := securityruntime.NewService(t.TempDir(), nil)
	if err != nil {
		t.Fatal(err)
	}
	first, err := NewService(core, ServiceOptions{Engine: &solvingEngine{}})
	if err != nil {
		t.Fatal(err)
	}
	expected := "MILKSU{typed_security_loop}"
	started, err := first.StartChallenge(context.Background(), ChallengeRequest{
		Title: "Deferred workspace", Statement: "Decode the material.", Category: "misc",
		CollaborationMode: "delegate", DeferAgent: true, ExpectedFlag: expected,
		Materials: []MaterialRequest{{
			Name: "challenge.hex", MediaType: "text/plain",
			DataBase64: base64.StdEncoding.EncodeToString([]byte(hex.EncodeToString([]byte(expected)))),
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := first.Close(); err != nil {
		t.Fatal(err)
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
	deferred, err := second.GetJob(context.Background(), started.Job.ID)
	if err != nil {
		t.Fatal(err)
	}
	if deferred.Job.Status != securityruntime.JobQueued || len(deferred.Attempts) != 0 || len(deferred.Experiments) != 0 {
		t.Fatalf("recovery started a deliberately deferred workspace: %#v", deferred)
	}
	if _, err := second.ContinueJob(context.Background(), started.Job.ID); err != nil {
		t.Fatal(err)
	}
	waitForJob(t, second, started.Job.ID)
	completed, err := second.GetJob(context.Background(), started.Job.ID)
	if err != nil {
		t.Fatal(err)
	}
	if completed.Job.Status != securityruntime.JobSucceeded {
		t.Fatalf("explicitly continued workspace did not complete: %#v", completed)
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

func TestChallengeIntakeRejectsRemovedHTBCTFJobs(t *testing.T) {
	_, err := validateRequest(ChallengeRequest{
		Title:             "Removed HTB CTF event",
		Statement:         "This product adapter must no longer be admitted.",
		Category:          "web",
		CollaborationMode: "copilot",
		SourceKind:        "url",
		SourceURI:         "https://ctf.hackthebox.com/",
		ExternalPlatform:  "hackthebox-ctf",
		ExternalAttemptID: 901,
	})
	if err == nil || !strings.Contains(err.Error(), "unsupported external CTF platform") {
		t.Fatalf("expected removed HTB CTF adapter to be rejected, got %v", err)
	}
}

func TestChallengeIntakeAddsNormalizedExactSourceTargets(t *testing.T) {
	admitted, err := validateRequest(ChallengeRequest{
		Title:      "Arena target",
		Statement:  "Use the assigned challenge environment.",
		SourceKind: "url",
		SourceURI:  "https://www.nssctf.cn/problem/316",
		SourceTargets: []securitypolicy.Target{
			{Kind: securitypolicy.TargetOrigin, Value: "https://www.nssctf.cn/another-path"},
			{Kind: securitypolicy.TargetOrigin, Value: "http://arena.example.test:18080/path"},
			{Kind: securitypolicy.TargetSocket, Value: "pwn.example.test:31337"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	targets := admitted.source.Scope.Targets
	if len(targets) != 3 {
		t.Fatalf("unexpected normalized source targets: %#v", targets)
	}
	if targets[0].Kind != securitypolicy.TargetOrigin ||
		targets[0].Value != "https://www.nssctf.cn" ||
		targets[1].Kind != securitypolicy.TargetOrigin ||
		targets[1].Value != "http://arena.example.test:18080" ||
		targets[2].Kind != securitypolicy.TargetSocket ||
		targets[2].Value != "pwn.example.test:31337" {
		t.Fatalf("source scope does not preserve exact normalized targets: %#v", targets)
	}
}

func TestChallengeIntakeRejectsInvalidAdditionalSourceTarget(t *testing.T) {
	_, err := validateRequest(ChallengeRequest{
		Title:      "Invalid target",
		Statement:  "Do not broaden scope.",
		SourceKind: "url",
		SourceURI:  "https://www.nssctf.cn/problem/316",
		SourceTargets: []securitypolicy.Target{{
			Kind:  securitypolicy.TargetDirectory,
			Value: "/",
		}},
	})
	if err == nil || !strings.Contains(err.Error(), "additional source target") {
		t.Fatalf("invalid additional target was not rejected: %v", err)
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

func TestDeferredArenaChallengeRecordsPlatformVerdictsAsEvidence(t *testing.T) {
	core, err := securityruntime.NewService(t.TempDir(), nil)
	if err != nil {
		t.Fatal(err)
	}
	blocking := &blockingEngine{called: make(chan struct{})}
	service, err := NewService(core, ServiceOptions{Engine: blocking})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = service.Close()
		_ = core.Close()
	})
	started, err := service.StartChallenge(context.Background(), ChallengeRequest{
		Title: "[Arena] example", Statement: "Find the platform flag.", Category: "web",
		CollaborationMode: "copilot", DeferAgent: true,
		TrackName: "NSSCTF Agent Arena", HumanGoal: "完成真实平台题目并保留判题证据。",
		SourceKind: "url", SourceURI: "https://www.nssctf.cn/problem/200",
		ExternalPlatform: "nssctf-agent-arena", ExternalAttemptID: 100,
	})
	if err != nil {
		t.Fatal(err)
	}
	select {
	case <-blocking.called:
		t.Fatal("deferred Arena intake unexpectedly started the model")
	default:
	}
	if started.Challenge.ExternalAttemptID != 100 || started.Challenge.ExternalPlatform != "nssctf-agent-arena" {
		t.Fatalf("Arena identity was not projected: %+v", started.Challenge)
	}

	pending, err := service.PrepareExternalSubmission(context.Background(), started.Job.ID, "NSSCTF{wrong}", "候选来自已记录的分析。", 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(pending.Submissions) != 1 || pending.Submissions[0].Verdict != securityruntime.VerdictNeedsReview {
		t.Fatalf("candidate did not enter the external judge gate: %+v", pending.Submissions)
	}
	rejectedVerdict := false
	if _, err := service.RecordExternalJudgeReceipt(context.Background(), started.Job.ID, ExternalJudgeReceiptRequest{
		Platform: "nssctf-agent-arena", Status: "rejected", Correct: &rejectedVerdict,
		Summary: "NSSCTF returned correct=false.", Reference: "nssctf-agent-arena:attempt:100",
	}); err != nil {
		t.Fatal(err)
	}
	rejected, err := service.RecordExternalVerdict(context.Background(), started.Job.ID, false, "NSSCTF Agent Arena returned correct=false.")
	if err != nil {
		t.Fatal(err)
	}
	if rejected.Job.Status == securityruntime.JobSucceeded || rejected.Evaluations[len(rejected.Evaluations)-1].Verdict != securityruntime.VerdictFail {
		t.Fatalf("rejected platform candidate changed success state: %+v", rejected)
	}
	if len(rejected.Submissions) != 1 || rejected.Submissions[0].Verdict != securityruntime.VerdictFail {
		t.Fatalf("rejected platform candidate was not projected as final: %+v", rejected.Submissions)
	}
	if len(rejected.JudgeReceipts) != 1 || rejected.JudgeReceipts[0].Correct == nil || *rejected.JudgeReceipts[0].Correct {
		t.Fatalf("rejected Judge receipt was not projected: %+v", rejected.JudgeReceipts)
	}
	if _, err := service.PrepareExternalSubmission(context.Background(), started.Job.ID, "NSSCTF{wrong}", "不要重复提交。", 1); err == nil {
		t.Fatal("an already judged platform candidate was accepted again")
	}
	select {
	case <-blocking.called:
		t.Fatal("platform rejection unexpectedly restarted the model")
	default:
	}

	pending, err = service.PrepareExternalSubmission(context.Background(), started.Job.ID, "NSSCTF{correct}", "修正候选来自新的证据。", 1)
	if err != nil {
		t.Fatal(err)
	}
	acceptedVerdict := true
	if _, err := service.RecordExternalJudgeReceipt(context.Background(), started.Job.ID, ExternalJudgeReceiptRequest{
		Platform: "nssctf-agent-arena", Status: "accepted", Correct: &acceptedVerdict,
		Summary: "NSSCTF returned correct=true.", Reference: "nssctf-agent-arena:attempt:100",
	}); err != nil {
		t.Fatal(err)
	}
	accepted, err := service.RecordExternalVerdict(context.Background(), started.Job.ID, true, "NSSCTF Agent Arena returned correct=true.")
	if err != nil {
		t.Fatal(err)
	}
	if pending.Submissions[len(pending.Submissions)-1].Candidate != "NSSCTF{correct}" ||
		pending.Submissions[len(pending.Submissions)-1].ExternalWrongCountBefore == nil ||
		*pending.Submissions[len(pending.Submissions)-1].ExternalWrongCountBefore != 1 ||
		accepted.Job.Status != securityruntime.JobSucceeded ||
		accepted.Outcome == nil ||
		accepted.Outcome.Status != securityruntime.OutcomeSucceeded ||
		len(accepted.Submissions) != 2 ||
		accepted.Submissions[1].Verdict != securityruntime.VerdictPass ||
		len(accepted.JudgeReceipts) != 2 {
		t.Fatalf("accepted platform verdict did not finish the evidence chain: %+v", accepted)
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
	for _, field := range []string{"attempts", "experiments", "artifacts", "evidence", "evaluations", "agentRuns", "agentCandidates", "submissions", "judgeReceipts", "events"} {
		if strings.Contains(string(encoded), `"`+field+`":null`) {
			t.Fatalf("desktop contract field %q must be [] instead of null: %s", field, encoded)
		}
	}
}

func TestCodingAgentTurnProjectsReplayMetrics(t *testing.T) {
	core, err := securityruntime.NewService(t.TempDir(), nil)
	if err != nil {
		t.Fatal(err)
	}
	service, err := NewService(core, ServiceOptions{Engine: securityruntime.FakeAgentEngine{}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = service.Close()
		_ = core.Close()
	})
	started, err := service.StartChallenge(context.Background(), ChallengeRequest{
		Title: "PI replay metrics", Statement: "Inspect the fixture.", Category: "misc",
		CollaborationMode: "copilot", DeferAgent: true,
		SourceKind: "text",
	})
	if err != nil {
		t.Fatal(err)
	}
	trajectory := []byte(
		"{\"type\":\"tool.started\",\"toolName\":\"read\"}\n" +
			"{\"type\":\"tool.completed\",\"toolName\":\"read\"}\n" +
			"{\"type\":\"assistant.completed\"}\n",
	)
	recorded, err := service.RecordCodingAgentTurn(
		context.Background(),
		started.Job.ID,
		"ctf_replay",
		"deepseek/deepseek-chat",
		"已读取题面并记录第一条假设。",
		trajectory,
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(recorded.AgentRuns) != 1 {
		t.Fatalf("expected one projected Agent run: %+v", recorded.AgentRuns)
	}
	run := recorded.AgentRuns[0]
	if run.SessionID != "ctf_replay" ||
		run.Metrics.CompletedTurns != 1 ||
		run.Metrics.ToolCalls != 1 ||
		run.Metrics.ToolUsage["read"] != 1 ||
		run.TrajectoryArtifactID == "" ||
		!strings.Contains(run.Summary, "累计 1 回合") {
		t.Fatalf("unexpected projected Agent run: %+v", run)
	}
}

func TestCodingAgentCandidateDoesNotEnterExternalJudgeBeforeUserSubmission(t *testing.T) {
	core, err := securityruntime.NewService(t.TempDir(), nil)
	if err != nil {
		t.Fatal(err)
	}
	service, err := NewService(core, ServiceOptions{Engine: securityruntime.FakeAgentEngine{}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = service.Close()
		_ = core.Close()
	})
	started, err := service.StartChallenge(context.Background(), ChallengeRequest{
		Title: "PI candidate gate", Statement: "Find the flag.", Category: "web",
		CollaborationMode: "copilot", DeferAgent: true,
		SourceKind: "url", SourceURI: "https://www.nssctf.cn/problem/316",
		ExternalPlatform: "nssctf-web", ExternalAttemptID: 316,
	})
	if err != nil {
		t.Fatal(err)
	}
	recorded, err := service.RecordCodingAgentCandidate(
		context.Background(),
		started.Job.ID,
		"ctf_session",
		"NSSCTF{candidate}",
		"PI preserved a replayable trajectory.",
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(recorded.AgentCandidates) != 1 ||
		len(recorded.Submissions) != 0 ||
		len(recorded.Evaluations) != 0 {
		t.Fatalf("PI candidate crossed the Judge gate early: %+v", recorded)
	}
	if recorded.AgentCandidates[0].Assessment.Status != "plausible" ||
		len(recorded.AgentCandidates[0].Assessment.Warnings) != 0 {
		t.Fatalf("plausible candidate received unexpected warnings: %+v", recorded.AgentCandidates[0])
	}
	if _, err := service.RecordCodingAgentCandidate(
		context.Background(),
		started.Job.ID,
		"ctf_session",
		"NSSCTF{line\nbreak}",
		"invalid multiline candidate",
	); err == nil {
		t.Fatal("candidate gate accepted a control character")
	}
	pending, err := service.PrepareExternalSubmission(
		context.Background(),
		started.Job.ID,
		recorded.AgentCandidates[0].Candidate,
		recorded.AgentCandidates[0].Explanation,
		2,
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(pending.Submissions) != 1 ||
		pending.Submissions[0].ExternalWrongCountBefore == nil ||
		*pending.Submissions[0].ExternalWrongCountBefore != 2 {
		t.Fatalf("submission did not capture the action-time platform baseline: %+v", pending.Submissions)
	}
}

func TestCandidateAssessmentWarnsWithoutBlockingCustomFormats(t *testing.T) {
	assessment := assessCandidate("custom flag with spaces", "nssctf-web")
	if assessment.Status != "unusual" || len(assessment.Warnings) < 2 {
		t.Fatalf("unexpected candidate assessment: %+v", assessment)
	}
	if err := validateCandidateText("custom flag with spaces"); err != nil {
		t.Fatalf("unusual but valid candidate should remain user-submittable: %v", err)
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
