package main

import (
	"context"
	"fmt"
	"time"

	"github.com/MilkSU-Official/milksu/internal/computercap"
)

const codingComputerUseStartTimeout = 16 * time.Second

func (a *App) GetCodingComputerUseStatus() computercap.Status {
	if a.computerUse == nil {
		return computercap.Status{
			Phase:   "unavailable",
			Problem: "Computer Use service is unavailable.",
		}
	}
	return a.computerUse.Status()
}

// RequestCodingComputerUsePermissions is called only from the explicit
// desktop button. Agent turns and Workspace Auto never reach this method.
func (a *App) RequestCodingComputerUsePermissions(permission string) (computercap.Status, error) {
	if a.computerUse == nil {
		return computercap.Status{
			Phase:   "unavailable",
			Problem: "Computer Use service is unavailable.",
		}, nil
	}
	kind, err := computercap.ParsePermissionKind(permission)
	if err != nil {
		return a.computerUse.Status(), err
	}
	status, err := a.computerUse.RequestPermission(kind)
	if err != nil {
		return status, err
	}
	a.diagnostics.Record("computer-use", "info", "host permission state refreshed")
	return status, nil
}

func (a *App) ListCodingComputerUseTargets() ([]computercap.Target, error) {
	if a.computerUse == nil {
		return nil, fmt.Errorf("Computer Use service is unavailable")
	}
	return a.computerUse.Targets()
}

func (a *App) StartCodingComputerUse(
	conversationID string,
	targetPID int,
	targetWindowID int64,
) (computercap.Status, error) {
	if a.computerUse == nil {
		return computercap.Status{}, fmt.Errorf("Computer Use service is unavailable")
	}
	startContext, cancel := context.WithTimeout(
		a.commandContext(),
		codingComputerUseStartTimeout,
	)
	defer cancel()
	status, err := a.computerUse.Start(
		startContext,
		conversationID,
		computercap.TargetSelection{PID: targetPID, WindowID: targetWindowID},
	)
	if err != nil {
		return status, err
	}
	a.diagnostics.Record(
		"computer-use",
		"info",
		"visible scoped Computer Use session started",
	)
	return status, nil
}

func (a *App) StopCodingComputerUse(
	conversationID string,
) (computercap.Status, error) {
	if a.computerUse == nil {
		return computercap.Status{}, fmt.Errorf("Computer Use service is unavailable")
	}
	if !a.computerUse.OwnsConversation(conversationID) {
		return a.computerUse.Status(), fmt.Errorf(
			"Computer Use session does not belong to this Coding task",
		)
	}
	// Dispose the MCP client before ending the host-owned daemon. Pending
	// approvals expire with the Sidecar session and unknown actions are never
	// replayed after a stop.
	a.engines.DetachSession(conversationID)
	status, err := a.computerUse.Stop(conversationID)
	if err != nil {
		return status, err
	}
	a.diagnostics.Record("computer-use", "info", "visible Computer Use session stopped")
	return status, nil
}
