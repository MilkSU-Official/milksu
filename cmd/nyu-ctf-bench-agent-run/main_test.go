package main

import (
	"bytes"
	"context"
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/MilkSU-Official/milksu/internal/evalbench"
)

type fakeCLIAgentRuntime struct {
	turns    int
	restarts int
	closes   int
}

func (runtime *fakeCLIAgentRuntime) RunTurn(
	_ context.Context,
	request evalbench.AgentRuntimeTurnRequest,
) (evalbench.AgentRuntimeTurnResult, error) {
	runtime.turns++
	tools := []string{
		"read", "grep", "find", "ls", "bg_status", "milksu_progress",
		"lsp_diagnostics", "goal_complete", "goal_blocked",
	}
	if request.Turn == 1 {
		return evalbench.AgentRuntimeTurnResult{
			AssistantText:  `{"loaded":true}`,
			ToolCalls:      []evalbench.AgentRuntimeToolCall{{Name: "read"}},
			AvailableTools: tools,
			ExecutionMode:  "plan",
			ApprovalPolicy: "read-only",
		}, nil
	}
	return evalbench.AgentRuntimeTurnResult{
		AssistantText:  `{"answer":"MILK"}`,
		AvailableTools: tools,
		ExecutionMode:  "plan",
		ApprovalPolicy: "read-only",
		SessionResumed: true,
	}, nil
}

func (runtime *fakeCLIAgentRuntime) Restart(context.Context) error {
	runtime.restarts++
	return nil
}

func (runtime *fakeCLIAgentRuntime) Close() {
	runtime.closes++
}

func TestAgentCLIDryRunDoesNotLoadRuntimeOrLeakPrompt(t *testing.T) {
	root, admission, prompt := agentSyntheticFixture(t)
	loadCalls := 0
	var stdout bytes.Buffer
	err := run([]string{
		"-root", root,
		"-split", "development",
		"-task", "synthetic-static",
		"-admission", admission,
	}, &stdout, dependencies{
		loadRuntime: func(string, string, string) (evalbench.AgentRuntime, error) {
			loadCalls++
			return &fakeCLIAgentRuntime{}, nil
		},
		now:      time.Now,
		newRunID: func() string { return "agent-dry-run" },
	})
	if err != nil {
		t.Fatal(err)
	}
	if loadCalls != 0 {
		t.Fatalf("dry run loaded the Agent runtime %d times", loadCalls)
	}
	if strings.Contains(stdout.String(), prompt) {
		t.Fatalf("dry run leaked static prompt: %s", stdout.String())
	}
	var report evalbench.AgentRuntimeDryRunReport
	if err := json.Unmarshal(stdout.Bytes(), &report); err != nil {
		t.Fatal(err)
	}
	if !report.Runnable ||
		report.RuntimeTurns != 2 ||
		report.PlannedRestarts != 1 ||
		report.ExecutionMode != "plan" ||
		report.ApprovalPolicy != "read-only" {
		t.Fatalf("unexpected dry run: %#v", report)
	}
}

func TestAgentCLIFakeRuntimeCompletesTwoTurnRecoveryRun(t *testing.T) {
	root, admission, prompt := agentSyntheticFixture(t)
	runtime := &fakeCLIAgentRuntime{}
	current := time.Date(2026, time.August, 1, 0, 0, 0, 0, time.UTC)
	var stdout bytes.Buffer
	err := run([]string{
		"-root", root,
		"-split", "development",
		"-task", "synthetic-static",
		"-admission", admission,
		"-execute",
	}, &stdout, dependencies{
		loadRuntime: func(
			provider,
			model,
			sidecarDirectory string,
		) (evalbench.AgentRuntime, error) {
			if provider != "deepseek" || model != "deepseek-v4-flash" {
				t.Fatalf("unexpected model selection: %s/%s", provider, model)
			}
			if sidecarDirectory != "" {
				t.Fatalf("unexpected test Sidecar directory: %q", sidecarDirectory)
			}
			return runtime, nil
		},
		now: func() time.Time {
			value := current
			current = current.Add(time.Second)
			return value
		},
		newRunID: func() string { return "agent-runtime-e2e" },
	})
	if err != nil {
		t.Fatal(err)
	}
	if runtime.turns != 2 || runtime.restarts != 1 || runtime.closes != 1 {
		t.Fatalf("unexpected runtime lifecycle: %#v", runtime)
	}
	for _, forbidden := range []string{"MILK", prompt, "api_key", "credential"} {
		if strings.Contains(stdout.String(), forbidden) {
			t.Fatalf("agent run persisted forbidden plaintext %q: %s", forbidden, stdout.String())
		}
	}
	record, err := evalbench.DecodeAgentRuntimeRunRecord(stdout.Bytes())
	if err != nil {
		t.Fatal(err)
	}
	if record.Status != evalbench.RunCompleted ||
		record.ExitReason != evalbench.ExitCompletedSolved ||
		record.Turns != 2 ||
		record.ToolCalls != 1 ||
		!record.ResumeObserved ||
		record.Judge == nil ||
		!record.Judge.Matched {
		t.Fatalf("unexpected agent runtime record: %#v", record)
	}
}

func TestAgentCLIWithoutAdmissionNeverLoadsRuntime(t *testing.T) {
	root, _, _ := agentSyntheticFixture(t)
	loadCalls := 0
	var stdout bytes.Buffer
	err := run([]string{
		"-root", root,
		"-split", "development",
		"-task", "synthetic-static",
		"-execute",
	}, &stdout, dependencies{
		loadRuntime: func(string, string, string) (evalbench.AgentRuntime, error) {
			loadCalls++
			return &fakeCLIAgentRuntime{}, nil
		},
		now:      time.Now,
		newRunID: func() string { return "agent-blocked" },
	})
	if err != nil {
		t.Fatal(err)
	}
	if loadCalls != 0 {
		t.Fatalf("unknown task loaded the runtime %d times", loadCalls)
	}
	record, err := evalbench.DecodeAgentRuntimeRunRecord(stdout.Bytes())
	if err != nil {
		t.Fatal(err)
	}
	if record.Status != evalbench.RunCancelled ||
		record.ExitReason != evalbench.ExitAdmissionBlocked ||
		record.Turns != 0 {
		t.Fatalf("unknown task was not blocked: %#v", record)
	}
}

func TestDefaultSidecarDirectoryRequiresCompletePackagedRuntime(t *testing.T) {
	workingDirectory, err := filepath.Abs(".")
	if err != nil {
		t.Fatal(err)
	}
	t.Chdir(t.TempDir())
	if got := defaultSidecarDirectory(); got != "" {
		t.Fatalf("incomplete Sidecar directory was selected: %q", got)
	}
	t.Chdir(workingDirectory)
}

func agentSyntheticFixture(t *testing.T) (string, string, string) {
	t.Helper()
	root, err := filepath.Abs(filepath.Join(
		"..", "..", "internal", "evalbench", "testdata", "synthetic",
	))
	if err != nil {
		t.Fatal(err)
	}
	return root,
		filepath.Join(root, "admission.json"),
		"A plain text word puzzle. Return the uppercase spelling of milk."
}
