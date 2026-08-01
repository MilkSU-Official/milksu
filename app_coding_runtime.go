package main

import (
	"context"
	"time"

	"github.com/MilkSU-Official/milksu/internal/codingenv"
	"github.com/MilkSU-Official/milksu/internal/engine"
)

func (a *App) GetRuntimeStatus() engine.RuntimeStatus {
	return a.enrichRuntimeStatus(a.engines.Status())
}

func (a *App) StopCodingBackgroundTask(
	conversationID,
	taskID string,
) (engine.RuntimeStatus, error) {
	status, err := a.engines.StopBackgroundTask(conversationID, taskID)
	if err != nil {
		return engine.RuntimeStatus{}, err
	}
	return a.enrichRuntimeStatus(status), nil
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
