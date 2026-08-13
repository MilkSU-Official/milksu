package main

import (
	"context"
	"time"

	"github.com/MilkSU-Official/milksu/internal/computercap"
)

// desktopComputerUsePermissionProbe reads Accessibility / Screen Recording from
// the Electron host (systemPreferences). The Go runtime binary is not the TCC
// principal for embedded Computer Use; host attribution is.
func desktopComputerUsePermissionProbe(host desktopHost) func(prompt bool) computercap.Permissions {
	return func(prompt bool) computercap.Permissions {
		if host == nil {
			return computercap.Permissions{}
		}
		// Status / Start must never raise TCC dialogs. Explicit UI actions open
		// System Settings via PermissionOpen instead of prompt=true.
		_ = prompt
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		var result struct {
			Accessibility   bool `json:"accessibility"`
			ScreenRecording bool `json:"screenRecording"`
		}
		if err := host.Call(ctx, "computerUse.permissions", map[string]any{
			"prompt": false,
		}, &result); err != nil {
			// Fail closed: never invent grants when the host probe is unavailable.
			return computercap.Permissions{}
		}
		return computercap.Permissions{
			Accessibility:   result.Accessibility,
			ScreenRecording: result.ScreenRecording,
		}
	}
}

// desktopComputerUsePermissionOpen opens macOS Privacy panes via the Electron
// host. Only the explicit desktop button path may call this.
func desktopComputerUsePermissionOpen(host desktopHost) func(computercap.PermissionKind) {
	return func(permission computercap.PermissionKind) {
		if host == nil {
			return
		}
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = host.Call(ctx, "computerUse.openPermissions", map[string]any{
			"permission": permission,
		}, nil)
	}
}
