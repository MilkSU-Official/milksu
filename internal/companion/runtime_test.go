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

func TestAbortTurnClearsParkedConfirm(t *testing.T) {
	runtime := NewRuntime(RuntimeOptions{})
	runtime.parkConfirm("host-abort", map[string]any{
		"action":         "stop",
		"conversationId": "coding-1",
		"idempotencyKey": "k-abort",
		"hostRequestId":  "host-abort",
	}, "Coding work")
	// No sidecar stdin: AbortTurn should still clear parked confirm and return
	// the "not running" write error without leaving a sticky park.
	err := runtime.AbortTurn()
	if err == nil {
		t.Fatal("expected write error without a sidecar")
	}
	if status := runtime.Status(); status.PendingConfirm != nil {
		t.Fatalf("abort should clear parked confirm: %#v", status.PendingConfirm)
	}
}

func TestMarkStaleDoesNotKillInFlightSidecar(t *testing.T) {
	runtime := NewRuntime(RuntimeOptions{})
	runtime.ready = true
	runtime.inFlight.Store(true)
	runtime.MarkStale()
	if !runtime.stale.Load() {
		t.Fatal("settings save should mark companion stale")
	}
	runtime.restartIfStaleIdle()
	if !runtime.ready {
		t.Fatal("in-flight companion must keep the sidecar after settings save")
	}
	if !runtime.stale.Load() {
		t.Fatal("stale flag should wait until the turn settles")
	}
	runtime.setInFlight(false)
	runtime.restartIfStaleIdle()
	if runtime.ready {
		t.Fatal("idle stale companion should restart")
	}
	if runtime.stale.Load() {
		t.Fatal("restart should clear stale")
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
