package computercap

import (
	"context"
	"os"
	"strings"

	_ "github.com/godbus/dbus/v5"
)

const (
	linuxPortalBundleID     = "org.freedesktop.portal.Desktop"
	linuxPortalTargetName   = "Desktop"
	linuxPortalWindowID     = 1
	linuxPortalSyntheticPID = 2
	linuxPortalSignature    = "linux-portal"
)

// PortalSession is the GNOME/XDG Desktop Portal host-control surface.
// It is display-level: screenshot, coordinate click, type. Not window scope.
type PortalSession interface {
	Start(ctx context.Context) error
	Screenshot(ctx context.Context) (png []byte, width, height int, err error)
	Click(x, y float64) error
	Type(text string) error
	Key(name string, modifiers []string) error
	Scroll(direction string, amount int) error
	Close() error
}

func linuxGnomeWayland(getenv func(string) string) bool {
	if getenv == nil {
		getenv = os.Getenv
	}
	session := strings.ToLower(strings.TrimSpace(getenv("XDG_SESSION_TYPE")))
	wayland := session == "wayland" || strings.TrimSpace(getenv("WAYLAND_DISPLAY")) != ""
	if !wayland {
		return false
	}
	desktop := strings.ToLower(getenv("XDG_CURRENT_DESKTOP") + ":" + getenv("DESKTOP_SESSION"))
	return strings.Contains(desktop, "gnome")
}

func linuxHyprland(getenv func(string) string) bool {
	if getenv == nil {
		getenv = os.Getenv
	}
	if strings.TrimSpace(getenv("HYPRLAND_INSTANCE_SIGNATURE")) != "" {
		return true
	}
	desktop := strings.ToLower(getenv("XDG_CURRENT_DESKTOP") + ":" + getenv("DESKTOP_SESSION"))
	return strings.Contains(desktop, "hyprland")
}

func linuxPortalDesktopTarget() Target {
	return Target{
		Name:        linuxPortalTargetName,
		BundleID:    linuxPortalBundleID,
		PID:         linuxPortalSyntheticPID,
		WindowID:    linuxPortalWindowID,
		WindowTitle: linuxPortalTargetName,
	}
}

func linuxPortalSigning() SigningStatus {
	return SigningStatus{
		BundleID:       defaultHostBundleID,
		Signature:      linuxPortalSignature,
		StableIdentity: true,
	}
}

func linuxUnavailableProblem(getenv func(string) string) string {
	if linuxHyprland(getenv) {
		return "Computer Use 在 Hyprland 上暂不可用。GNOME 可用系统桌面共享授权；不会走 xinput 摘键鼠。"
	}
	if linuxGnomeWayland(getenv) {
		return ""
	}
	return linuxComputerUseProblem
}
