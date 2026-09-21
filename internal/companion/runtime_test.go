package companion

import (
	"bufio"
	"encoding/json"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

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
	// No sidecar stdin: AbortTurn still clears parked confirm and must not
	// surface "companion sidecar is not running" to the UI.
	if err := runtime.AbortTurn(); err != nil {
		t.Fatalf("abort without sidecar: %v", err)
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

func TestArchiveTranscriptKeepsSidecar(t *testing.T) {
	dir := t.TempDir()
	sessionDir := filepath.Join(dir, "sessions")
	if err := os.MkdirAll(sessionDir, 0o700); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(sessionDir, "2026-01-01T00-00-00-000Z_companion.jsonl")
	if err := os.WriteFile(path, []byte("{\"type\":\"session\",\"id\":\"companion\"}\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	reader, writer := io.Pipe()
	var mu sync.Mutex
	var writes []map[string]any
	done := make(chan struct{})
	go func() {
		defer close(done)
		scanner := bufio.NewScanner(reader)
		for scanner.Scan() {
			var raw map[string]any
			if json.Unmarshal(scanner.Bytes(), &raw) != nil {
				continue
			}
			mu.Lock()
			writes = append(writes, raw)
			mu.Unlock()
		}
	}()
	runtime := NewRuntime(RuntimeOptions{AgentDir: dir})
	runtime.ready = true
	runtime.stdin = writer
	runtime.command = &exec.Cmd{}
	archived, err := runtime.ArchiveTranscript()
	if err != nil {
		t.Fatal(err)
	}
	if archived.Name == "" {
		t.Fatalf("archive: %#v", archived)
	}
	if !runtime.ready || runtime.stdin == nil {
		t.Fatal("archive must keep the sidecar running")
	}
	_ = writer.Close()
	<-done
	mu.Lock()
	defer mu.Unlock()
	reset := false
	for _, write := range writes {
		if strings.TrimSpace(stringValue(write["action"])) != "create_session" {
			continue
		}
		if write["reset"] == true {
			reset = true
		}
	}
	if !reset {
		t.Fatalf("archive must ask the live sidecar for a fresh jsonl: %#v", writes)
	}
}

func TestReadEventsDoesNotClobberReplacementSidecar(t *testing.T) {
	runtime := NewRuntime(RuntimeOptions{})
	oldReader, oldWriter := io.Pipe()
	runtime.sidecarGen.Store(1)
	runtime.ready = true
	runtime.command = &exec.Cmd{}
	finished := make(chan struct{})
	go func() {
		defer close(finished)
		runtime.readEvents(oldReader, 1)
	}()
	runtime.sidecarGen.Store(2)
	runtime.stdin = nopWriteCloser{Writer: io.Discard}
	runtime.ready = true
	runtime.command = &exec.Cmd{}
	_ = oldWriter.Close()
	select {
	case <-finished:
	case <-time.After(2 * time.Second):
		t.Fatal("old reader did not exit")
	}
	if runtime.stdin == nil || !runtime.ready || runtime.command == nil {
		t.Fatal("a replaced sidecar must keep its stdin after the previous reader exits")
	}
}

func TestWriteMarksClosedPipeAsSidecarDown(t *testing.T) {
	reader, writer := io.Pipe()
	_ = reader.Close()
	runtime := NewRuntime(RuntimeOptions{})
	runtime.ready = true
	runtime.stdin = writer
	err := runtime.write(map[string]any{"action": "abort"})
	if err == nil || !strings.Contains(err.Error(), "sidecar is not running") {
		t.Fatalf("closed pipe: %v", err)
	}
	if runtime.stdin != nil || runtime.ready {
		t.Fatal("lost write must drop the dead stdin so Ensure can start a new sidecar")
	}
}

type nopWriteCloser struct {
	io.Writer
}

func (nopWriteCloser) Close() error { return nil }

func statusOf(runtime *Runtime, id string) string {
	for _, session := range runtime.BoardSnapshot().Sessions {
		if session.ID == id {
			return session.Status
		}
	}
	return ""
}
