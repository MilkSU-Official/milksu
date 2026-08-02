package main

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/MilkSU-Official/milksu/internal/evalbench"
)

func TestReportCommandRequiresExplicitBenchmarkRoot(t *testing.T) {
	var output bytes.Buffer
	err := run([]string{"-split", "development"}, &output)
	if err == nil || err.Error() != "-root is required" {
		t.Fatalf("expected explicit root error, got %v", err)
	}
	if output.Len() != 0 {
		t.Fatalf("invalid command wrote output: %q", output.String())
	}
}

func TestRepeatedRunPathsRejectEmptyValues(t *testing.T) {
	var paths repeatedPaths
	if err := paths.Set(" "); err == nil {
		t.Fatal("expected an empty run path to be rejected")
	}
}

func TestReportCommandAggregatesSafeStaticBaselineRecord(t *testing.T) {
	started := time.Date(2026, time.August, 1, 0, 0, 0, 0, time.UTC)
	expected := evalbench.ExpectedAnswerSHA256("MILK")
	record := evalbench.BaselineRunRecord{
		SchemaVersion:   evalbench.BaselineRunSchemaVersion,
		RunID:           "report-fixture",
		SourceRevision:  evalbench.NYUCTFBenchRevision,
		Split:           evalbench.SplitDevelopment,
		TaskID:          "synthetic-static",
		Admission:       evalbench.AdmissionSafeStatic,
		AdmissionReason: "Human-reviewed synthetic text-only fixture.",
		AdmissionReview: &evalbench.AdmissionReviewRecord{
			PolicyVersion: evalbench.SafeStaticReviewPolicyVersion,
			ReviewedBy:    "fixture-reviewer",
			ReviewedAt:    started,
			Reason:        "Human-reviewed synthetic text-only fixture.",
			PromptSHA256:  "e9bcf944b5621cc671165f7792ce30ba828c094bc8bea48d78d8d814b51043c5",
		},
		Model: evalbench.ModelIdentity{
			Provider: "deepseek", Name: "deepseek-v4-flash", Revision: "api",
		},
		Harness: evalbench.HarnessIdentity{
			Name: "milksu-safe-static", Version: "v1alpha1",
			ConfigSHA256: evalbench.SafeStaticHarnessConfigSHA256(),
		},
		Budget: evalbench.RunBudget{
			TimeoutMillis: 30_000, MaxInputBytes: 8 << 10,
			MaxOutputTokens: 128, MaxCostMicroUSD: 5_000,
		},
		Cost: evalbench.CostRecord{
			PricingSchedule:    "deepseek-v4-flash@official-2026-08-01",
			PricingSourceURL:   evalbench.DeepSeekPricingURL,
			PricingCheckedDate: evalbench.DeepSeekPricingCheckedDate,
			WorstCaseMicroUSD:  102,
			ActualMicroUSD:     5,
		},
		StartedAt: started, FinishedAt: started.Add(time.Second),
		ProviderCalls:   1,
		Status:          evalbench.RunCompleted,
		ReportedOutcome: evalbench.OutcomeSolved,
		ExitReason:      evalbench.ExitCompletedSolved,
		Usage: evalbench.TokenUsage{
			InputTokens: 20, InputCacheMissTokens: 20, OutputTokens: 4,
		},
		Judge: &evalbench.StaticJudgeRecord{
			Method:               "trim-space-sha256",
			ExpectedAnswerSHA256: expected,
			ActualAnswerSHA256:   expected,
			Matched:              true,
		},
	}
	data, err := evalbench.EncodeBaselineRunRecord(record)
	if err != nil {
		t.Fatal(err)
	}
	runPath := filepath.Join(t.TempDir(), "baseline.json")
	if err := os.WriteFile(runPath, data, 0o600); err != nil {
		t.Fatal(err)
	}
	root, err := filepath.Abs(filepath.Join(
		"..", "..", "internal", "evalbench", "testdata", "synthetic",
	))
	if err != nil {
		t.Fatal(err)
	}
	var output bytes.Buffer
	if err := run([]string{
		"-root", root,
		"-split", "development",
		"-baseline-run", runPath,
	}, &output); err != nil {
		t.Fatal(err)
	}
	var report evalbench.Report
	if err := json.Unmarshal(output.Bytes(), &report); err != nil {
		t.Fatal(err)
	}
	if report.ResultAuthority != evalbench.DeterministicStaticAnswerAuthority ||
		report.SolvedTasks != 1 {
		t.Fatalf("unexpected baseline report: %#v", report)
	}
	if strings.Contains(output.String(), "MILK") {
		t.Fatalf("report leaked answer plaintext: %s", output.String())
	}
}

