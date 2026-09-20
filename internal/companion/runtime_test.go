package companion

import (
	"testing"

	"github.com/MilkSU-Official/milksu/internal/engine"
)

func TestStatusExposesParkedConfirm(t *testing.T) {
	runtime := NewRuntime(RuntimeOptions{})
	runtime.parkConfirm("host-1", map[string]any{
		"action":         "stop",
		"conversationId": "coding-1",
		"idempotencyKey": "k1",
		"hostRequestId":  "host-1",
	}, "Coding work")
	status := runtime.Status()
	if status.PendingConfirm == nil {
		t.Fatal("parked stop should show up on GetCompanionStatus")
	}
	if status.PendingConfirm.HostRequestID != "host-1" || status.PendingConfirm.ConversationID != "coding-1" {
		t.Fatalf("pending confirm %#v", status.PendingConfirm)
	}
	if status.PendingConfirm.Action != "stop" || status.PendingConfirm.TargetTitle != "Coding work" {
		t.Fatalf("pending confirm %#v", status.PendingConfirm)
	}
}

func TestObserveEngineEventOwnsRuntimeStatus(t *testing.T) {
	runtime := NewRuntime(RuntimeOptions{})
	runtime.board.ReplaceSessions([]ConversationRef{{ID: "live", Title: "Coding work", Status: "idle"}})
	runtime.ObserveEngineEvent(engine.Event{SessionID: "live", Type: "assistant.delta"})
	if statusOf(runtime, "live") != "running" {
		t.Fatalf("delta should mark running: %#v", runtime.BoardSnapshot())
	}
	runtime.ObserveEngineEvent(engine.Event{SessionID: "live", Type: "approval.requested"})
	if statusOf(runtime, "live") != "needs_approval" {
		t.Fatalf("approval should mark needs_approval: %#v", runtime.BoardSnapshot())
	}
	runtime.ObserveEngineEvent(engine.Event{SessionID: "live", Type: "assistant.settled"})
	if statusOf(runtime, "live") != "idle" {
		t.Fatalf("settled should mark idle: %#v", runtime.BoardSnapshot())
	}
	runtime.ObserveEngineEvent(engine.Event{SessionID: SessionID, Type: "assistant.delta"})
	if statusOf(runtime, SessionID) != "" {
		t.Fatal("companion session must not appear as a work-session row")
	}
}

func statusOf(runtime *Runtime, id string) string {
	for _, session := range runtime.BoardSnapshot().Sessions {
		if session.ID == id {
			return session.Status
		}
	}
	return ""
}
