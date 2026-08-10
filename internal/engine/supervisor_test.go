package engine

import (
	"bufio"
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"fmt"
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

func TestNormalizePerTurnPolicyStatus(t *testing.T) {
	applied := normalizeBridgeEvent(bridgeEvent{
		Type:   "turn_policy",
		ID:     "session-1",
		Tools:  []string{},
		Reason: "explicit_no_tools",
	})
	if applied.Type != "session.turn_policy" ||
		applied.Reason != "explicit_no_tools" ||
		len(applied.Tools) != 0 {
		t.Fatalf("unexpected turn policy event: %#v", applied)
	}

	cleared := normalizeBridgeEvent(bridgeEvent{
		Type:  "turn_policy_cleared",
		ID:    "session-1",
		Tools: []string{"read", "grep"},
	})
	if cleared.Type != "session.turn_policy_cleared" ||
		len(cleared.Tools) != 2 {
		t.Fatalf("unexpected cleared turn policy event: %#v", cleared)
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

func TestNormalizeSteeringQueue(t *testing.T) {
	event := normalizeBridgeEvent(bridgeEvent{
		Type:     "queue_update",
		ID:       "session-1",
		Steering: []string{"先保留修改", "再检查测试"},
		FollowUp: []string{"最后总结"},
	})
	if event.Type != "session.queue_updated" ||
		len(event.Steering) != 2 ||
		len(event.FollowUp) != 1 {
		t.Fatalf("unexpected steering queue event: %#v", event)
	}
}

func TestNormalizeSteeringRejectionWithoutEndingTurn(t *testing.T) {
	event := normalizeBridgeEvent(bridgeEvent{
		Type:  "steer_rejected",
		ID:    "session-1",
		Error: "PI session not found",
	})
	if event.Type != "session.steer_rejected" ||
		event.Error != "PI session not found" ||
		event.Done {
		t.Fatalf("unexpected steering rejection event: %#v", event)
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

func TestBackgroundTaskStatusIsScopedToConversation(t *testing.T) {
	supervisor := NewSupervisor(nil)
	supervisor.observeRuntimeEvent(normalizeBridgeEvent(bridgeEvent{
		Type: "background_tasks",
		ID:   "conversation-1",
		Tasks: []BackgroundTask{{
			ID: "bg-first", Kind: "process", Status: "running", StartedAt: 1000,
		}},
	}))
	supervisor.observeRuntimeEvent(normalizeBridgeEvent(bridgeEvent{
		Type: "background_tasks",
		ID:   "conversation-2",
		Tasks: []BackgroundTask{{
			ID: "bg-second", Kind: "process", Status: "running", StartedAt: 2000,
		}},
	}))

	first := supervisor.StatusForSession("conversation-1")
	second := supervisor.StatusForSession("conversation-2")
	if len(first.BackgroundTasks) != 1 ||
		first.BackgroundTasks[0].ID != "bg-first" {
		t.Fatalf("unexpected first conversation status: %#v", first)
	}
	if len(second.BackgroundTasks) != 1 ||
		second.BackgroundTasks[0].ID != "bg-second" {
		t.Fatalf("unexpected second conversation status: %#v", second)
	}
	first.BackgroundTasks[0].ID = "mutated"
	if supervisor.StatusForSession("conversation-1").BackgroundTasks[0].ID != "bg-first" {
		t.Fatal("session runtime status leaked its internal background task slice")
	}
}

func TestRefreshBackgroundTasksRecoversRunningTasksWithoutModelTurn(t *testing.T) {
	reader, writer, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	defer reader.Close()
	defer writer.Close()

	workspace, err := resolveAgentWorkspace(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	supervisor := NewSupervisor(nil)
	supervisor.process = &childProcess{
		stdin:     writer,
		workspace: workspace,
	}
	type refreshResult struct {
		status RuntimeStatus
		err    error
	}
	result := make(chan refreshResult, 1)
	go func() {
		status, refreshErr := supervisor.RefreshBackgroundTasks(
			"session-recovery",
			workspace,
			"go",
			"workspace-auto",
			config.DefaultSettings(),
		)
		result <- refreshResult{status: status, err: refreshErr}
	}()

	commandReader := bufio.NewReader(reader)
	readCommand := func() map[string]any {
		t.Helper()
		line, readErr := commandReader.ReadBytes('\n')
		if readErr != nil {
			t.Fatal(readErr)
		}
		var command map[string]any
		if unmarshalErr := json.Unmarshal(line, &command); unmarshalErr != nil {
			t.Fatal(unmarshalErr)
		}
		return command
	}
	deliverTasks := func(command map[string]any, tasks []BackgroundTask) {
		t.Helper()
		requestID, _ := command["requestId"].(string)
		if requestID == "" {
			t.Fatalf("background control omitted request id: %#v", command)
		}
		event := normalizeBridgeEvent(bridgeEvent{
			Type:      "background_task_controlled",
			ID:        "session-recovery",
			RequestID: requestID,
			Tasks:     tasks,
		})
		supervisor.observeRuntimeEvent(event)
		supervisor.emitEvent(event)
	}

	initialList := readCommand()
	if initialList["action"] != "background_task_control" ||
		initialList["control"] != "list" {
		t.Fatalf("unexpected initial background query: %#v", initialList)
	}
	deliverTasks(initialList, []BackgroundTask{{
		ID:        "bg_restart",
		Kind:      "process",
		Status:    "running",
		StartedAt: 1000,
		PID:       4321,
	}})

	recovery := readCommand()
	if recovery["action"] != "create_session" ||
		recovery["conversationId"] != "session-recovery" ||
		recovery["executionMode"] != "go" ||
		recovery["approvalPolicy"] != "workspace-auto" ||
		recovery["recoveryPurpose"] != "background-tasks" {
		t.Fatalf("unexpected background recovery command: %#v", recovery)
	}
	for _, forbidden := range []string{
		"prompt",
		"provider",
		"model",
		"mcpServers",
		"mcpConfigDigest",
		"codingBrowser",
		"computerUse",
		"attachments",
	} {
		if _, exists := recovery[forbidden]; exists {
			t.Fatalf("background recovery unexpectedly restored %s: %#v", forbidden, recovery)
		}
	}
	supervisor.emitEvent(normalizeBridgeEvent(bridgeEvent{
		Type:    "ready",
		ID:      "session-recovery",
		Resumed: true,
	}))

	recoveredList := readCommand()
	if recoveredList["action"] != "background_task_control" ||
		recoveredList["control"] != "list" {
		t.Fatalf("unexpected recovered background query: %#v", recoveredList)
	}
	deliverTasks(recoveredList, []BackgroundTask{{
		ID:        "bg_restart",
		Kind:      "process",
		Status:    "running",
		StartedAt: 1000,
		PID:       4321,
		LogPath:   "/runtime/bg_restart.log",
		LogTail:   "server ready\n",
	}})

	select {
	case refreshed := <-result:
		if refreshed.err != nil {
			t.Fatal(refreshed.err)
		}
		if !refreshed.status.Running ||
			refreshed.status.SessionCount != 1 ||
			len(refreshed.status.BackgroundTasks) != 1 ||
			refreshed.status.BackgroundTasks[0].PID != 4321 ||
			refreshed.status.BackgroundTasks[0].LogTail != "server ready\n" ||
			refreshed.status.BackgroundRecovery == nil ||
			refreshed.status.BackgroundRecovery.State != "recovered" {
			t.Fatalf("unexpected recovered runtime status: %#v", refreshed.status)
		}
	case <-time.After(time.Second):
		t.Fatal("background recovery did not return")
	}

	go func() {
		status, refreshErr := supervisor.RefreshBackgroundTasks(
			"session-recovery",
			workspace,
			"go",
			"workspace-auto",
			config.DefaultSettings(),
		)
		result <- refreshResult{status: status, err: refreshErr}
	}()
	repeatedList := readCommand()
	deliverTasks(repeatedList, []BackgroundTask{{
		ID:        "bg_restart",
		Kind:      "process",
		Status:    "running",
		StartedAt: 1000,
		PID:       4321,
	}})
	attachedList := readCommand()
	if attachedList["action"] != "background_task_control" ||
		attachedList["control"] != "list" {
		t.Fatalf("active recovery enqueued another session: %#v", attachedList)
	}
	deliverTasks(attachedList, []BackgroundTask{{
		ID:        "bg_restart",
		Kind:      "process",
		Status:    "running",
		StartedAt: 1000,
		PID:       4321,
	}})
	select {
	case refreshed := <-result:
		if refreshed.err != nil {
			t.Fatal(refreshed.err)
		}
		if refreshed.status.BackgroundRecovery == nil ||
			refreshed.status.BackgroundRecovery.State != "attached" ||
			refreshed.status.SessionCount != 1 {
			t.Fatalf("unexpected attached runtime status: %#v", refreshed.status)
		}
	case <-time.After(time.Second):
		t.Fatal("attached background refresh did not return")
	}

	supervisor.mu.Lock()
	supervisor.process = nil
	supervisor.mu.Unlock()
}

func TestRefreshBackgroundTasksDoesNotCreateSessionWithoutRunningWork(t *testing.T) {
	reader, writer, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	defer reader.Close()
	defer writer.Close()

	workspace, err := resolveAgentWorkspace(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	supervisor := NewSupervisor(nil)
	supervisor.process = &childProcess{
		stdin:     writer,
		workspace: workspace,
	}
	type refreshResult struct {
		status RuntimeStatus
		err    error
	}
	result := make(chan refreshResult, 1)
	go func() {
		status, refreshErr := supervisor.RefreshBackgroundTasks(
			"session-empty",
			workspace,
			"plan",
			"read-only",
			config.DefaultSettings(),
		)
		result <- refreshResult{status: status, err: refreshErr}
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
		command["control"] != "list" ||
		requestID == "" {
		t.Fatalf("unexpected empty background query: %#v", command)
	}
	event := normalizeBridgeEvent(bridgeEvent{
		Type:      "background_task_controlled",
		ID:        "session-empty",
		RequestID: requestID,
		Tasks:     []BackgroundTask{},
	})
	supervisor.observeRuntimeEvent(event)
	supervisor.emitEvent(event)

	select {
	case refreshed := <-result:
		if refreshed.err != nil {
			t.Fatal(refreshed.err)
		}
		if refreshed.status.SessionCount != 0 ||
			len(refreshed.status.BackgroundTasks) != 0 {
			t.Fatalf("empty refresh created a session: %#v", refreshed.status)
		}
	case <-time.After(time.Second):
		t.Fatal("empty background refresh did not return")
	}

	supervisor.mu.Lock()
	supervisor.process = nil
	supervisor.mu.Unlock()
}

func TestBackgroundRecoveryFailurePersistsUntilLateReady(t *testing.T) {
	workspace, err := resolveAgentWorkspace(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	supervisor := NewSupervisor(nil)
	supervisor.process = &childProcess{workspace: workspace}
	supervisor.sessions["session-late-ready"] = struct{}{}
	supervisor.recoveryFailures["session-late-ready"] = "recovery timed out"

	recovered, err := supervisor.recoverBackgroundTaskSession(
		"session-late-ready",
		workspace,
		CodingPolicy{
			ExecutionMode:  "go",
			ApprovalPolicy: "workspace-auto",
		},
	)
	if err == nil || err.Error() != "recovery timed out" || recovered {
		t.Fatalf("unexpected persisted recovery failure: recovered=%v err=%v", recovered, err)
	}

	supervisor.emitEvent(normalizeBridgeEvent(bridgeEvent{
		Type: "ready",
		ID:   "session-late-ready",
	}))
	recovered, err = supervisor.recoverBackgroundTaskSession(
		"session-late-ready",
		workspace,
		CodingPolicy{
			ExecutionMode:  "go",
			ApprovalPolicy: "workspace-auto",
		},
	)
	if err != nil || recovered {
		t.Fatalf("late ready did not clear recovery failure: recovered=%v err=%v", recovered, err)
	}
}

func TestStartBackgroundTaskSendsReviewedTerminalCommand(t *testing.T) {
	reader, writer, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	defer reader.Close()
	defer writer.Close()

	workspace, err := resolveAgentWorkspace(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	supervisor := NewSupervisor(nil)
	supervisor.process = &childProcess{
		stdin:     writer,
		workspace: workspace,
	}
	type startResult struct {
		status RuntimeStatus
		err    error
	}
	result := make(chan startResult, 1)
	go func() {
		status, startErr := supervisor.StartBackgroundTask(
			"session-terminal",
			workspace,
			"npm test",
			"Tests",
			"go",
			"workspace-auto",
			config.DefaultSettings(),
		)
		result <- startResult{status: status, err: startErr}
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
		command["control"] != "spawn" ||
		command["conversationId"] != "session-terminal" ||
		command["command"] != "npm test" ||
		command["name"] != "Tests" ||
		command["executionMode"] != "go" ||
		command["approvalPolicy"] != "workspace-auto" ||
		requestID == "" {
		t.Fatalf("unexpected terminal control command: %#v", command)
	}

	event := normalizeBridgeEvent(bridgeEvent{
		Type:      "background_task_controlled",
		ID:        "session-terminal",
		RequestID: requestID,
		Tasks: []BackgroundTask{{
			ID: "bg_terminal", Kind: "process", Status: "running", StartedAt: 1000,
		}},
	})
	supervisor.observeRuntimeEvent(event)
	supervisor.emitEvent(event)

	select {
	case started := <-result:
		if started.err != nil {
			t.Fatal(started.err)
		}
		if len(started.status.BackgroundTasks) != 1 ||
			started.status.BackgroundTasks[0].ID != "bg_terminal" {
			t.Fatalf("unexpected started runtime status: %#v", started.status)
		}
	case <-time.After(time.Second):
		t.Fatal("terminal task start receipt was not delivered")
	}

	supervisor.mu.Lock()
	supervisor.process = nil
	supervisor.mu.Unlock()
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

func TestNormalizeCodingCollaborationDescriptorBindsTaskWorkspaceAndWriter(t *testing.T) {
	sessionID := "collaboration-session"
	workspace, err := resolveAgentWorkspace(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	root, err := resolveAgentWorkspace(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256([]byte(sessionID))
	taskKey := fmt.Sprintf("%x", digest[:16])
	writerPath := filepath.Join(root, taskKey, "writer-1")
	if err := os.MkdirAll(writerPath, 0o700); err != nil {
		t.Fatal(err)
	}
	descriptor := &CodingCollaborationDescriptor{
		SchemaVersion:  2,
		ConversationID: sessionID,
		Workspace:      workspace,
		BaseHead:       strings.Repeat("a", 40),
		Worktrees: []CodingCollaborationWorktree{{
			ID:     "writer-1",
			Path:   writerPath,
			Branch: fmt.Sprintf("codex/agent-%s-writer-1", taskKey[:12]),
		}},
	}
	normalized, err := normalizeCodingCollaborationDescriptor(
		descriptor,
		sessionID,
		workspace,
		root,
	)
	if err != nil {
		t.Fatal(err)
	}
	if normalized.Worktrees[0].Path != writerPath ||
		normalized.Worktrees[0].Branch != descriptor.Worktrees[0].Branch {
		t.Fatalf("unexpected normalized descriptor: %#v", normalized)
	}

	invalidTask := *descriptor
	invalidTask.ConversationID = "another-session"
	if _, err := normalizeCodingCollaborationDescriptor(
		&invalidTask,
		sessionID,
		workspace,
		root,
	); err == nil {
		t.Fatal("expected a descriptor from another task to be rejected")
	}

	invalidWorkspace := *descriptor
	invalidWorkspace.Workspace = t.TempDir()
	if _, err := normalizeCodingCollaborationDescriptor(
		&invalidWorkspace,
		sessionID,
		workspace,
		root,
	); err == nil {
		t.Fatal("expected a descriptor from another workspace to be rejected")
	}

	invalidWriter := *descriptor
	invalidWriter.Worktrees = append([]CodingCollaborationWorktree(nil), descriptor.Worktrees...)
	invalidWriter.Worktrees[0].Branch = "codex/agent-unregistered-writer-1"
	if _, err := normalizeCodingCollaborationDescriptor(
		&invalidWriter,
		sessionID,
		workspace,
		root,
	); err == nil {
		t.Fatal("expected an unregistered writer branch to be rejected")
	}

	invalidBase := *descriptor
	invalidBase.BaseHead = "not-a-git-object"
	if _, err := normalizeCodingCollaborationDescriptor(
		&invalidBase,
		sessionID,
		workspace,
		root,
	); err == nil {
		t.Fatal("expected an invalid base commit to be rejected")
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
		"session-1", "hello", "", "", "", "", nil, "", nil, nil, nil, nil, config.DefaultSettings(),
	)
	if err == nil || !strings.Contains(err.Error(), "Settings > API Keys") {
		t.Fatalf("expected actionable missing-key error, got %v", err)
	}
	status := supervisor.Status()
	if status.Running || status.SessionCount != 0 {
		t.Fatalf("missing credentials must not start a sidecar or session: %#v", status)
	}
}

func TestSteerMessageUsesExistingPiSession(t *testing.T) {
	reader, writer, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	defer reader.Close()
	defer writer.Close()

	supervisor := NewSupervisor(nil)
	supervisor.process = &childProcess{stdin: writer, workspace: t.TempDir()}
	supervisor.sessions["session-1"] = struct{}{}
	defer func() {
		supervisor.mu.Lock()
		supervisor.stopAllTurnTimersLocked()
		supervisor.process = nil
		supervisor.sessions = make(map[string]struct{})
		supervisor.mu.Unlock()
	}()

	if err := supervisor.SteerMessage("session-1", "不要改 API，先补测试"); err != nil {
		t.Fatal(err)
	}
	line, err := bufio.NewReader(reader).ReadBytes('\n')
	if err != nil {
		t.Fatal(err)
	}
	var command map[string]any
	if err := json.Unmarshal(line, &command); err != nil {
		t.Fatal(err)
	}
	if command["action"] != "steer_message" ||
		command["conversationId"] != "session-1" ||
		command["prompt"] != "不要改 API，先补测试" {
		t.Fatalf("unexpected steering command: %#v", command)
	}
}

func TestGenerateTextUsesSilentToolFreePiTurn(t *testing.T) {
	t.Setenv("XDG_DATA_HOME", t.TempDir())
	reader, writer, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	defer reader.Close()
	defer writer.Close()

	workspace, err := resolveAgentWorkspace("")
	if err != nil {
		t.Fatal(err)
	}
	publicEvents := make(chan Event, 4)
	supervisor := NewSupervisor(func(event Event) { publicEvents <- event })
	supervisor.process = &childProcess{stdin: writer, workspace: workspace}
	defer func() {
		supervisor.mu.Lock()
		supervisor.stopAllTurnTimersLocked()
		supervisor.process = nil
		supervisor.sessions = make(map[string]struct{})
		supervisor.mu.Unlock()
	}()

	type generationResult struct {
		value TextGenerationResult
		err   error
	}
	result := make(chan generationResult, 1)
	go func() {
		value, generationErr := supervisor.GenerateText("return semantic JSON", modelSelectionSettings())
		result <- generationResult{value: value, err: generationErr}
	}()

	line, err := bufio.NewReader(reader).ReadBytes('\n')
	if err != nil {
		t.Fatal(err)
	}
	var command map[string]any
	if err := json.Unmarshal(line, &command); err != nil {
		t.Fatal(err)
	}
	sessionID, _ := command["conversationId"].(string)
	prompt, _ := command["prompt"].(string)
	if command["action"] != "send_message" ||
		command["executionMode"] != "plan" ||
		command["approvalPolicy"] != "read-only" ||
		!strings.HasPrefix(sessionID, "milksu_text_projection_") ||
		!strings.HasPrefix(prompt, "Do not call any Agent tools.") {
		t.Fatalf("unexpected text projection command: %#v", command)
	}

	supervisor.emitEvent(Event{SessionID: sessionID, Type: "assistant.delta", Text: `{"title":"`})
	supervisor.emitEvent(Event{SessionID: sessionID, Type: "assistant.completed", Text: `{"title":"semantic"}`})
	select {
	case generated := <-result:
		if generated.err != nil {
			t.Fatal(generated.err)
		}
		if generated.value.Text != `{"title":"semantic"}` || generated.value.Model == "" {
			t.Fatalf("result = %#v", generated.value)
		}
	case <-time.After(time.Second):
		t.Fatal("GenerateText did not complete")
	}
	select {
	case event := <-publicEvents:
		t.Fatalf("silent projection event leaked to product stream: %#v", event)
	default:
	}
	// The Sidecar acknowledges destruction asynchronously, after GenerateText
	// has removed its waiter. Projection lifecycle events must remain private.
	supervisor.emitEvent(Event{SessionID: sessionID, Type: "session.destroyed"})
	select {
	case event := <-publicEvents:
		t.Fatalf("delayed projection cleanup leaked to product stream: %#v", event)
	default:
	}
}

func TestSendMessageIncludesComputerUseDescriptorOnlyForInteractiveCoding(t *testing.T) {
	reader, writer, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	defer reader.Close()
	defer writer.Close()

	workspace, err := resolveAgentWorkspace(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	supervisor := NewSupervisor(nil)
	supervisor.process = &childProcess{
		stdin:     writer,
		workspace: workspace,
	}
	defer func() {
		supervisor.mu.Lock()
		supervisor.stopAllTurnTimersLocked()
		supervisor.process = nil
		supervisor.sessions = make(map[string]struct{})
		supervisor.mu.Unlock()
	}()

	readCommand := func() map[string]any {
		t.Helper()
		line, err := bufio.NewReader(reader).ReadBytes('\n')
		if err != nil {
			t.Fatal(err)
		}
		var command map[string]any
		if err := json.Unmarshal(line, &command); err != nil {
			t.Fatal(err)
		}
		return command
	}
	descriptor := &ComputerUseDescriptor{
		SessionID:      "computer_external42",
		SocketPath:     "/private/tmp/milksu-computer-use/computer_external42/driver.sock",
		TargetBundleID: "com.apple.TextEdit",
		TargetName:     "TextEdit",
		TargetPID:      os.Getpid() + 200,
		TargetWindowID: 9001,
	}
	settings := modelSelectionSettings()

	if err := supervisor.SendMessage(
		"coding-computer", "observe TextEdit", workspace, "", "go", "workspace-auto", nil, "",
		nil, descriptor, nil, nil, settings,
	); err != nil {
		t.Fatal(err)
	}
	command := readCommand()
	computerUse, ok := command["computerUse"].(map[string]any)
	if !ok {
		t.Fatalf("interactive Coding command omitted Computer Use descriptor: %#v", command)
	}
	if command["action"] != "send_message" ||
		command["conversationId"] != "coding-computer" ||
		computerUse["targetBundleId"] != "com.apple.TextEdit" ||
		computerUse["targetName"] != "TextEdit" ||
		int(computerUse["targetPid"].(float64)) != descriptor.TargetPID ||
		int64(computerUse["targetWindowId"].(float64)) != descriptor.TargetWindowID {
		t.Fatalf("unexpected Computer Use command: %#v", command)
	}

	for _, blocked := range []struct {
		name           string
		sessionRole    string
		executionMode  string
		approvalPolicy string
	}{
		{name: "plan", executionMode: "plan", approvalPolicy: "workspace-auto"},
		{name: "read-only", executionMode: "go", approvalPolicy: "read-only"},
		{name: "ctf", sessionRole: "solver", executionMode: "go", approvalPolicy: "workspace-auto"},
	} {
		if err := supervisor.SendMessage(
			"coding-computer-"+blocked.name,
			"do not load desktop controls",
			workspace,
			blocked.sessionRole,
			blocked.executionMode,
			blocked.approvalPolicy,
			nil,
			"",
			nil,
			descriptor,
			nil,
			nil,
			settings,
		); err != nil {
			t.Fatal(err)
		}
		command := readCommand()
		if _, exists := command["computerUse"]; exists {
			t.Fatalf("%s command unexpectedly loaded Computer Use: %#v", blocked.name, command)
		}
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

func TestNormalizeCodingBrowserDescriptorRequiresExactLoopbackEndpoint(t *testing.T) {
	descriptor, err := normalizeCodingBrowserDescriptor(&CodingBrowserDescriptor{
		SessionID:   "browser_123e4567-e89b-12d3-a456-426614174000",
		CDPEndpoint: "http://127.0.0.1:43117",
	})
	if err != nil || descriptor.CDPEndpoint != "http://127.0.0.1:43117" {
		t.Fatalf("expected valid descriptor, got %#v, %v", descriptor, err)
	}
	for _, endpoint := range []string{
		"https://127.0.0.1:43117",
		"http://localhost:43117",
		"http://127.0.0.1:43117/json",
		"http://127.0.0.1:43117?token=secret",
		"http://user@127.0.0.1:43117",
		"http://127.0.0.1:70000",
	} {
		if _, err := normalizeCodingBrowserDescriptor(&CodingBrowserDescriptor{
			SessionID:   "browser_fixture",
			CDPEndpoint: endpoint,
		}); err == nil {
			t.Fatalf("expected endpoint %q to be rejected", endpoint)
		}
	}
}

func TestNormalizeComputerUseDescriptorAcceptsExactVisibleTarget(t *testing.T) {
	valid := &ComputerUseDescriptor{
		SessionID:      "computer_12345678",
		SocketPath:     "/private/tmp/milksu-computer-use/computer_12345678/driver.sock",
		TargetBundleID: "com.openai.codex",
		TargetName:     "Codex",
		TargetPID:      os.Getpid() + 200,
		TargetWindowID: 9001,
	}
	normalized, err := normalizeComputerUseDescriptor(valid)
	if err != nil {
		t.Fatal(err)
	}
	if *normalized != *valid {
		t.Fatalf("unexpected Computer Use descriptor: %#v", normalized)
	}
	for _, descriptor := range []*ComputerUseDescriptor{
		{SessionID: "computer_short"},
		{
			SessionID:      valid.SessionID,
			SocketPath:     "/tmp/cua.sock",
			TargetBundleID: valid.TargetBundleID,
			TargetName:     valid.TargetName,
			TargetPID:      valid.TargetPID,
		},
		{
			SessionID:      valid.SessionID,
			SocketPath:     valid.SocketPath,
			TargetBundleID: "com.apple.finder/invalid",
			TargetName:     "Finder",
			TargetPID:      valid.TargetPID,
			TargetWindowID: valid.TargetWindowID,
		},
		{
			SessionID:      valid.SessionID,
			SocketPath:     valid.SocketPath,
			TargetBundleID: valid.TargetBundleID,
			TargetName:     valid.TargetName,
			TargetPID:      1,
			TargetWindowID: valid.TargetWindowID,
		},
		{
			SessionID:      valid.SessionID,
			SocketPath:     valid.SocketPath,
			TargetBundleID: valid.TargetBundleID,
			TargetName:     valid.TargetName,
			TargetPID:      valid.TargetPID,
			TargetWindowID: 0,
		},
	} {
		if _, err := normalizeComputerUseDescriptor(descriptor); err == nil {
			t.Fatalf("expected invalid Computer Use descriptor to fail: %#v", descriptor)
		}
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
		"--allow-fs-read=/private/tmp/milksu-computer-use",
		"--allow-fs-write=/private/tmp/milksu-computer-use",
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

func TestEngineEnvironmentIncludesTokenFluxProvider(t *testing.T) {
	baseURL := "https://tokenflux.dev/v1"
	settings := config.DefaultSettings()
	settings.ActiveProvider = "tokenflux"
	settings.ActiveModel = "grok-4.3"
	settings.Providers["tokenflux"] = config.ProviderConfig{
		APIKey:  "tokenflux-provider-secret",
		BaseURL: &baseURL,
		Enabled: true,
	}

	if err := validateModelAccess(settings); err != nil {
		t.Fatalf("expected TokenFlux provider to pass validation, got %v", err)
	}

	environment := engineEnvironment(settings)
	for _, expected := range []string{
		"TOKENFLUX_API_KEY=tokenflux-provider-secret",
		"TOKENFLUX_BASE_URL=https://tokenflux.dev/v1",
	} {
		if !containsEnvironmentEntry(environment, expected) {
			t.Fatalf("expected %q in %#v", expected, environment)
		}
	}
}

func TestSidecarEnvironmentIncludesConfiguredVisionRoute(t *testing.T) {
	t.Setenv("XDG_DATA_HOME", t.TempDir())
	settings := config.DefaultSettings()
	settings.VisionModel = &config.ModelSelection{
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
	if err := supervisor.SetTurnActivityTimeout(20 * time.Millisecond); err != nil {
		t.Fatal(err)
	}
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

func TestSetTurnActivityTimeoutRejectsNonPositiveDuration(t *testing.T) {
	supervisor := NewSupervisor(nil)
	defer supervisor.Close()
	if err := supervisor.SetTurnActivityTimeout(0); err == nil {
		t.Fatal("zero turn activity timeout was accepted")
	}
	if supervisor.turnTimeout != defaultTurnActivityTimeout {
		t.Fatalf("invalid timeout changed the default: %s", supervisor.turnTimeout)
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
		Type:      "tool.progress",
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

func TestRunningToolUsesLongerSilenceTimeout(t *testing.T) {
	events := make(chan Event, 2)
	supervisor := NewSupervisor(func(event Event) {
		events <- event
	})
	defer supervisor.Close()
	supervisor.turnTimeout = 20 * time.Millisecond
	supervisor.toolSilenceTimeout = 80 * time.Millisecond
	supervisor.mu.Lock()
	supervisor.sessions["session-tool"] = struct{}{}
	supervisor.armTurnTimerLocked("session-tool")
	supervisor.mu.Unlock()
	supervisor.observeTurnEvent(Event{
		SessionID:  "session-tool",
		Type:       "tool.started",
		ToolCallID: "tool-1",
	})
	time.Sleep(40 * time.Millisecond)
	select {
	case event := <-events:
		t.Fatalf("running tool used normal turn timeout: %#v", event)
	default:
	}
	select {
	case event := <-events:
		if event.Type != "engine.error" ||
			event.SessionID != "session-tool" ||
			!strings.Contains(event.Error, "persisted workspace") {
			t.Fatalf("unexpected tool silence timeout event: %#v", event)
		}
	case <-time.After(time.Second):
		t.Fatal("silent running tool did not time out")
	}
}

func TestNormalizeBridgeToolProgressDropsPartialContent(t *testing.T) {
	event := normalizeBridgeEvent(bridgeEvent{
		Type:       "tool_call_progress",
		ID:         "session-active",
		ToolName:   "subagent",
		ToolCallID: "tool-1",
		Content:    "child output must not cross the bridge",
	})
	if event.Type != "tool.progress" ||
		event.SessionID != "session-active" ||
		event.ToolName != "subagent" ||
		event.ToolCallID != "tool-1" {
		t.Fatalf("unexpected tool progress event: %#v", event)
	}
	if event.Text != "" || event.Error != "" || event.Done {
		t.Fatalf("tool progress leaked content or settled the tool: %#v", event)
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

func TestProbeFailureMessageRedactsCredentialsAndKeepsOfflineCause(t *testing.T) {
	message := probeFailureMessage(Event{
		Type: "engine.error",
		Error: "Error: dial tcp 127.0.0.1:65533: connect: connection refused " +
			"api_key=synthetic-secret-value Bearer synthetic-bearer-value " +
			"https://provider.invalid/v1?key=synthetic-query-value\nat internal stack",
	})
	if !strings.Contains(message, "dial tcp 127.0.0.1:65533") ||
		!strings.Contains(message, "connection refused") {
		t.Fatalf("offline failure lost its actionable cause: %q", message)
	}
	for _, secret := range []string{
		"synthetic-secret-value",
		"synthetic-bearer-value",
		"synthetic-query-value",
	} {
		if strings.Contains(message, secret) {
			t.Fatalf("probe failure leaked a synthetic credential: %q", message)
		}
	}
	if strings.Count(message, "[REDACTED]") != 3 {
		t.Fatalf("unexpected probe redaction result: %q", message)
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

func TestNormalizeCompactionLifecycle(t *testing.T) {
	started := normalizeBridgeEvent(bridgeEvent{
		Type:      "compaction_start",
		ID:        "session-compact",
		RequestID: "comp-1",
		Reason:    "manual",
	})
	if started.Type != "runtime.compaction_started" ||
		started.RequestID != "comp-1" ||
		started.Reason != "manual" ||
		started.Done {
		t.Fatalf("unexpected compaction start event: %#v", started)
	}

	completed := normalizeBridgeEvent(bridgeEvent{
		Type:      "compaction_end",
		ID:        "session-compact",
		RequestID: "comp-1",
		Reason:    "manual",
		Aborted:   false,
		Compaction: &CompactionResult{
			TokensBefore:         5000,
			EstimatedTokensAfter: 800,
		},
	})
	if completed.Type != "runtime.compaction_completed" ||
		completed.RequestID != "comp-1" ||
		!completed.Done ||
		completed.Compaction == nil ||
		completed.Compaction.TokensBefore != 5000 ||
		completed.Compaction.EstimatedTokensAfter != 800 {
		t.Fatalf("unexpected compaction end event: %#v", completed)
	}

	failed := normalizeBridgeEvent(bridgeEvent{
		Type:      "compaction_end",
		ID:        "session-compact",
		RequestID: "comp-1",
		Aborted:   true,
		Error:     "Compaction cancelled",
	})
	if failed.Type != "runtime.compaction_completed" ||
		failed.Error != "Compaction cancelled" ||
		!failed.Aborted ||
		failed.Compaction != nil {
		t.Fatalf("failed compaction must carry the error and no result: %#v", failed)
	}
}

func TestCompactSessionWaitsForSidecarReceipt(t *testing.T) {
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
	supervisor.sessions["session-compact"] = struct{}{}
	type compactResult struct {
		result CompactionResult
		err    error
	}
	result := make(chan compactResult, 1)
	go func() {
		compacted, compactErr := supervisor.CompactSessionWithTimeout(
			"session-compact",
			time.Second,
		)
		result <- compactResult{result: compacted, err: compactErr}
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
	if command["action"] != "compact_session" ||
		command["conversationId"] != "session-compact" ||
		requestID == "" {
		t.Fatalf("unexpected compaction command: %#v", command)
	}

	supervisor.emitEvent(normalizeBridgeEvent(bridgeEvent{
		Type:      "compaction_start",
		ID:        "session-compact",
		RequestID: requestID,
		Reason:    "manual",
	}))
	select {
	case compacted := <-result:
		t.Fatalf(
			"compaction start must not settle the waiting control: %#v",
			compacted,
		)
	case <-time.After(20 * time.Millisecond):
	}

	event := normalizeBridgeEvent(bridgeEvent{
		Type:      "compaction_end",
		ID:        "session-compact",
		RequestID: requestID,
		Reason:    "manual",
		Compaction: &CompactionResult{
			TokensBefore:         9000,
			EstimatedTokensAfter: 1200,
		},
	})
	supervisor.emitEvent(event)

	select {
	case compacted := <-result:
		if compacted.err != nil {
			t.Fatal(compacted.err)
		}
		if compacted.result.TokensBefore != 9000 ||
			compacted.result.EstimatedTokensAfter != 1200 {
			t.Fatalf("unexpected compaction result: %#v", compacted.result)
		}
	case <-time.After(time.Second):
		t.Fatal("compaction receipt was not delivered")
	}

	supervisor.mu.Lock()
	supervisor.process = nil
	supervisor.mu.Unlock()
}

func TestCompactSessionReportsFailureWithoutSuccess(t *testing.T) {
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
	supervisor.sessions["session-compact"] = struct{}{}
	result := make(chan error, 1)
	go func() {
		_, compactErr := supervisor.CompactSessionWithTimeout(
			"session-compact",
			time.Second,
		)
		result <- compactErr
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

	event := normalizeBridgeEvent(bridgeEvent{
		Type:      "compaction_end",
		ID:        "session-compact",
		RequestID: requestID,
		Error:     "Error: Nothing to compact (session too small)",
	})
	supervisor.emitEvent(event)

	select {
	case compactErr := <-result:
		if compactErr == nil ||
			!strings.Contains(compactErr.Error(), "Nothing to compact") {
			t.Fatalf("expected explicit compaction failure, got %v", compactErr)
		}
	case <-time.After(time.Second):
		t.Fatal("compaction failure receipt was not delivered")
	}

	supervisor.mu.Lock()
	supervisor.process = nil
	supervisor.mu.Unlock()
}

func TestCompactSessionTimesOut(t *testing.T) {
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
	supervisor.sessions["session-compact"] = struct{}{}
	_, compactErr := supervisor.CompactSessionWithTimeout(
		"session-compact",
		30*time.Millisecond,
	)
	if compactErr == nil ||
		!strings.Contains(compactErr.Error(), "timed out") {
		t.Fatalf("expected compaction timeout, got %v", compactErr)
	}

	supervisor.mu.Lock()
	supervisor.process = nil
	supervisor.mu.Unlock()
}

func TestCompactSessionDetectsProcessStop(t *testing.T) {
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
	supervisor.sessions["session-compact"] = struct{}{}
	result := make(chan error, 1)
	go func() {
		_, compactErr := supervisor.CompactSessionWithTimeout(
			"session-compact",
			time.Second,
		)
		result <- compactErr
	}()

	line, err := bufio.NewReader(reader).ReadBytes('\n')
	if err != nil {
		t.Fatal(err)
	}
	var command map[string]any
	if err := json.Unmarshal(line, &command); err != nil {
		t.Fatal(err)
	}

	supervisor.deliverControlEvent(Event{
		Type:  "engine.stopped",
		Error: "sidecar exited",
	})

	select {
	case compactErr := <-result:
		if compactErr == nil ||
			!strings.Contains(compactErr.Error(), "stopped") ||
			!strings.Contains(compactErr.Error(), "sidecar exited") {
			t.Fatalf("expected diagnosable process-stop failure, got %v", compactErr)
		}
	case <-time.After(time.Second):
		t.Fatal("process-stop failure was not delivered")
	}

	supervisor.mu.Lock()
	supervisor.process = nil
	supervisor.mu.Unlock()
}

func TestCompactSessionRequiresBoundSession(t *testing.T) {
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
	// No session in s.sessions: the request must be rejected without writing.
	_, compactErr := supervisor.CompactSessionWithTimeout(
		"session-unknown",
		time.Second,
	)
	if compactErr == nil ||
		!strings.Contains(compactErr.Error(), "session not found") {
		t.Fatalf("expected bound-session rejection, got %v", compactErr)
	}
	// Nothing may reach the Sidecar for an unbound conversation. A blocking
	// read would hang because nothing is ever written, so verify emptiness
	// with a goroutine plus a short select window, then close the writer to
	// unblock the reader.
	read := make(chan struct{})
	go func() {
		_, _ = bufio.NewReader(reader).ReadBytes('\n')
		close(read)
	}()
	select {
	case <-read:
		t.Fatal("compact request must not reach the Sidecar for an unbound conversation")
	case <-time.After(100 * time.Millisecond):
	}
	_ = writer.Close()

	supervisor.mu.Lock()
	supervisor.process = nil
	supervisor.mu.Unlock()
}

func TestCompactSessionValidation(t *testing.T) {
	supervisor := NewSupervisor(nil)
	defer supervisor.Close()
	if _, err := supervisor.CompactSessionWithTimeout(
		"",
		time.Second,
	); err == nil || !strings.Contains(err.Error(), "session id is required") {
		t.Fatalf("expected empty session rejection, got %v", err)
	}
	supervisor.sessions["session-compact"] = struct{}{}
	if _, err := supervisor.CompactSessionWithTimeout(
		"session-compact",
		0,
	); err == nil || !strings.Contains(err.Error(), "timeout must be positive") {
		t.Fatalf("expected timeout validation, got %v", err)
	}
}

func TestCompactSessionRequiresRunningSidecar(t *testing.T) {
	supervisor := NewSupervisor(nil)
	defer supervisor.Close()
	supervisor.sessions["session-compact"] = struct{}{}
	if _, err := supervisor.CompactSessionWithTimeout(
		"session-compact",
		time.Second,
	); err == nil || !strings.Contains(err.Error(), "PI Sidecar is not running") {
		t.Fatalf("expected sidecar rejection, got %v", err)
	}
}
