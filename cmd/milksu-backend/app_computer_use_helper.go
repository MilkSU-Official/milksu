package main

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/MilkSU-Official/milksu/internal/computercap"
)

func (a *App) ComputerUseAccessibilityStatus() computercap.Permissions {
	if a != nil && a.host != nil {
		return desktopComputerUsePermissionProbe(a.host)(false)
	}
	return computercap.ProbePermissions(false)
}

func (a *App) ComputerUseListWindows() ([]computercap.Target, error) {
	return computercap.ListPlatformWindows()
}

func (a *App) ComputerUseRequestScreenRecording() error {
	return a.requestComputerUsePermission(computercap.PermissionScreenRecording)
}

func (a *App) ComputerUseRequestAccessibility() error {
	return a.requestComputerUsePermission(computercap.PermissionAccessibility)
}

func (a *App) requestComputerUsePermission(kind computercap.PermissionKind) error {
	if _, err := computercap.ParsePermissionKind(string(kind)); err != nil {
		return err
	}
	if a != nil && a.host != nil {
		desktopComputerUsePermissionOpen(a.host)(kind)
		return nil
	}
	computercap.RequestPlatformPermission(kind)
	return nil
}

func (a *App) ComputerUseSigningStatus() computercap.SigningStatus {
	return computercap.ProbeSigning()
}

func (a *App) ComputerUseHostExecutable(pid int) string {
	return computercap.HostExecutable(pid)
}

func (a *App) ComputerUseLinuxDesktop() computercap.LinuxDesktopInfo {
	return computercap.ProbeLinuxDesktop()
}

func (a *App) ComputerUseStartPortal(socketPath string) error {
	socketPath = strings.TrimSpace(socketPath)
	if socketPath == "" {
		return fmt.Errorf("Computer Use portal socket is required")
	}
	if a.portalServer == nil {
		a.portalServer = &computercap.PortalServer{}
	}
	ctx := a.commandContext()
	if ctx == nil {
		ctx = context.Background()
	}
	startCtx, cancel := context.WithTimeout(ctx, 90*time.Second)
	defer cancel()
	return a.portalServer.Start(startCtx, socketPath)
}

func (a *App) ComputerUseStopPortal() error {
	if a.portalServer == nil {
		return nil
	}
	return a.portalServer.Stop()
}
