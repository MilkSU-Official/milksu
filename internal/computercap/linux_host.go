package computercap

import (
	"context"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"time"
)

func (manager *Manager) attachLinuxHostSession(
	ctx context.Context,
	conversationID string,
	host PortalSession,
	target Target,
	timeout time.Duration,
	startFail func(error) error,
) (Status, error) {
	if timeout <= 0 {
		timeout = manager.startTimeout
	}
	hostCtx, cancel := context.WithTimeout(ctx, timeout)
	if err := host.Start(hostCtx); err != nil {
		cancel()
		_ = host.Close()
		if startFail != nil {
			return manager.Status(), startFail(err)
		}
		return manager.Status(), err
	}
	sessionID, err := newSessionID()
	if err != nil {
		cancel()
		_ = host.Close()
		return manager.Status(), err
	}
	runtimeDirectoryRoot := runtimeRootForPlatform(manager.goos)
	directory := filepath.Join(runtimeDirectoryRoot, sessionID)
	if err := createRuntimeDirectory(runtimeDirectoryRoot, directory); err != nil {
		cancel()
		_ = host.Close()
		return manager.Status(), err
	}
	socketPath := endpointForSession(manager.goos, directory, sessionID)
	cleanupEndpoint(manager.goos, socketPath)
	listener, err := net.Listen("unix", socketPath)
	if err != nil {
		cancel()
		_ = host.Close()
		_ = cleanupRuntimeDirectory(runtimeDirectoryRoot, directory)
		return manager.Status(), fmt.Errorf("listen Linux Computer Use socket: %w", err)
	}
	if err := os.Chmod(socketPath, 0o600); err != nil {
		_ = listener.Close()
		cancel()
		_ = host.Close()
		_ = cleanupRuntimeDirectory(runtimeDirectoryRoot, directory)
		return manager.Status(), err
	}
	done := make(chan error, 1)
	serveCtx, serveCancel := context.WithCancel(context.Background())
	go func() {
		done <- servePortalDriver(serveCtx, listener, host, target)
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
		portal:         host,
		portalCancel:   func() { serveCancel(); cancel() },
		listener:       listener,
	}
	manager.mu.Lock()
	if manager.active != nil {
		manager.mu.Unlock()
		active.portalCancel()
		_ = listener.Close()
		_ = host.Close()
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
