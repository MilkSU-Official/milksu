package main

import (
	"context"
	"time"

	"github.com/MilkSU-Official/milksu/internal/appdata"
	"github.com/MilkSU-Official/milksu/internal/codingenv"
	"github.com/MilkSU-Official/milksu/internal/engine"
)

func (a *App) GetRuntimeStatus(conversationID string) engine.RuntimeStatus {
	return a.enrichRuntimeStatus(
		a.engines.StatusForSession(conversationID),
	)
}

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
