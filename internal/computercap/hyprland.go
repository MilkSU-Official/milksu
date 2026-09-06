package computercap

// Hyprland Computer Use is a separate Linux host backend from GNOME's
// XDG Desktop Portal path. xdg-desktop-portal-hyprland does not provide a
// dependable RemoteDesktop surface, so this backend uses compositor-native
// tools instead of pretending to be Portal window-scope:
//
//   hyprctl notify / monitors / movecursor
//   grim screenshots
//   wtype virtual keyboard
//   zwlr_virtual_pointer_v1 clicks and scrolls
//
// Community hypruse documents the same stack. MilkSU does not vendor that
// Python MCP server: it is a different product contract, and Computer Use
// already has a reviewed host-socket protocol. Cua Linux installers and
// xinput/uinput remain rejected (ISSUE #19).

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

const (
	linuxHyprlandBundleID     = "org.hyprland.ComputerUse"
	linuxHyprlandTargetName   = "Hyprland"
	linuxHyprlandWindowID     = 1
	linuxHyprlandSyntheticPID = 3
	linuxHyprlandSignature    = "linux-hyprland"

	linuxHyprlandPrepareNextStep = "启动 Computer Use 时，Hyprland 会显示桌面通知。截屏、按坐标点击和打字走合成器原生输入，不是 GNOME Portal，也不是单个窗口。"
	linuxHyprlandToolsNextStep   = "用发行版软件包安装 grim 与 wtype。Arch/Omarchy：pacman -S grim wtype。hyprctl 随 Hyprland。不要运行 Cua 官方安装脚本，也不要使用 xinput。"
)

var hyprlandRequiredTools = []string{"hyprctl", "grim", "wtype"}

func linuxHyprlandDesktopTarget() Target {
	return Target{
		Name:        linuxHyprlandTargetName,
		BundleID:    linuxHyprlandBundleID,
		PID:         linuxHyprlandSyntheticPID,
		WindowID:    linuxHyprlandWindowID,
		WindowTitle: linuxHyprlandTargetName,
	}
}

func linuxHyprlandSigning() SigningStatus {
	return SigningStatus{
		BundleID:       defaultHostBundleID,
		Signature:      linuxHyprlandSignature,
		StableIdentity: true,
	}
}

func defaultHyprlandTools() error {
	return linuxHyprlandToolsReady(exec.LookPath)
}

func linuxHyprlandToolsReady(lookPath func(string) (string, error)) error {
	if lookPath == nil {
		lookPath = exec.LookPath
	}
	missing := make([]string, 0, len(hyprlandRequiredTools))
	for _, name := range hyprlandRequiredTools {
		if forbiddenHostTool(name) {
			return fmt.Errorf("Hyprland Computer Use 拒绝调用 %s", name)
		}
		if _, err := lookPath(name); err != nil {
			missing = append(missing, name)
		}
	}
	if len(missing) == 0 {
		return nil
	}
	return fmt.Errorf("%s", linuxHyprlandToolsProblem(missing))
}

func linuxHyprlandToolsProblem(missing []string) string {
	if len(missing) == 0 {
		missing = hyprlandRequiredTools
	}
	return "Computer Use 在 Hyprland 上还缺少 " + strings.Join(missing, "、") +
		"。用发行版软件包安装 grim 与 wtype（hyprctl 随 Hyprland）。走合成器原生输入，不是 GNOME Portal。不会走 xinput，也不接 Cua。"
}

func forbiddenHostTool(name string) bool {
	base := strings.ToLower(filepath.Base(strings.TrimSpace(name)))
	switch base {
	case "xinput", "ydotool", "dotool", "evemu-event":
		return true
	}
	return strings.Contains(base, "uinput")
}

func hyprlandWaylandSocket(getenv func(string) string) (string, error) {
	if getenv == nil {
		getenv = os.Getenv
	}
	display := strings.TrimSpace(getenv("WAYLAND_DISPLAY"))
	if display == "" {
		display = "wayland-1"
	}
	if filepath.IsAbs(display) {
		return display, nil
	}
	runtimeDir := strings.TrimSpace(getenv("XDG_RUNTIME_DIR"))
	if runtimeDir == "" {
		return "", fmt.Errorf("当前没有 XDG_RUNTIME_DIR，无法连接 Hyprland Wayland 显示")
	}
	return filepath.Join(runtimeDir, display), nil
}
