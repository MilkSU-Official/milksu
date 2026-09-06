package computercap

import (
	"context"
	"fmt"
	"time"
)

func (manager *Manager) startLinuxHyprland(
	ctx context.Context,
	conversationID string,
	selection TargetSelection,
) (Status, error) {
	if !manager.linuxHyprland() {
		status := manager.Status()
		return status, fmt.Errorf("%s", status.Problem)
	}
	if err := manager.linuxHyprlandTools(); err != nil {
		return manager.Status(), err
	}
	target := linuxHyprlandDesktopTarget()
	if selection.PID != 0 && selection.WindowID != 0 &&
		(selection.PID != target.PID || selection.WindowID != target.WindowID) {
		return manager.Status(), fmt.Errorf("Hyprland Computer Use 锁定整块桌面，不是单个窗口，也不能改走 GNOME Portal")
	}
	host, err := manager.newHyprland()
	if err != nil {
		return manager.Status(), fmt.Errorf("open Hyprland Computer Use: %w", err)
	}
	timeout := manager.startTimeout
	if timeout < 20*time.Second {
		timeout = 20 * time.Second
	}
	return manager.attachLinuxHostSession(
		ctx,
		conversationID,
		host,
		target,
		timeout,
		func(err error) error {
			return fmt.Errorf("Hyprland Computer Use 未能启动：%w", err)
		},
	)
}
