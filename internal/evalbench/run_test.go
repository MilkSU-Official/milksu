package evalbench

import (
	"bytes"
	"strings"
	"testing"
	"time"
)

func TestRunRecordRoundTripIsSummaryOnly(t *testing.T) {
	record := testRun("run-1", SplitDevelopment, "web-one", RunCompleted, OutcomeSolved)
	encoded, err := EncodeRunRecord(record)
	if err != nil {
		t.Fatal(err)
	}
	for _, forbidden := range []string{"prompt", "command", "transcript", "flag", "modelOutput"} {
		if bytes.Contains(encoded, []byte(forbidden)) {
			t.Fatalf("run record unexpectedly contains %q: %s", forbidden, encoded)
		}
	}
	decoded, err := DecodeRunRecord(encoded)
	if err != nil {
		t.Fatal(err)
	}
	if decoded.RunID != record.RunID || decoded.ResultAuthority != ReportedResultAuthority {
		t.Fatalf("unexpected decoded run: %#v", decoded)
	}
}

func TestRunRecordRejectsExecutableOrAuthoritativeExtensions(t *testing.T) {
	encoded, err := EncodeRunRecord(testRun("run-1", SplitDevelopment, "web-one", RunCompleted, OutcomeSolved))
	if err != nil {
		t.Fatal(err)
	}
	encoded = bytes.Replace(encoded, []byte("\n}"), []byte(",\n  \"command\": \"not accepted\"\n}"), 1)
	if _, err := DecodeRunRecord(encoded); err == nil || !strings.Contains(err.Error(), "unknown field") {
		t.Fatalf("expected command field rejection, got %v", err)
	}

	record := testRun("run-2", SplitDevelopment, "web-one", RunCompleted, OutcomeSolved)
	record.ResultAuthority = "independently-verified"
	if err := ValidateRunRecord(record); err == nil || !strings.Contains(err.Error(), "unsupported result authority") {
		t.Fatalf("expected non-authoritative result constraint, got %v", err)
	}
}

func TestRunRecordRequiresConsistentTerminalState(t *testing.T) {
	record := testRun("run-1", SplitDevelopment, "web-one", RunFailed, OutcomeSolved)
	if err := ValidateRunRecord(record); err == nil {
		t.Fatal("expected failed run with solved outcome to be rejected")
	}
	record.ReportedOutcome = OutcomeUnknown
	if err := ValidateRunRecord(record); err != nil {
		t.Fatalf("expected consistent failed record: %v", err)
	}
}

func TestRunRecordRejectsConflictingExitReasons(t *testing.T) {
	record := testRun("run-1", SplitDevelopment, "web-one", RunFailed, OutcomeUnknown)
	record.ExitReason = "runtime-timeout"
	record.Execution = &RunExecutionSummary{
		ExitReason:         "runtime-error",
		ProviderCalls:      0,
		TimeoutMillis:      60_000,
		MaxOutputTokens:    32,
		PricingSchedule:    "fixture",
		PricingSourceURL:   "https://example.com/pricing",
		PricingCheckedDate: "2026-08-01",
	}
	if err := ValidateRunRecord(record); err == nil ||
		!strings.Contains(err.Error(), "does not match") {
		t.Fatalf("expected conflicting exit reason rejection, got %v", err)
	}
}

func testRun(id string, split Split, taskID string, status RunStatus, outcome ReportedOutcome) RunRecord {
	started := time.Date(2026, time.August, 1, 1, 2, 3, 0, time.UTC)
	return RunRecord{
		SchemaVersion:  RunSchemaVersion,
		RunID:          id,
		SourceRevision: NYUCTFBenchRevision,
		Split:          split,
		TaskID:         taskID,
		Model: ModelIdentity{
			Provider: "example-provider",
			Name:     "example-model",
			Revision: "2026-08-01",
		},
		Harness: HarnessIdentity{
			Name:         "milksu-ctf",
			Version:      "0.4.0",
			ConfigSHA256: strings.Repeat("a", 64),
		},
		Status:          status,
		ReportedOutcome: outcome,
		ResultAuthority: ReportedResultAuthority,
		StartedAt:       started,
		FinishedAt:      started.Add(90 * time.Second),
		Metrics: RunMetrics{
			Turns: 2, ToolCalls: 3, InputTokens: 100, OutputTokens: 50,
		},
	}
}
