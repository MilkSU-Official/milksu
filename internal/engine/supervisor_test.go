package engine

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/MilkSU-Official/milksu/internal/config"
)

func TestNormalizeAssistantDelta(t *testing.T) {
	event := normalizeBridgeEvent(bridgeEvent{Type: "text_delta", ID: "session-1", Delta: "hello"})
	if event.Type != "assistant.delta" || event.Text != "hello" || event.SessionID != "session-1" {
		t.Fatalf("unexpected event: %#v", event)
	}
}

func TestNormalizeToolError(t *testing.T) {
	event := normalizeBridgeEvent(bridgeEvent{
		Type: "tool_call_end", ID: "session-1", ToolName: "read", Content: "denied", IsError: true,
	})
	if event.Type != "tool.completed" || event.Error != "denied" || !event.Done {
		t.Fatalf("unexpected event: %#v", event)
	}
}

func TestNormalizeAssistantToolSegmentDoesNotCompleteTurn(t *testing.T) {
	event := normalizeBridgeEvent(bridgeEvent{
		Type: "message_segment_done", ID: "session-1", Content: "先运行验收。",
	})
	if event.Type != "assistant.segment_completed" ||
		event.Text != "先运行验收。" ||
		!event.Done {
		t.Fatalf("unexpected event: %#v", event)
	}
}

func TestWriteCommandUsesOneJSONLine(t *testing.T) {
	var buffer bytes.Buffer
	if err := writeCommand(&buffer, map[string]string{"action": "probe"}); err != nil {
		t.Fatal(err)
	}
	lines := bytes.Split(bytes.TrimSpace(buffer.Bytes()), []byte{'\n'})
	if len(lines) != 1 || !json.Valid(lines[0]) {
		t.Fatalf("expected one JSON line, got %q", buffer.String())
	}
}

func TestSafeBaseEnvironmentDropsUnrelatedSecrets(t *testing.T) {
	filtered := safeBaseEnvironment([]string{
		"PATH=/bin",
		"HOME=/tmp/home",
		"GITHUB_TOKEN=secret",
		"NODE_OPTIONS=--require=/tmp/inject.js",
	})
	if len(filtered) != 2 {
		t.Fatalf("unexpected filtered environment: %#v", filtered)
	}
	for _, entry := range filtered {
		if entry == "GITHUB_TOKEN=secret" || entry == "NODE_OPTIONS=--require=/tmp/inject.js" {
			t.Fatalf("unsafe environment entry survived: %q", entry)
		}
	}
}

func TestValidateModelAccessRejectsMissingProviderKey(t *testing.T) {
	t.Setenv("DEEPSEEK_API_KEY", "")
	settings := config.DefaultSettings()

	err := validateModelAccess(settings)
	if err == nil || !strings.Contains(err.Error(), "Settings > API Keys") {
		t.Fatalf("expected actionable missing-key error, got %v", err)
	}
}

func TestSendMessageRejectsMissingKeyBeforeStartingSidecar(t *testing.T) {
	t.Setenv("DEEPSEEK_API_KEY", "")
	supervisor := NewSupervisor(nil)
	defer supervisor.Close()

	err := supervisor.SendMessage("session-1", "hello", "", "", config.DefaultSettings())
	if err == nil || !strings.Contains(err.Error(), "Settings > API Keys") {
		t.Fatalf("expected actionable missing-key error, got %v", err)
	}
	status := supervisor.Status()
	if status.Running || status.SessionCount != 0 {
		t.Fatalf("missing credentials must not start a sidecar or session: %#v", status)
	}
}

func TestResolveAgentWorkspaceUsesExplicitDirectory(t *testing.T) {
	directory := t.TempDir()
	resolved, err := resolveAgentWorkspace(directory)
	if err != nil {
		t.Fatal(err)
	}
	expected, err := filepath.EvalSymlinks(directory)
	if err != nil {
		t.Fatal(err)
	}
	if resolved != expected {
		t.Fatalf("expected %q, got %q", expected, resolved)
	}
}