func TestReportCommandAggregatesSafeAgentRuntimeRecord(t *testing.T) {
	started := time.Date(2026, time.August, 1, 0, 0, 0, 0, time.UTC)
	expected := evalbench.ExpectedAnswerSHA256("MILK")
	record := evalbench.AgentRuntimeRunRecord{
		SchemaVersion:   evalbench.AgentRuntimeRunSchemaVersion,
		RunID:           "agent-report-fixture",
		SourceRevision:  evalbench.NYUCTFBenchRevision,
		Split:           evalbench.SplitDevelopment,
		TaskID:          "synthetic-static",
		Admission:       evalbench.AdmissionSafeStatic,
		AdmissionReason: "Human-reviewed synthetic text-only fixture.",
		AdmissionReview: &evalbench.AdmissionReviewRecord{
			PolicyVersion: evalbench.SafeStaticReviewPolicyVersion,
			ReviewedBy:    "fixture-reviewer",
			ReviewedAt:    started,
			Reason:        "Human-reviewed synthetic text-only fixture.",
			PromptSHA256:  "e9bcf944b5621cc671165f7792ce30ba828c094bc8bea48d78d8d814b51043c5",
		},
		Model: evalbench.ModelIdentity{
			Provider: "deepseek", Name: "deepseek-v4-flash", Revision: "api",
		},
		Harness: evalbench.HarnessIdentity{
			Name:         "milksu-agent-runtime-safe-static",
			Version:      "v1alpha1",
			ConfigSHA256: evalbench.SafeAgentRuntimeHarnessConfigSHA256(),
		},
		Budget: evalbench.AgentRuntimeBudget{
			TurnTimeoutMillis: 60_000,
			MaxTurns:          2,
			MaxToolCalls:      12,
			MaxAssistantBytes: 32 << 10,
		},
		StartedAt:        started,
		FinishedAt:       started.Add(2 * time.Second),
		Turns:            2,
		ToolCalls:        1,
		ToolUsage:        []evalbench.AgentRuntimeToolUsage{{Name: "read", Calls: 1}},
		AssistantBytes:   36,
		Restarts:         1,
		ResumeObserved:   true,
		ReadObserved:     true,
		PolicyVerified:   true,
		UsageMeasurement: evalbench.AgentRuntimeUsageMeasurement,
		Status:           evalbench.RunCompleted,
		ReportedOutcome:  evalbench.OutcomeSolved,
		ExitReason:       evalbench.ExitCompletedSolved,
		Judge: &evalbench.StaticJudgeRecord{
			Method:               "trim-space-sha256",
			ExpectedAnswerSHA256: expected,
			ActualAnswerSHA256:   expected,
			Matched:              true,
		},
	}
	data, err := evalbench.EncodeAgentRuntimeRunRecord(record)
	if err != nil {
		t.Fatal(err)
	}
	runPath := filepath.Join(t.TempDir(), "agent.json")
	if err := os.WriteFile(runPath, data, 0o600); err != nil {
		t.Fatal(err)
	}
	root, err := filepath.Abs(filepath.Join(
		"..", "..", "internal", "evalbench", "testdata", "synthetic",
	))
	if err != nil {
		t.Fatal(err)
	}
	var output bytes.Buffer
	if err := run([]string{
		"-root", root,
		"-split", "development",
		"-agent-run", runPath,
	}, &output); err != nil {
		t.Fatal(err)
	}
	var report evalbench.Report
	if err := json.Unmarshal(output.Bytes(), &report); err != nil {
		t.Fatal(err)
	}
	if report.ResultAuthority != evalbench.DeterministicStaticAnswerAuthority ||
		report.SolvedTasks != 1 ||
		len(report.Configurations) != 1 ||
		report.Configurations[0].Harness.Name != "milksu-agent-runtime-safe-static" ||
		report.Execution.UsageUnmeasuredRuns != 1 ||
		len(report.Execution.UsageMeasurements) != 1 ||
		report.Execution.UsageMeasurements[0] != evalbench.AgentRuntimeUsageMeasurement ||
		len(report.Execution.ExitReasons) != 1 ||
		report.Execution.ExitReasons[0].Reason != string(evalbench.ExitCompletedSolved) ||
		report.Execution.ExitReasons[0].Count != 1 {
		t.Fatalf("unexpected agent runtime report: %#v", report)
	}
	if strings.Contains(output.String(), "MILK") {
		t.Fatalf("report leaked answer plaintext: %s", output.String())
	}
}
