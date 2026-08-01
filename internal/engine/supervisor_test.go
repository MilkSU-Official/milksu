package engine

import (
	"bufio"
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

func TestNormalizeReadyPreservesResumeEvidence(t *testing.T) {
	event := normalizeBridgeEvent(bridgeEvent{
		Type:           "ready",
		ID:             "session-1",
		Tools:          []string{"read", "grep"},
		ExecutionMode:  "plan",
		ApprovalPolicy: "read-only",
		Resumed:        true,
	})
	if event.Type != "session.ready" ||
		!event.Resumed ||
		event.ExecutionMode != "plan" ||
		event.ApprovalPolicy != "read-only" ||
		len(event.Tools) != 2 {
		t.Fatalf("unexpected ready event: %#v", event)
	}
}

func TestNormalizePolicyStatus(t *testing.T) {
	event := normalizeBridgeEvent(bridgeEvent{
		Type:           "policy_updated",
		ID:             "session-1",
		Tools:          []string{"read", "edit"},
		ExecutionMode:  "go",
		ApprovalPolicy: "workspace-auto",
		Capabilities: []CodingCapabilityStatus{{
			ID: "workspace-write", Label: "工作区写入", Status: "allowed",
		}},
	})
	if event.Type != "session.policy_updated" ||
		event.ExecutionMode != "go" ||
		event.ApprovalPolicy != "workspace-auto" ||
		len(event.Capabilities) != 1 {
		t.Fatalf("unexpected policy event: %#v", event)
	}
}

func TestNormalizeGoalStateAndAutomaticTurnStart(t *testing.T) {
	budget := int64(100000)
	goal := &CodingGoalState{
		ID:          "goal-1",
		Text:        "完成并验证交付",
		Status:      "active",
		TokenBudget: &budget,
		TokensUsed:  12000,
	}
	updated := normalizeBridgeEvent(bridgeEvent{
		Type: "goal_state",
		ID:   "session-1",
		Goal: goal,
	})
	if updated.Type != "session.goal_updated" ||
		updated.Goal == nil ||
		updated.Goal.ID != "goal-1" ||
		updated.Goal.TokenBudget == nil ||
		*updated.Goal.TokenBudget != 100000 {
		t.Fatalf("unexpected goal event: %#v", updated)
	}

	started := normalizeBridgeEvent(bridgeEvent{
		Type: "turn_started",
		ID:   "session-1",
	})
	if started.Type != "assistant.started" {
		t.Fatalf("unexpected automatic turn event: %#v", started)
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

func TestNormalizeAndCacheBackgroundTasks(t *testing.T) {
	exitCode := 0
	event := normalizeBridgeEvent(bridgeEvent{
		Type: "background_tasks",
		ID:   "session-1",
		Tasks: []BackgroundTask{{
			ID:           "bg-1",
			Name:         "Vite",
			Kind:         "process",
			Status:       "running",
			StartedAt:    1000,
			Command:      "npm run dev",
			Cwd:          "/workspace",
			PID:          4321,
			LastExitCode: &exitCode,
		}},
	})
	if event.Type != "runtime.background_tasks" ||
		len(event.BackgroundTasks) != 1 ||
		event.BackgroundTasks[0].PID != 4321 {
		t.Fatalf("unexpected background task event: %#v", event)
	}

	supervisor := NewSupervisor(nil)
	supervisor.observeRuntimeEvent(event)
	status := supervisor.Status()
	if len(status.BackgroundTasks) != 1 ||
		status.BackgroundTasks[0].Command != "npm run dev" {
		t.Fatalf("background tasks were not cached: %#v", status)
	}
	status.BackgroundTasks[0].Command = "mutated"
	if supervisor.Status().BackgroundTasks[0].Command != "npm run dev" {
		t.Fatal("runtime status leaked its internal background task slice")
	}
}

func TestStopBackgroundTaskWaitsForSidecarReceipt(t *testing.T) {
	reader, writer, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	defer reader.Close()
	defer writer.Close()

	supervisor := NewSupervisor(nil)
	supervisor.process = &childProcess{
		stdin:     writer,
		workspace: "/workspace",
	}
	supervisor.sessions["session-1"] = struct{}{}
	type stopResult struct {
		status RuntimeStatus
		err    error
	}
	result := make(chan stopResult, 1)
	go func() {
		status, stopErr := supervisor.StopBackgroundTask("session-1", "bg_task_1")
		result <- stopResult{status: status, err: stopErr}
	}()

	line, err := bufio.NewReader(reader).ReadBytes('\n')
	if err != nil {
		t.Fatal(err)
	}
	var command map[string]any
	if err := json.Unmarshal(line, &command); err != nil {
		t.Fatal(err)
	}
	requestID, _ := command["requestId"].(string)
	if command["action"] != "background_task_control" ||
		command["control"] != "stop" ||
		command["taskId"] != "bg_task_1" ||
		requestID == "" {
		t.Fatalf("unexpected background control command: %#v", command)
	}

	event := normalizeBridgeEvent(bridgeEvent{
		Type:      "background_task_controlled",
		ID:        "session-1",
		RequestID: requestID,
		Tasks: []BackgroundTask{{
			ID:        "bg_task_1",
			Kind:      "process",
			Status:    "cancelled",
			StartedAt: 1000,
			EndedAt:   2000,
		}},
	})
	supervisor.observeRuntimeEvent(event)
	supervisor.emitEvent(event)

	select {
	case stopped := <-result:
		if stopped.err != nil {
			t.Fatal(stopped.err)
		}
		if len(stopped.status.BackgroundTasks) != 1 ||
			stopped.status.BackgroundTasks[0].Status != "cancelled" {
			t.Fatalf("unexpected stopped runtime status: %#v", stopped.status)
		}
	case <-time.After(time.Second):
		t.Fatal("background task stop receipt was not delivered")
	}

	supervisor.mu.Lock()
	supervisor.process = nil
	supervisor.mu.Unlock()
}

func TestNormalizeApprovalLifecycle(t *testing.T) {
	requested := normalizeBridgeEvent(bridgeEvent{
		Type:      "approval_requested",
		ID:        "session-1",
		RequestID: "approval-1",
		ToolName:  "bash",
		Content:   "$ npm test",
		Input:     `{"command":"npm test"}`,
	})
	if requested.Type != "approval.requested" ||
		requested.RequestID != "approval-1" ||
		requested.Input == "" ||
		requested.Done {
		t.Fatalf("unexpected approval request: %#v", requested)
	}
	approved := true
	resolved := normalizeBridgeEvent(bridgeEvent{
		Type:      "approval_resolved",
		ID:        "session-1",
		RequestID: "approval-1",
		ToolName:  "bash",
		Approved:  &approved,
		Reason:    "approved by user",
	})
	if resolved.Type != "approval.resolved" ||
		resolved.Approved == nil ||
		!*resolved.Approved ||
		!resolved.Done {
		t.Fatalf("unexpected approval resolution: %#v", resolved)
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

func TestNormalizeToolCompletionPreservesCallIdentityAndDuration(t *testing.T) {
	event := normalizeBridgeEvent(bridgeEvent{
		Type:       "tool_call_end",
		ID:         "session-1",
		ToolName:   "bash",
		ToolCallID: "call-42",
		DurationMS: 1250,
		Content:    "ok",
	})
	if event.Type != "tool.completed" ||
		event.ToolCallID != "call-42" ||
		event.DurationMS != 1250 ||
		!event.Done {
		t.Fatalf("unexpected event: %#v", event)
	}
}

func TestNormalizeTurnSettledCompletesVisibleRunWithoutInventingMessage(t *testing.T) {
	event := normalizeBridgeEvent(bridgeEvent{
		Type: "turn_settled", ID: "session-1",
	})
	if event.Type != "assistant.settled" ||
		event.Text != "" ||
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

	err := supervisor.SendMessage(
		"session-1", "hello", "", "", "", "", nil, "", nil, config.DefaultSettings(),
	)
	if err == nil || !strings.Contains(err.Error(), "Settings > API Keys") {
		t.Fatalf("expected actionable missing-key error, got %v", err)
	}
	status := supervisor.Status()
	if status.Running || status.SessionCount != 0 {
		t.Fatalf("missing credentials must not start a sidecar or session: %#v", status)
	}
}

func TestNormalizeCodingPolicyPreservesLegacyGoAndValidatesExplicitModes(t *testing.T) {
	legacy, err := normalizeCodingPolicy("", "", "")
	if err != nil {
		t.Fatal(err)
	}
	if legacy.ExecutionMode != "go" || legacy.ApprovalPolicy != "workspace-auto" {
		t.Fatalf("unexpected legacy policy: %#v", legacy)
	}
	plan, err := normalizeCodingPolicy("plan", "read-only", "")
	if err != nil {
		t.Fatal(err)
	}
	if plan.ExecutionMode != "plan" || plan.ApprovalPolicy != "read-only" {
		t.Fatalf("unexpected explicit policy: %#v", plan)
	}
	if _, err := normalizeCodingPolicy("execute", "workspace-auto", ""); err == nil {
		t.Fatal("expected unknown execution mode to be rejected")
	}
	full, err := normalizeCodingPolicy("go", "full-auto", "")
	if err != nil || full.ApprovalPolicy != "full-auto" {
		t.Fatalf("expected Full Access policy, got %#v, %v", full, err)
	}
	if _, err := normalizeCodingPolicy("go", "always", ""); err == nil {
		t.Fatal("expected unknown approval policy to be rejected")
	}
	ctfPolicy, err := normalizeCodingPolicy("unknown", "unknown", "solver")
	if err != nil || ctfPolicy != (CodingPolicy{}) {
		t.Fatalf("CTF session must ignore Coding policy fields: %#v, %v", ctfPolicy, err)
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

func TestWorkspaceTemporaryDirectoryStaysOutsideAgentWorkspace(t *testing.T) {
	workspace := t.TempDir()
	runtimeHome := t.TempDir()
	runtimeDirectory, err := workspaceRuntimeDirectory(runtimeHome, workspace)
	if err != nil {
		t.Fatal(err)
	}
	if strings.HasPrefix(runtimeDirectory, workspace+string(filepath.Separator)) {
		t.Fatalf("runtime directory polluted the workspace: %s", runtimeDirectory)
	}
	if !strings.HasPrefix(runtimeDirectory, runtimeHome+string(filepath.Separator)) {
		t.Fatalf("runtime directory escaped the app runtime home: %s", runtimeDirectory)
	}
	again, err := workspaceRuntimeDirectory(runtimeHome, workspace)
	if err != nil {
		t.Fatal(err)
	}
	if again != runtimeDirectory {
		t.Fatalf("workspace runtime directory is not stable: %q != %q", again, runtimeDirectory)
	}
}

func TestWorkspaceRuntimeSeparatesBackgroundRegistryFromChildTemporaryDirectory(t *testing.T) {
	t.Setenv("XDG_DATA_HOME", t.TempDir())
	workspace := t.TempDir()
	environment, err := withWorkspaceTemporaryDirectory(
		[]string{
			"TMPDIR=/untrusted/tmp",
			"MILKSU_WORKSPACE_RUNTIME=/untrusted/runtime",
			"MILKSU_BACKGROUND_TASKS_DIR=/untrusted/tasks",
			"MILKSU_AGENT_WORKSPACE=/untrusted/workspace",
		},
		workspace,
	)
	if err != nil {
		t.Fatal(err)
	}

	var temporaryDirectory string
	var runtimeDirectory string
	var backgroundTasksDirectory string
	var agentWorkspace string
	for _, entry := range environment {
		switch {
		case strings.HasPrefix(entry, "TMPDIR="):
			temporaryDirectory = strings.TrimPrefix(entry, "TMPDIR=")
		case strings.HasPrefix(entry, "MILKSU_WORKSPACE_RUNTIME="):
			runtimeDirectory = strings.TrimPrefix(entry, "MILKSU_WORKSPACE_RUNTIME=")
		case strings.HasPrefix(entry, "MILKSU_BACKGROUND_TASKS_DIR="):
			backgroundTasksDirectory = strings.TrimPrefix(
				entry,
				"MILKSU_BACKGROUND_TASKS_DIR=",
			)
		case strings.HasPrefix(entry, "MILKSU_AGENT_WORKSPACE="):
			agentWorkspace = strings.TrimPrefix(entry, "MILKSU_AGENT_WORKSPACE=")
		}
	}
	if runtimeDirectory == "" || temporaryDirectory == "" ||
		backgroundTasksDirectory == "" || agentWorkspace == "" {
		t.Fatalf("workspace runtime environment is incomplete: %#v", environment)
	}
	if agentWorkspace != workspace {
		t.Fatalf("unexpected reviewed workspace: %s", agentWorkspace)
	}
	if temporaryDirectory != filepath.Join(runtimeDirectory, "tmp") {
		t.Fatalf("unexpected child temporary directory: %s", temporaryDirectory)
	}
	if backgroundTasksDirectory != filepath.Join(runtimeDirectory, "background-tasks") {
		t.Fatalf("unexpected background registry: %s", backgroundTasksDirectory)
	}
	if backgroundTasksDirectory == temporaryDirectory {
		t.Fatal("background registry must not share the child-writable temporary directory")
	}
	if _, err := os.Stat(backgroundTasksDirectory); err != nil {
		t.Fatalf("background registry was not created: %v", err)
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

func TestSidecarEnvironmentIncludesConfiguredVisionRoute(t *testing.T) {
	t.Setenv("XDG_DATA_HOME", t.TempDir())
	settings := config.DefaultSettings()
	settings.ModelRouting.Vision = &config.ModelSelection{
		Provider: "openai",
		Model:    "gpt-4o",
	}
	environment, err := sidecarEnvironment(settings)
	if err != nil {
		t.Fatal(err)
	}
	for _, expected := range []string{
		"MILKSU_VISION_PROVIDER=openai",
		"MILKSU_VISION_MODEL=gpt-4o",
	} {
		if !containsEnvironmentEntry(environment, expected) {
			t.Fatalf("expected %q in %#v", expected, environment)
		}
	}
	foundCache := false
	for _, entry := range environment {
		if strings.HasPrefix(entry, "MILKSU_VISION_CACHE=") {
			foundCache = true
			break
		}
	}
	if !foundCache {
		t.Fatalf("vision cache path missing from %#v", environment)
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

func TestTurnActivityEventResetsThenSettledStopsTimeout(t *testing.T) {
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
		Type:      "assistant.settled",
	})
	time.Sleep(50 * time.Millisecond)
	select {
	case event := <-events:
		t.Fatalf("completed turn emitted a timeout: %#v", event)
	default:
	}
}

func TestPendingApprovalPausesTurnTimeoutUntilResolved(t *testing.T) {
	events := make(chan Event, 2)
	supervisor := NewSupervisor(func(event Event) {
		events <- event
	})
	defer supervisor.Close()
	supervisor.turnTimeout = 30 * time.Millisecond
	supervisor.mu.Lock()
	supervisor.sessions["session-approval"] = struct{}{}
	supervisor.armTurnTimerLocked("session-approval")
	supervisor.mu.Unlock()

	supervisor.observeTurnEvent(Event{
		SessionID: "session-approval",
		Type:      "approval.requested",
	})
	time.Sleep(60 * time.Millisecond)
	select {
	case event := <-events:
		t.Fatalf("pending user approval timed out: %#v", event)
	default:
	}

	supervisor.observeTurnEvent(Event{
		SessionID: "session-approval",
		Type:      "approval.resolved",
	})
	select {
	case event := <-events:
		if event.Type != "engine.error" ||
			event.SessionID != "session-approval" {
			t.Fatalf("unexpected resumed timeout event: %#v", event)
		}
	case <-time.After(time.Second):
		t.Fatal("resolved approval did not resume the turn timeout")
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

func TestResolveSidecarRuntimeUsesExplicitCompleteDirectory(t *testing.T) {
	directory := t.TempDir()
	node := filepath.Join(directory, "node")
	bridge := filepath.Join(directory, "chat-bridge.cjs")
	if err := os.WriteFile(node, []byte("runtime"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(bridge, []byte("bridge"), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("MILKSU_SIDECAR_DIR", t.TempDir())

	runtime, err := resolveSidecarRuntimeWithDirectory(
		"chat-bridge.cjs",
		"bridge.js",
		directory,
	)
	if err != nil {
		t.Fatal(err)
	}
	if !runtime.packaged || runtime.node != node || runtime.bridge != bridge {
		t.Fatalf("unexpected explicit packaged runtime: %#v", runtime)
	}
}

func TestResolveSidecarRuntimeRejectsIncompleteExplicitDirectory(t *testing.T) {
	directory := t.TempDir()
	if err := os.WriteFile(
		filepath.Join(directory, "chat-bridge.cjs"),
		[]byte("bridge"),
		0o600,
	); err != nil {
		t.Fatal(err)
	}
	if _, err := resolveSidecarRuntimeWithDirectory(
		"chat-bridge.cjs",
		"bridge.js",
		directory,
	); err == nil || !strings.Contains(err.Error(), "complete runtime") {
		t.Fatalf("expected an incomplete explicit runtime to be rejected, got %v", err)
	}
}

func TestSupervisorStoresTrimmedExplicitSidecarDirectory(t *testing.T) {
	supervisor := NewSupervisorWithSidecarDirectory(nil, "  /tmp/milksu-sidecar  ")
	if supervisor.sidecarDirectory != "/tmp/milksu-sidecar" {
		t.Fatalf("unexpected Sidecar directory: %q", supervisor.sidecarDirectory)
	}
}
