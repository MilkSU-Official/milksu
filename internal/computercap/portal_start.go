package computercap

import (
	"context"
	"fmt"
	"net"
	"os"
	"path/filepath"
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
	portalCtx, cancel := context.WithTimeout(ctx, timeout)
	if err := portal.Start(portalCtx); err != nil {
		cancel()
		_ = portal.Close()
		return manager.Status(), fmt.Errorf("GNOME 桌面共享未授权或已取消：%w", err)
	}
	sessionID, err := newSessionID()
	if err != nil {
		cancel()
		_ = portal.Close()
		return manager.Status(), err
	}
	runtimeDirectoryRoot := runtimeRootForPlatform(manager.goos)
	directory := filepath.Join(runtimeDirectoryRoot, sessionID)
	if err := createRuntimeDirectory(runtimeDirectoryRoot, directory); err != nil {
		cancel()
		_ = portal.Close()
		return manager.Status(), err
	}
	socketPath := endpointForSession(manager.goos, directory, sessionID)
	cleanupEndpoint(manager.goos, socketPath)
	listener, err := net.Listen("unix", socketPath)
	if err != nil {
		cancel()
		_ = portal.Close()
		_ = cleanupRuntimeDirectory(runtimeDirectoryRoot, directory)
		return manager.Status(), fmt.Errorf("listen portal Computer Use socket: %w", err)
	}
	if err := os.Chmod(socketPath, 0o600); err != nil {
		_ = listener.Close()
		cancel()
		_ = portal.Close()
		_ = cleanupRuntimeDirectory(runtimeDirectoryRoot, directory)
		return manager.Status(), err
	}
	done := make(chan error, 1)
	serveCtx, serveCancel := context.WithCancel(context.Background())
	go func() {
		done <- servePortalDriver(serveCtx, listener, portal, target)
	}()
	active := &session{
		conversationID: conversationID,
		sessionID:      sessionID,
		socketPath:     socketPath,
		directory:      directory,
		startedAt:      time.Now().UTC(),
		done:           done,
		phase:          "ready",
		target:         target,
		portal:         portal,
		portalCancel:   func() { serveCancel(); cancel() },
		listener:       listener,
	}
	manager.mu.Lock()
	if manager.active != nil {
		manager.mu.Unlock()
		active.portalCancel()
		_ = listener.Close()
		_ = portal.Close()
		_ = cleanupRuntimeDirectory(runtimeDirectoryRoot, directory)
		return manager.Status(), fmt.Errorf("Computer Use is already attached to another visible Coding task")
	}
	manager.active = active
	status := manager.statusLocked(Permissions{Accessibility: true, ScreenRecording: true})
	manager.mu.Unlock()
	if err := manager.grants.Save(conversationID, status.Target); err != nil {
		_, _ = manager.stop(conversationID, false)
		return manager.StatusForConversation(conversationID), err
	}
	status.Authorized = true
	granted := status.Target
	status.GrantedTarget = &granted
	return status, nil
}
