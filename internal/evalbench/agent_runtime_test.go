package evalbench

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

type fakeAgentRuntime struct {
	results      []AgentRuntimeTurnResult
	errors       []error
	requests     []AgentRuntimeTurnRequest
	restarts     int
	closes       int
	materialRead string
}

func (runtime *fakeAgentRuntime) RunTurn(
	_ context.Context,
	request AgentRuntimeTurnRequest,
) (AgentRuntimeTurnResult, error) {
	runtime.requests = append(runtime.requests, request)
	if request.Turn == 1 {
		data, err := os.ReadFile(filepath.Join(
			request.WorkspacePath,
			agentRuntimeMaterialFilename,
		))
		if err != nil {
			return AgentRuntimeTurnResult{}, err
		}
		runtime.materialRead = string(data)
	}
	index := len(runtime.requests) - 1
	var result AgentRuntimeTurnResult
	if index < len(runtime.results) {
		result = runtime.results[index]
	}
	if index < len(runtime.errors) {
		return result, runtime.errors[index]
	}
	return result, nil
}

func (runtime *fakeAgentRuntime) Restart(context.Context) error {
	runtime.restarts++
	return nil
}

func (runtime *fakeAgentRuntime) Close() {
	runtime.closes++
}

func TestSafeAgentRuntimeE2EUsesReadOnlyToolsAndRecovers(t *testing.T) {
	plan := safeAgentRuntimeTestPlan()
	runtime := successfulFakeAgentRuntime()
	record, err := (AgentRuntimeRunner{
		Runtime: runtime,
		Now:     sequentialClock(),
	}).Run(context.Background(), plan)
	if err != nil {
		t.Fatal(err)
	}
	if record.Status != RunCompleted ||
		record.ReportedOutcome != OutcomeSolved ||
		record.ExitReason != ExitCompletedSolved ||
		record.Turns != 2 ||
		record.ToolCalls != 1 ||
		record.Restarts != 1 ||
		!record.ResumeObserved ||
		!record.ReadObserved ||
		!record.PolicyVerified ||
		record.Judge == nil ||
		!record.Judge.Matched {
		t.Fatalf("unexpected runtime record: %#v", record)
	}
	if runtime.restarts != 1 || runtime.closes != 1 ||
		len(runtime.requests) != 2 {
		t.Fatalf("unexpected runtime lifecycle: %#v", runtime)
	}
	if runtime.materialRead != plan.Admission.StaticMaterial.Prompt+"\n" {
		t.Fatalf("runtime did not read the static material: %q", runtime.materialRead)
	}
	for _, request := range runtime.requests {
		if request.ExecutionMode != "plan" ||
			request.ApprovalPolicy != "read-only" ||
			strings.Contains(request.Prompt, plan.Admission.StaticMaterial.Prompt) {
			t.Fatalf("unsafe runtime request: %#v", request)
		}
	}

	encoded, err := EncodeAgentRuntimeRunRecord(record)
	if err != nil {
		t.Fatal(err)
	}
	for _, forbidden := range []string{
		"MILK",
		plan.Admission.StaticMaterial.Prompt,
		safeRuntimeLoadPrompt,
		safeRuntimeAnswerPrompt,
	} {
		if bytes.Contains(encoded, []byte(forbidden)) {
			t.Fatalf("runtime record leaked plaintext %q: %s", forbidden, encoded)
		}
	}
	decoded, err := DecodeAgentRuntimeRunRecord(encoded)
	if err != nil {
		t.Fatal(err)
	}
	summary, err := decoded.Summary()
	if err != nil {
		t.Fatal(err)
	}
	if summary.ResultAuthority != DeterministicStaticAnswerAuthority ||
		summary.Metrics.Turns != 2 ||
		summary.Metrics.ToolCalls != 1 ||
		summary.Metrics.InputTokens != 0 ||
		summary.Metrics.UsageMeasurement != AgentRuntimeUsageMeasurement ||
		summary.Execution != nil {
		t.Fatalf("unexpected runtime summary: %#v", summary)
	}
}

func TestAgentRuntimeDryRunAndUnknownAdmissionFailClosed(t *testing.T) {
	plan := safeAgentRuntimeTestPlan()
	report, err := BuildAgentRuntimeDryRun(plan)
	if err != nil {
		t.Fatal(err)
	}
	if !report.Runnable || report.RuntimeTurns != 2 ||
		report.PlannedRestarts != 1 ||
		report.ExecutionMode != "plan" ||
		report.ApprovalPolicy != "read-only" {
		t.Fatalf("unexpected runtime dry run: %#v", report)
	}
	data, err := jsonMarshal(report)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(data, []byte(plan.Admission.StaticMaterial.Prompt)) {
		t.Fatalf("runtime dry run leaked prompt: %s", data)
	}

	plan.Admission = AdmissionDecision{
		SourceRevision: NYUCTFBenchRevision,
		Split:          plan.Task.Split,
		TaskID:         plan.Task.ID,
		Classification: AdmissionUnknown,
		Reason:         "No reviewed admission exists.",
	}
	record, err := (AgentRuntimeRunner{Now: sequentialClock()}).Run(
		context.Background(),
		plan,
	)
	if err != nil {
		t.Fatal(err)
	}
	if record.Status != RunCancelled ||
		record.ExitReason != ExitAdmissionBlocked ||
		record.Turns != 0 ||
		record.ToolCalls != 0 {
		t.Fatalf("unknown task did not fail closed: %#v", record)
	}
	if _, err := EncodeAgentRuntimeRunRecord(record); err != nil {
		t.Fatalf("blocked runtime record is invalid: %v", err)
	}
}