func TestResolveAgentWorkspaceRejectsFiles(t *testing.T) {
	path := filepath.Join(t.TempDir(), "not-a-directory.txt")
	if err := os.WriteFile(path, []byte("fixture"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := resolveAgentWorkspace(path); err == nil {
		t.Fatal("expected a file workspace to be rejected")
	}
}

func TestCodingSidecarAllowsOnlyTheRequiredSystemShells(t *testing.T) {
	directory := t.TempDir()
	node := filepath.Join(directory, "node")
	bridge := filepath.Join(directory, "chat-bridge.cjs")
	if err := os.WriteFile(node, []byte("runtime"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(bridge, []byte("bridge"), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("MILKSU_SIDECAR_DIR", directory)

	command, err := newSidecarCommandAt("chat-bridge.cjs", "bridge.js", t.TempDir(), true)
	if err != nil {
		t.Fatal(err)
	}
	arguments := strings.Join(command.Args, "\n")
	for _, expected := range []string{
		"--allow-child-process",
		"--allow-fs-read=/bin/bash",
		"--allow-fs-read=/bin/sh",
		"--allow-fs-read=/usr/bin/env",
		"--allow-fs-read=/usr/bin/sandbox-exec",
	} {
		if !strings.Contains(arguments, expected) {
			t.Fatalf("coding Sidecar is missing %q: %s", expected, arguments)
		}
	}
}

func TestWorkspaceTemporaryDirectoryStaysInsideAgentWorkspace(t *testing.T) {
	workspace := t.TempDir()
	environment, err := withWorkspaceTemporaryDirectory(
		[]string{"PATH=/bin", "TMPDIR=/private/tmp"},
		workspace,
	)
	if err != nil {
		t.Fatal(err)
	}
	expected := "TMPDIR=" + filepath.Join(workspace, ".milksu", "tmp")
	if !containsEnvironmentEntry(environment, expected) {
		t.Fatalf("expected %q in %#v", expected, environment)
	}
	if containsEnvironmentEntry(environment, "TMPDIR=/private/tmp") {
		t.Fatalf("host temporary directory survived: %#v", environment)
	}
}

func TestSidecarRuntimePathPrecedesHostPath(t *testing.T) {
	node := filepath.Join(t.TempDir(), "node")
	environment := withSidecarRuntimePath(
		[]string{"PATH=/usr/bin:/bin", "LANG=en_US.UTF-8"},
		node,
	)
	expected := "PATH=" + filepath.Dir(node) + string(os.PathListSeparator) + "/usr/bin:/bin"
	if !containsEnvironmentEntry(environment, expected) {
		t.Fatalf("expected %q in %#v", expected, environment)
	}
	if !containsEnvironmentEntry(environment, "LANG=en_US.UTF-8") {
		t.Fatalf("unrelated environment was lost: %#v", environment)
	}
}

func containsEnvironmentEntry(environment []string, expected string) bool {
	for _, entry := range environment {
		if entry == expected {
			return true
		}
	}
	return false
}

func TestValidateModelAccessAcceptsEnabledProviderKey(t *testing.T) {
	settings := config.DefaultSettings()
	settings.Providers["deepseek"] = config.ProviderConfig{
		APIKey:  "provider-secret",
		Enabled: true,
	}

	if err := validateModelAccess(settings); err != nil {
		t.Fatalf("expected configured provider to pass validation, got %v", err)
	}
}

func TestEngineEnvironmentIncludesEditableProviderBaseURL(t *testing.T) {
	baseURL := "https://gateway.example.test/v1"
	settings := config.DefaultSettings()
	settings.Providers["deepseek"] = config.ProviderConfig{
		APIKey:  "provider-secret",
		BaseURL: &baseURL,
		Enabled: true,
	}

	environment := engineEnvironment(settings)
	for _, expected := range []string{
		"DEEPSEEK_API_KEY=provider-secret",
		"DEEPSEEK_BASE_URL=https://gateway.example.test/v1",
	} {
		if !containsEnvironmentEntry(environment, expected) {
			t.Fatalf("expected %q in %#v", expected, environment)
		}
	}
}

func TestDeliverProbeEventRoutesSessionAndProcessFailures(t *testing.T) {
	supervisor := NewSupervisor(nil)
	first := make(chan Event, 2)
	second := make(chan Event, 2)
	supervisor.probeWaiters["first"] = first
	supervisor.probeWaiters["second"] = second

	supervisor.deliverProbeEvent(Event{SessionID: "first", Type: "assistant.completed"})
	if event := <-first; event.Type != "assistant.completed" {
		t.Fatalf("unexpected session event: %#v", event)
	}
	select {
	case event := <-second:
		t.Fatalf("session event leaked to another probe: %#v", event)
	default:
	}

	supervisor.deliverProbeEvent(Event{Type: "engine.stopped", Error: "sidecar exited"})
	for name, waiter := range map[string]chan Event{"first": first, "second": second} {
		if event := <-waiter; event.Type != "engine.stopped" {
			t.Fatalf("%s probe missed process failure: %#v", name, event)
		}
	}
}

func TestEmitEventDoesNotDeadlockWhileProcessLockIsHeld(t *testing.T) {
	supervisor := NewSupervisor(nil)
	done := make(chan struct{})
	go func() {
		supervisor.mu.Lock()
		supervisor.emitEvent(Event{Type: "engine.started"})
		supervisor.mu.Unlock()
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("emitting an engine event deadlocked on the process lock")
	}
}

func TestTurnActivityTimeoutEmitsRecoverableFailure(t *testing.T) {
	events := make(chan Event, 2)
	supervisor := NewSupervisor(func(event Event) {
		events <- event
	})
	defer supervisor.Close()
	supervisor.turnTimeout = 20 * time.Millisecond
	supervisor.mu.Lock()
	supervisor.sessions["session-stalled"] = struct{}{}
	supervisor.armTurnTimerLocked("session-stalled")
	supervisor.mu.Unlock()

	select {
	case event := <-events:
		if event.Type != "engine.error" ||
			event.SessionID != "session-stalled" ||
			!strings.Contains(event.Error, "persisted workspace") {
			t.Fatalf("unexpected turn timeout event: %#v", event)
		}
	case <-time.After(time.Second):
		t.Fatal("stalled turn did not time out")
	}
}

func TestTurnActivityEventResetsThenCompletionStopsTimeout(t *testing.T) {
	events := make(chan Event, 2)
	supervisor := NewSupervisor(func(event Event) {
		events <- event
	})
	defer supervisor.Close()
	supervisor.turnTimeout = 40 * time.Millisecond
	supervisor.mu.Lock()
	supervisor.sessions["session-active"] = struct{}{}
	supervisor.armTurnTimerLocked("session-active")
	supervisor.mu.Unlock()
	time.Sleep(25 * time.Millisecond)
	supervisor.observeTurnEvent(Event{
		SessionID: "session-active",
		Type:      "tool.completed",
	})
	time.Sleep(25 * time.Millisecond)
	supervisor.observeTurnEvent(Event{
		SessionID: "session-active",
		Type:      "assistant.completed",
	})
	time.Sleep(50 * time.Millisecond)
	select {
	case event := <-events:
		t.Fatalf("completed turn emitted a timeout: %#v", event)
	default:
	}
}

func TestProbeFailureMessageKeepsOnlyBoundedFirstLine(t *testing.T) {
	message := probeFailureMessage(Event{
		Type:  "engine.error",
		Error: "Error: No API key for deepseek/model\nat internal stack",
	})
	if message != "No API key for deepseek/model" {
		t.Fatalf("unexpected probe failure message: %q", message)
	}
}

func TestValidateModelAccessRejectsEnabledRelayWithoutKey(t *testing.T) {
	settings := config.DefaultSettings()
	settings.Relay = &config.RelayConfig{Enabled: true}

	err := validateModelAccess(settings)
	if err == nil || !strings.Contains(err.Error(), "Relay is enabled but has no API key") {
		t.Fatalf("expected missing relay-key error, got %v", err)
	}
}

func TestResolveSidecarRuntimeUsesCompletePackagedOverride(t *testing.T) {
	directory := t.TempDir()
	node := filepath.Join(directory, "node")
	bridge := filepath.Join(directory, "security-bridge.cjs")
	if err := os.WriteFile(node, []byte("runtime"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(bridge, []byte("bridge"), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("MILKSU_SIDECAR_DIR", directory)

	runtime, err := resolveSidecarRuntime("security-bridge.cjs", "security-bridge.js")
	if err != nil {
		t.Fatal(err)
	}
	if !runtime.packaged || runtime.node != node || runtime.bridge != bridge {
		t.Fatalf("unexpected packaged runtime: %#v", runtime)
	}
}

func TestResolveSidecarRuntimeRejectsIncompleteOverride(t *testing.T) {
	t.Setenv("MILKSU_SIDECAR_DIR", t.TempDir())
	if _, err := resolveSidecarRuntime("security-bridge.cjs", "security-bridge.js"); err == nil {
		t.Fatal("expected an incomplete packaged runtime to be rejected")
	}
}
