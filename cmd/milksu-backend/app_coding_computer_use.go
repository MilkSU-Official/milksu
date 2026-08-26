package main

import (
	"context"
	"fmt"
	"runtime"
	"time"

	"github.com/MilkSU-Official/milksu/internal/computercap"
)

const codingComputerUseStartTimeout = 16 * time.Second
const linuxPortalComputerUseStartTimeout = 90 * time.Second

func codingComputerUseStartBound() time.Duration {
	if runtime.GOOS == "linux" {
		return linuxPortalComputerUseStartTimeout
	}
	return codingComputerUseStartTimeout
}

func (a *App) GetCodingComputerUseStatus() computercap.Status {
	if a.computerUse == nil {
		return computercap.Status{
			Phase:   "unavailable",
			Problem: "Computer Use service is unavailable.",
		}
	}
	return a.computerUse.Status()
}

func (a *App) PrepareCodingComputerUseDriver(allowBuild bool) (computercap.PrepareResult, error) {
	if a.computerUse == nil {
		return computercap.PrepareResult{
			Version:  computercap.DriverVersion,
			Problem:  "Computer Use service is unavailable.",
			NextStep: "重启 MilkSU 后再试。",
		}, fmt.Errorf("Computer Use service is unavailable")
	}
	prepareContext, cancel := context.WithTimeout(
		a.commandContext(),
		12*time.Minute,
	)
	defer cancel()
	result, err := a.computerUse.Prepare(prepareContext, computercap.PrepareOptions{
		AllowBuild: allowBuild,
	})
	if err != nil {
		return result, err
	}
	a.diagnostics.Record("computer-use", "info", "reviewed Computer Use driver prepared locally")
	return result, nil
}

func (a *App) ActivateCodingComputerUse(conversationID string) computercap.Status {
	status, _, err := a.restoreCodingComputerUse(conversationID)
	if err != nil {
		status.Problem = err.Error()
	}
	return status
}

func (a *App) restoreCodingComputerUse(
	conversationID string,
) (computercap.Status, bool, error) {
	if a.computerUse == nil {
		return computercap.Status{
			Phase:   "unavailable",
			Problem: "Computer Use service is unavailable.",
		}, false, nil
	}
	restoreContext, cancel := context.WithTimeout(
		a.commandContext(),
		codingComputerUseStartBound(),
	)
	defer cancel()
	return a.computerUse.Restore(restoreContext, conversationID)
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
		codingComputerUseStartBound(),
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
		status := a.computerUse.StatusForConversation(conversationID)
		if !status.Authorized {
			return status, fmt.Errorf(
				"Computer Use session does not belong to this Coding task",
			)
		}
		return a.computerUse.Stop(conversationID)
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