func TestAgentRuntimeRejectsEffectfulToolSurface(t *testing.T) {
	plan := safeAgentRuntimeTestPlan()
	runtime := successfulFakeAgentRuntime()
	runtime.results[0].AvailableTools = append(
		runtime.results[0].AvailableTools,
		"bash",
	)
	record, err := (AgentRuntimeRunner{
		Runtime: runtime,
		Now:     sequentialClock(),
	}).Run(context.Background(), plan)
	if err != nil {
		t.Fatal(err)
	}
	if record.Status != RunFailed ||
		record.ExitReason != ExitRuntimePolicyViolation ||
		record.Turns != 1 ||
		runtime.restarts != 0 {
		t.Fatalf("effectful tool surface was not rejected: %#v", record)
	}
	if _, err := EncodeAgentRuntimeRunRecord(record); err != nil {
		t.Fatalf("policy violation record is invalid: %v", err)
	}
}

func TestAgentRuntimeRequiresReadAndPersistedResumeEvidence(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*fakeAgentRuntime)
		reason ExitReason
	}{
		{
			name: "required read",
			mutate: func(runtime *fakeAgentRuntime) {
				runtime.results[0].ToolCalls = nil
			},
			reason: ExitRuntimePolicyViolation,
		},
		{
			name: "persisted resume",
			mutate: func(runtime *fakeAgentRuntime) {
				runtime.results[1].SessionResumed = false
			},
			reason: ExitRuntimeRecoveryFailed,
		},
		{
			name: "tool error",
			mutate: func(runtime *fakeAgentRuntime) {
				runtime.results[0].ToolCalls[0].Errored = true
			},
			reason: ExitRuntimeToolFailure,
		},
		{
			name: "invalid final envelope",
			mutate: func(runtime *fakeAgentRuntime) {
				runtime.results[1].AssistantText = "MILK"
			},
			reason: ExitRuntimeInvalidResponse,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			runtime := successfulFakeAgentRuntime()
			test.mutate(runtime)
			record, err := (AgentRuntimeRunner{
				Runtime: runtime,
				Now:     sequentialClock(),
			}).Run(context.Background(), safeAgentRuntimeTestPlan())
			if err != nil {
				t.Fatal(err)
			}
			if record.Status != RunFailed ||
				record.ExitReason != test.reason ||
				record.ReportedOutcome != OutcomeUnknown {
				t.Fatalf("unexpected runtime failure: %#v", record)
			}
			if _, err := EncodeAgentRuntimeRunRecord(record); err != nil {
				t.Fatalf("runtime failure record is invalid: %v", err)
			}
		})
	}
}

func TestAgentRuntimeRecordsRuntimeFailureWithoutErrorText(t *testing.T) {
	runtime := successfulFakeAgentRuntime()
	runtime.errors = []error{errors.New("sensitive provider failure body")}
	record, err := (AgentRuntimeRunner{
		Runtime: runtime,
		Now:     sequentialClock(),
	}).Run(context.Background(), safeAgentRuntimeTestPlan())
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := EncodeAgentRuntimeRunRecord(record)
	if err != nil {
		t.Fatal(err)
	}
	if record.ExitReason != ExitRuntimeError ||
		bytes.Contains(encoded, []byte("sensitive provider failure body")) {
		t.Fatalf("runtime error leaked into record: %s", encoded)
	}
}

func successfulFakeAgentRuntime() *fakeAgentRuntime {
	available := []string{
		"read",
		"grep",
		"find",
		"ls",
		"bg_status",
		"milksu_progress",
		"lsp_diagnostics",
		"goal_complete",
		"goal_blocked",
	}
	return &fakeAgentRuntime{
		results: []AgentRuntimeTurnResult{
			{
				AssistantText:  `{"loaded":true}`,
				ToolCalls:      []AgentRuntimeToolCall{{Name: "read"}},
				AvailableTools: append([]string(nil), available...),
				ExecutionMode:  "plan",
				ApprovalPolicy: "read-only",
			},
			{
				AssistantText:  `{"answer":"MILK"}`,
				AvailableTools: append([]string(nil), available...),
				ExecutionMode:  "plan",
				ApprovalPolicy: "read-only",
				SessionResumed: true,
			},
		},
	}
}

func safeAgentRuntimeTestPlan() AgentRuntimePlan {
	base := safeStaticTestPlan()
	return AgentRuntimePlan{
		RunID:     "synthetic-agent-runtime-1",
		Task:      base.Task,
		Admission: base.Admission,
		Model:     base.Model,
		Harness: HarnessIdentity{
			Name:         "milksu-agent-runtime-safe-static",
			Version:      "v1alpha1",
			ConfigSHA256: SafeAgentRuntimeHarnessConfigSHA256(),
		},
		Budget: AgentRuntimeBudget{
			TurnTimeoutMillis: 2_000,
			MaxTurns:          2,
			MaxToolCalls:      8,
			MaxAssistantBytes: 8 << 10,
		},
	}
}

func jsonMarshal(value any) ([]byte, error) {
	return json.Marshal(value)
}
