package companion

import (
	"bufio"
	"encoding/json"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/MilkSU-Official/milksu/internal/config"
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

func TestStopHoldingWithdrawnCredentialStopsInFlight(t *testing.T) {
	var events []engine.Event
	runtime := NewRuntime(RuntimeOptions{Emit: func(event engine.Event) {
		events = append(events, event)
	}})
	runtime.ready = true
	runtime.inFlight.Store(true)
	runtime.command = &exec.Cmd{}
	if !runtime.StopHoldingWithdrawnCredential() {
		t.Fatal("an in-flight companion sidecar must be stopped when its credential is withdrawn")
	}
	if runtime.ready || runtime.inFlight.Load() || runtime.command != nil {
		t.Fatal("withdrawn credential must not leave the companion sidecar running")
	}
	if runtime.Status().Error != CredentialWithdrawnError {
		t.Fatalf("error = %q", runtime.Status().Error)
	}
	if len(events) != 1 || events[0].Error != CredentialWithdrawnError || events[0].Type != "engine.error" {
		t.Fatalf("events = %#v", events)
	}
}

func TestSendRejectsPersonalSourceWithoutItsOwnKey(t *testing.T) {
	relayURL := "https://tokenflux.dev/v1"
	settings := config.DefaultSettings()
	settings.CompanionSource = "personal"
	settings.CompanionProvider = ""
	settings.CompanionModel = "deepseek-chat"
	settings.ActiveProvider = "tokenflux"
	settings.Relay = &config.RelayConfig{Enabled: true, Key: "account-secret", URL: relayURL}
	started := false
	runtime := NewRuntime(RuntimeOptions{
		Settings: func() config.AppSettings { return settings },
		Start: func(config.AppSettings, string, string) (*exec.Cmd, io.WriteCloser, io.ReadCloser, error) {
			started = true
			return nil, nil, nil, errors.New("should not start")
		},
	})
	err := runtime.Send("hello", nil)
	if err == nil || !errors.Is(err, engine.ErrCompanionCredentialMissing) {
		t.Fatalf("send err = %v", err)
	}
	if started {
		t.Fatal("a personal companion with no key must not start a sidecar")
	}
}

type nopWriteCloser struct {
	io.Writer
}

func (nopWriteCloser) Close() error { return nil }

func TestPersistDoesNotWriteBackAMemoryForgottenDuringSnapshot(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "companion-state.json")
	runtime := NewRuntime(RuntimeOptions{StatePath: path})
	if _, err := runtime.handleHost("memory", map[string]any{
		"action":   "commit",
		"userText": "以后都用中文回复我",
		"items": []any{map[string]any{
			"action":   "create",
			"title":    "回复语言",
			"markdown": "回复保持简体中文",
			"evidence": "以后都用中文回复我",
		}},
	}); err != nil {
		t.Fatal(err)
	}
	approved := runtime.MemorySnapshot().Approved
	if len(approved) != 1 {
		t.Fatalf("approved: %#v", approved)
	}
	id := approved[0].ID
	runtime.persistHook = func() {
		if _, err := runtime.memory.Forget(id); err != nil {
			t.Errorf("forget: %v", err)
		}
	}
	if _, err := runtime.handleHost("memory", map[string]any{
		"action":   "commit",
		"userText": "叫我 Milk",
		"items": []any{map[string]any{
			"action":   "create",
			"title":    "称呼",
			"markdown": "称呼用户 Milk",
			"evidence": "叫我 Milk",
		}},
	}); err != nil {
		t.Fatal(err)
	}
	reloaded := NewRuntime(RuntimeOptions{StatePath: path})
	for _, row := range reloaded.MemorySnapshot().Approved {
		if row.ID == id {
			t.Fatal("stale snapshot wrote a forgotten memory back")
		}
	}
	if !reloaded.memory.Forgotten(id) {
		t.Fatal("forgotten id was dropped from the state file")
	}
	kept := false
	for _, row := range reloaded.MemorySnapshot().Approved {
		if row.Markdown == "称呼用户 Milk" {
			kept = true
		}
	}
	if !kept {
		t.Fatal("the commit that raced the forget should stay stored")
	}
}

func TestNoteExternalTurnWritesTheSharedExtract(t *testing.T) {
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
	runtime := NewRuntime(RuntimeOptions{})
	runtime.NoteExternalTurn("begin", "以后都用中文", "", false)
	runtime.ready = true
	runtime.stdin = writer
	runtime.command = &exec.Cmd{}
	runtime.NoteExternalTurn("begin", "", "", false)
	runtime.NoteExternalTurn("finish", "以后都用中文回复我", "好", false)
	_ = writer.Close()
	<-done
	mu.Lock()
	defer mu.Unlock()
	if len(writes) != 3 {
		t.Fatalf("writes = %#v", writes)
	}
	if writes[0]["action"] != "note_turn" || writes[0]["phase"] != "begin" {
		t.Fatalf("begin = %#v", writes[0])
	}
	if writes[1]["action"] != "refresh_index" {
		t.Fatalf("refresh = %#v", writes[1])
	}
	if writes[2]["action"] != "note_turn" || writes[2]["userText"] != "以后都用中文回复我" {
		t.Fatalf("finish = %#v", writes[2])
	}
}

func TestNoteExternalTurnStaysQuietWhenExtractIsOff(t *testing.T) {
	runtime := NewRuntime(RuntimeOptions{
		Settings: func() config.AppSettings {
			settings := config.DefaultSettings()
			settings.CompanionMemoryExtract = "off"
			enabled := false
			settings.CompanionMemoryEnabled = &enabled
			return settings
		},
	})
	runtime.start = func(config.AppSettings, string, string) (*exec.Cmd, io.WriteCloser, io.ReadCloser, error) {
		t.Fatal("extract off must not start a sidecar")
		return nil, nil, nil, errors.New("started")
	}
	runtime.NoteExternalTurn("finish", "以后都用中文回复我", "", false)
}

func TestConfirmedSteerArmsTheWatch(t *testing.T) {
	runtime := &Runtime{}
	runtime.dispatcher = NewDispatcher(&fakeCatalog{refs: map[string]ConversationRef{
		"c1": {ID: "c1", Title: "登录"},
	}}, &fakeSpeaker{produced: true}, NewBoard(), func() bool { return true })
	runtime.parkConfirm("req-1", map[string]any{
		"action":         "speak",
		"conversationId": "c1",
		"text":           "继续",
		"idempotencyKey": "k1",
		"mode":           "steer",
	}, "登录")
	result, err := runtime.ConfirmDispatch("steer", "c1", "继续", "k1", "steer", "req-1", true)
	if err != nil || !result.Delivered {
		t.Fatalf("confirm: %v %#v", err, result)
	}
	if _, ok := runtime.watchSnapshot()["c1"]; !ok {
		t.Fatal("confirmed steer should arm the watch")
	}
}

func TestMapCompanionIntentRecordedReachesThePhone(t *testing.T) {
	event := mapCompanionEvent(map[string]any{
		"type":   "decision.recorded",
		"text":   "决策：闲聊。由Jev判定。",
		"bucket": "chat",
		"source": "jev",
	})
	if event.Type != "decision.recorded" {
		t.Fatalf("type %q", event.Type)
	}
	if event.Text == "" || event.Bucket != "chat" || event.Source != "jev" {
		t.Fatalf("text %q bucket %q source %q", event.Text, event.Bucket, event.Source)
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
