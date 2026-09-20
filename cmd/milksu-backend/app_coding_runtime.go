package main

import (
	"context"
	"crypto/rand"
	"fmt"
	"strings"
	"time"

	"github.com/MilkSU-Official/milksu/internal/appdata"
	"github.com/MilkSU-Official/milksu/internal/codingenv"
	"github.com/MilkSU-Official/milksu/internal/conversation"
	"github.com/MilkSU-Official/milksu/internal/engine"
)

func (a *App) RefreshCodingBackgroundTasks(
	conversationID,
	workspacePath,
	executionMode,
	approvalPolicy string,
) (engine.RuntimeStatus, error) {
	status, err := a.engines.RefreshBackgroundTasks(
		conversationID,
		workspacePath,
		executionMode,
		approvalPolicy,
		a.settings.GetResolved(),
	)
	if err != nil {
		return engine.RuntimeStatus{}, err
	}
	if recovery := status.BackgroundRecovery; recovery != nil && recovery.State == "failed" {
		a.diagnostics.Record(
			"coding-engine",
			"warning",
			"background task recovery failed",
		)
		_ = appdata.AppendEventLog(
			a.dataDirectory,
			appdata.PersistedBackgroundRecoveryFailed,
		)
	}
	return a.enrichRuntimeStatus(status), nil
}

func (a *App) StartCodingBackgroundTask(
	conversationID,
	workspacePath,
	command,
	name,
	executionMode,
	approvalPolicy string,
) (engine.RuntimeStatus, error) {
	status, err := a.engines.StartBackgroundTask(
		conversationID,
		workspacePath,
		command,
		name,
		executionMode,
		approvalPolicy,
		a.settings.GetResolved(),
	)
	if err != nil {
		return engine.RuntimeStatus{}, err
	}
	a.diagnostics.Record("coding-engine", "info", "background task started")
	_ = appdata.AppendEventLog(a.dataDirectory, appdata.PersistedBackgroundTaskStarted)
	return a.enrichRuntimeStatus(status), nil
}

func (a *App) StopCodingBackgroundTask(
	conversationID,
	taskID string,
) (engine.RuntimeStatus, error) {
	status, err := a.engines.StopBackgroundTask(conversationID, taskID)
	if err != nil {
		return engine.RuntimeStatus{}, err
	}
	a.diagnostics.Record("coding-engine", "info", "background task stopped")
	_ = appdata.AppendEventLog(a.dataDirectory, appdata.PersistedBackgroundTaskStopped)
	return a.enrichRuntimeStatus(status), nil
}

// CompactCodingSession is the thin Wails DTO for the Supervisor's waiting
// manual Pi context compaction control surface.
func (a *App) CompactCodingSession(
	conversationID string,
) (engine.CompactionResult, error) {
	return a.engines.CompactSession(conversationID)
}

func (a *App) RewindCodingSession(conversationID string) error {
	return a.engines.RewindSession(conversationID)
}

func (a *App) HandoffCodingSession(conversationID, kernel string) (engine.SessionHandoffResult, error) {
	current := engine.KernelPi
	stored, storedErr := conversation.StoredConversation{}, error(nil)
	if a != nil && a.conversations != nil {
		stored, storedErr = a.conversations.Get(conversationID)
		if storedErr == nil {
			current = engine.NormalizeKernel(stored.Kernel)
		}
	}
	target := engine.NormalizeKernel(kernel)
	if target == current {
		return a.engines.HandoffSession(conversationID)
	}
	compacted, err := a.engines.CompactSession(conversationID)
	if err != nil {
		if storedErr == nil && compactionAllowsStoredHandoff(err) {
			return handoffFromStoredConversation(stored), nil
		}
		return engine.SessionHandoffResult{}, err
	}
	return engine.SessionHandoffResult{
		SessionID:   newHandoffConversationID(),
		Summary:     compacted.Summary,
		SurfaceText: compacted.SurfaceText,
	}, nil
}

func compactionAllowsStoredHandoff(err error) bool {
	if err == nil {
		return false
	}
	text := strings.ToLower(err.Error())
	return strings.Contains(text, "session not found") ||
		strings.Contains(text, "sidecar is not running")
}

func handoffSummaryFromStored(stored conversation.StoredConversation) string {
	parts := make([]string, 0, 8)
	for _, message := range stored.Messages {
		content := strings.TrimSpace(message.Content)
		role := strings.TrimSpace(message.Role)
		if content == "" {
			continue
		}
		if len(content) > 400 {
			content = content[:400]
		}
		if role == "" {
			parts = append(parts, content)
		} else {
			parts = append(parts, role+": "+content)
		}
		if len(parts) >= 8 {
			break
		}
	}
	if len(parts) == 0 {
		return strings.TrimSpace(stored.Title)
	}
	return strings.Join(parts, "\n")
}

func handoffFromStoredConversation(stored conversation.StoredConversation) engine.SessionHandoffResult {
	summary := handoffSummaryFromStored(stored)
	return engine.SessionHandoffResult{
		SessionID:   newHandoffConversationID(),
		Summary:     summary,
		SurfaceText: summary,
	}
}

func newHandoffConversationID() string {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return fmt.Sprintf("handoff_%d", time.Now().UnixNano())
	}
	buf[6] = (buf[6] & 0x0f) | 0x40
	buf[8] = (buf[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", buf[0:4], buf[4:6], buf[6:8], buf[8:10], buf[10:])
}

func (a *App) enrichRuntimeStatus(status engine.RuntimeStatus) engine.RuntimeStatus {
	for index := range status.BackgroundTasks {
		task := &status.BackgroundTasks[index]
		if task.Status != "running" {
			continue
		}
		inspectContext, cancel := context.WithTimeout(
			a.commandContext(),
			350*time.Millisecond,
		)
		task.Ports = codingenv.ListeningPorts(
			inspectContext,
			task.PID,
			task.PGID,
		)
		cancel()
	}
	return status
}
