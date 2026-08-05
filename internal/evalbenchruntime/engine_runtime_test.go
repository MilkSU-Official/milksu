package evalbenchruntime

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/MilkSU-Official/milksu/internal/config"
	"github.com/MilkSU-Official/milksu/internal/engine"
)

func TestNewEngineRuntimeAtKeepsExplicitSidecarDirectoryAcrossRestart(t *testing.T) {
	runtime := NewEngineRuntimeAt(
		config.DefaultSettings(),
		"  /tmp/milksu-sidecar  ",
	)
	defer runtime.Close()

	if runtime.sidecarDirectory != "/tmp/milksu-sidecar" {
		t.Fatalf("unexpected Sidecar directory: %q", runtime.sidecarDirectory)
	}
	first := runtime.supervisor
	if err := runtime.Restart(context.Background()); err != nil {
		t.Fatal(err)
	}
	if runtime.supervisor == first {
		t.Fatal("runtime restart did not replace the supervisor")
	}
	if runtime.sidecarDirectory != "/tmp/milksu-sidecar" {
		t.Fatalf("runtime restart lost Sidecar directory: %q", runtime.sidecarDirectory)
	}
}

func TestTurnActivityTimeoutForContextKeepsRuntimeBudgetAuthoritative(t *testing.T) {
	now := time.Date(2026, time.August, 2, 0, 0, 0, 0, time.UTC)
	ctx, cancel := context.WithDeadline(
		context.Background(),
		now.Add(2*time.Minute),
	)
	defer cancel()

	timeout, ok := turnActivityTimeoutForContext(ctx, now)
	if !ok {
		t.Fatal("deadline was not detected")
	}
	want := 2*time.Minute + runtimeTurnDeadlineGrace
	if timeout != want {
		t.Fatalf("unexpected supervisor timeout: got %s want %s", timeout, want)
	}
}

func TestTurnActivityTimeoutForContextIgnoresMissingOrExpiredDeadline(t *testing.T) {
	now := time.Date(2026, time.August, 2, 0, 0, 0, 0, time.UTC)
	if timeout, ok := turnActivityTimeoutForContext(context.Background(), now); ok || timeout != 0 {
		t.Fatalf("context without deadline produced %s", timeout)
	}
	ctx, cancel := context.WithDeadline(context.Background(), now.Add(-time.Second))
	defer cancel()
	if timeout, ok := turnActivityTimeoutForContext(ctx, now); ok || timeout != 0 {
		t.Fatalf("expired context produced %s", timeout)
	}
}

func TestWaitForTurnCollectsPolicyToolsAndFinalAssistantMessage(t *testing.T) {
	events := make(chan engine.Event, 16)
	events <- engine.Event{
		SessionID:      "other",
		Type:           "session.ready",
		ExecutionMode:  "go",
		ApprovalPolicy: "full-auto",
		Tools:          []string{"bash"},
	}
	events <- engine.Event{
		SessionID:      "run-1",
		Type:           "session.ready",
		ExecutionMode:  "plan",
		ApprovalPolicy: "read-only",
		Tools:          []string{"read", "grep"},
		Resumed:        true,
	}
	events <- engine.Event{
		SessionID:  "run-1",
		Type:       "tool.started",
		ToolCallID: "tool-1",
		ToolName:   "read",
	}
	events <- engine.Event{
		SessionID:  "run-1",
		Type:       "tool.completed",
		ToolCallID: "tool-1",
		ToolName:   "read",
	}
	events <- engine.Event{
		SessionID: "run-1",
		Type:      "assistant.delta",
		Text:      `{"answer":"M`,
	}
	events <- engine.Event{
		SessionID: "run-1",
		Type:      "assistant.completed",
		Text:      `{"answer":"MILK"}`,
	}
	events <- engine.Event{
		SessionID: "run-1",
		Type:      "assistant.settled",
	}

	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	result, err := waitForTurn(ctx, engine.NewSupervisor(nil), events, "run-1")
	if err != nil {
		t.Fatal(err)
	}
	if result.AssistantText != `{"answer":"MILK"}` ||
		result.ExecutionMode != "plan" ||
		result.ApprovalPolicy != "read-only" ||
		!result.SessionResumed ||
		len(result.AvailableTools) != 2 ||
		len(result.ToolCalls) != 1 ||
		result.ToolCalls[0].Name != "read" ||
		result.ToolCalls[0].Errored {
		t.Fatalf("unexpected turn result: %#v", result)
	}
}

func TestWaitForTurnPreservesToolFailureWithoutOutput(t *testing.T) {
	events := make(chan engine.Event, 8)
	events <- engine.Event{
		SessionID:  "run-1",
		Type:       "tool.completed",
		ToolCallID: "tool-1",
		ToolName:   "read",
		Error:      "denied",
	}
	events <- engine.Event{
		SessionID: "run-1",
		Type:      "assistant.completed",
		Text:      `{"loaded":true}`,
	}
	events <- engine.Event{
		SessionID: "run-1",
		Type:      "assistant.settled",
	}
	result, err := waitForTurn(
		context.Background(),
		engine.NewSupervisor(nil),
		events,
		"run-1",
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.ToolCalls) != 1 || !result.ToolCalls[0].Errored {
		t.Fatalf("tool failure was not preserved: %#v", result)
	}
}

func TestWaitForTurnFailsClosedOnApprovalAndRuntimeError(t *testing.T) {
	for _, test := range []struct {
		name  string
		event engine.Event
		want  string
	}{
		{
			name: "approval",
			event: engine.Event{
				SessionID: "run-1",
				Type:      "approval.requested",
				RequestID: "approval-1",
			},
			want: "unexpectedly requested approval",
		},
		{
			name: "runtime",
			event: engine.Event{
				SessionID: "run-1",
				Type:      "engine.error",
				Error:     "failed",
			},
			want: "PI runtime event failed",
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			events := make(chan engine.Event, 1)
			events <- test.event
			_, err := waitForTurn(
				context.Background(),
				engine.NewSupervisor(nil),
				events,
				"run-1",
			)
			if err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("unexpected error: %v", err)
			}
		})
	}
}
