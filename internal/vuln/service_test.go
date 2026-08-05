package vuln

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/MilkSU-Official/milksu/internal/securityruntime"
)

func TestPacketParserFixtureCreatesRecoverableResearchWorkspace(t *testing.T) {
	runtime, err := securityruntime.NewService(t.TempDir(), nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = runtime.Close() })
	service, err := NewService(runtime)
	if err != nil {
		t.Fatal(err)
	}

	projection, err := service.StartPacketParserFixture(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if projection.Job.Role != PackageID || projection.Target.Version != "local-v1" {
		t.Fatalf("unexpected target projection: %+v", projection.Target)
	}
	if projection.Job.Status != securityruntime.JobRunning || projection.Outcome != nil {
		t.Fatalf("workspace should wait for reproduction evidence: status=%s outcome=%+v", projection.Job.Status, projection.Outcome)
	}
	if projection.AttackSurface == nil || projection.RootCause == nil || len(projection.Hypotheses) != 1 {
		t.Fatalf("static research facts are incomplete: %+v", projection)
	}
	if len(projection.Evidence) != 1 || len(projection.Artifacts) < 2 {
		t.Fatalf("source evidence was not committed: evidence=%d artifacts=%d", len(projection.Evidence), len(projection.Artifacts))
	}
}

func TestCVETrackingWorkspaceRecordsUserConfirmedLearning(t *testing.T) {
	runtime, err := securityruntime.NewService(t.TempDir(), nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = runtime.Close() })
	service, err := NewService(runtime)
	if err != nil {
		t.Fatal(err)
	}

	projection, err := service.EnsureCVETrackingWorkspace(context.Background(), TrackingWorkspaceRequest{
		CVEID:         " cve-2023-46604 ",
		Title:         "Apache ActiveMQ OpenWire RCE",
		Summary:       "User-confirmed advisory reading and dependency impact notes.",
		ReferenceHref: "https://nvd.nist.gov/vuln/detail/CVE-2023-46604",
	})
	if err != nil {
		t.Fatal(err)
	}
	if projection.Target.Name != "CVE-2023-46604" || projection.Target.Fixture != "cve-tracking" {
		t.Fatalf("unexpected tracking target: %+v", projection.Target)
	}
	if projection.Target.Scope.Targets[0].Kind != "origin" ||
		projection.Target.Scope.Targets[0].Value != "https://nvd.nist.gov" {
		t.Fatalf("reference scope was not normalized to origin: %+v", projection.Target.Scope.Targets)
	}

	projection, err = service.RecordLearning(context.Background(), projection.Job.ID, LearningRecordRequest{
		Kind:    "reflection",
		Content: "用户确认：公告和补丁版本已核对，当前只记录学习结论，不声明真实资产已验证。",
		Concept: "CVE-2023-46604",
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(projection.Learning) != 1 ||
		projection.Learning[0].Kind != "reflection" ||
		projection.HumanOutcome.ReflectionCount != 1 {
		t.Fatalf("learning record was not projected: %+v", projection)
	}

	reused, err := service.EnsureCVETrackingWorkspace(context.Background(), TrackingWorkspaceRequest{
		CVEID: "CVE-2023-46604",
		Title: "Duplicate request",
	})
	if err != nil {
		t.Fatal(err)
	}
	if reused.Job.ID != projection.Job.ID || len(reused.Learning) != 1 {
		t.Fatalf("tracking workspace was not reused: first=%s reused=%s learning=%d", projection.Job.ID, reused.Job.ID, len(reused.Learning))
	}
}

func TestExternalThreeRunEvidenceIsEvaluatorBacked(t *testing.T) {
	runtime, err := securityruntime.NewService(t.TempDir(), nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = runtime.Close() })
	service, err := NewService(runtime)
	if err != nil {
		t.Fatal(err)
	}
	projection, err := service.StartPacketParserFixture(context.Background())
	if err != nil {
		t.Fatal(err)
	}

	request := validEvidenceRequest()
	projection, err = service.SubmitReproductionEvidence(context.Background(), projection.Job.ID, request)
	if err != nil {
		t.Fatal(err)
	}
	if projection.Reproduction == nil || projection.Reproduction.StableRuns != 3 {
		t.Fatalf("unexpected reproduction: %+v", projection.Reproduction)
	}
	if projection.Outcome == nil || projection.Outcome.Status != securityruntime.OutcomeSucceeded {
		t.Fatalf("expected evaluator-backed success: %+v", projection.Outcome)
	}
	if len(projection.Evaluations) != 1 || projection.Evaluations[0].Evaluator != "vuln-external-reproduction-evidence" {
		t.Fatalf("unexpected evaluations: %+v", projection.Evaluations)
	}
	artifact := projection.Artifacts[len(projection.Artifacts)-1]
	data, err := runtime.ReadArtifact(context.Background(), artifact)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(data), "triggerBytes") {
		t.Fatal("reproduction artifact must not contain trigger bytes")
	}
}

func TestEvaluatorRejectsInconsistentSanitizerEvidence(t *testing.T) {
	request := validEvidenceRequest()
	request.Runs[1].SanitizerLog = "ordinary parser exit without sanitizer finding"
	decision, reproduction := (ReproductionEvaluator{}).Evaluate(request)
	if decision.Verdict != securityruntime.VerdictFail || reproduction.StableRuns != 2 {
		t.Fatalf("expected a failed 2/3 evaluation: decision=%+v reproduction=%+v", decision, reproduction)
	}
}

func validEvidenceRequest() ReproductionRequest {
	log := "ERROR: AddressSanitizer: stack-buffer-overflow in parse_packet parser.c"
	return ReproductionRequest{
		TriggerSHA256: strings.Repeat("a", 64),
		TriggerSize:   19,
		Environment: EnvironmentFingerprint{
			Compiler: "clang 16.0.0", Sanitizer: "AddressSanitizer",
			OS: "macOS 14.4", Architecture: "arm64",
		},
		Runs: []ReproductionRun{
			{Number: 1, ExitCode: 1, SanitizerLog: log, ObservedAt: time.Now().UTC()},
			{Number: 2, ExitCode: 1, SanitizerLog: log, ObservedAt: time.Now().UTC()},
			{Number: 3, ExitCode: 1, SanitizerLog: log, ObservedAt: time.Now().UTC()},
		},
		CleanRunAttested: true,
		Attestation:      "我确认三份日志来自三个独立的干净本地进程。",
	}
}
