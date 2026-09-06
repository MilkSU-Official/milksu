package computercap

import (
	"context"
	"fmt"
	"time"
)

func (manager *Manager) startLinuxPortal(
	ctx context.Context,
	conversationID string,
	selection TargetSelection,
) (Status, error) {
	if !manager.linuxPortal() {
		status := manager.Status()
		return status, fmt.Errorf("%s", status.Problem)
	}
	target := linuxPortalDesktopTarget()
	if selection.PID != 0 && selection.WindowID != 0 &&
		(selection.PID != target.PID || selection.WindowID != target.WindowID) {
		return manager.Status(), fmt.Errorf("Linux Computer Use 锁定整桌面，不能选择单个窗口")
	}
	portal, err := manager.newPortal()
	if err != nil {
		return manager.Status(), fmt.Errorf("open desktop portal: %w", err)
	}
	timeout := manager.startTimeout
	if timeout < 90*time.Second {
		timeout = 90 * time.Second
	}
	return manager.attachLinuxHostSession(
		ctx,
		conversationID,
		portal,
		target,
		timeout,
		func(err error) error {
			return fmt.Errorf("GNOME 桌面共享未授权或已取消：%w", err)
		},
	)
}
