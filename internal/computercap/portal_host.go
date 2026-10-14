package computercap

import (
	"context"
	"fmt"
	"net"
	"os"
	"runtime"
	"sync"
	"time"
)

// PortalServer is the Linux XDG Desktop Portal session plus the private
// JSONL socket. Session grants and conversation scoping stay in the Runtime.
type PortalServer struct {
	mu       sync.Mutex
	session  PortalSession
	listener net.Listener
	cancel   context.CancelFunc
	done     chan error
}

// Start opens a Portal session and serves the Computer Use JSONL socket.
func (server *PortalServer) Start(ctx context.Context, socketPath string) error {
	if server == nil {
		return fmt.Errorf("Computer Use portal is unavailable")
	}
	server.mu.Lock()
	defer server.mu.Unlock()
	if server.session != nil {
		return fmt.Errorf("Computer Use portal is already running")
	}
	portal, err := newXDGPortalSession()
	if err != nil {
		return err
	}
	timeout := 90 * time.Second
	portalCtx, cancel := context.WithTimeout(ctx, timeout)
	if err := portal.Start(portalCtx); err != nil {
		cancel()
		_ = portal.Close()
		return fmt.Errorf("GNOME 桌面共享未授权或已取消：%w", err)
	}
	cleanupEndpoint(runtime.GOOS, socketPath)
	listener, err := net.Listen("unix", socketPath)
	if err != nil {
		cancel()
		_ = portal.Close()
		return fmt.Errorf("listen portal Computer Use socket: %w", err)
	}
	if err := os.Chmod(socketPath, 0o600); err != nil {
		_ = listener.Close()
		cancel()
		_ = portal.Close()
		return err
	}
	done := make(chan error, 1)
	serveCtx, serveCancel := context.WithCancel(context.Background())
	go func() {
		done <- servePortalDriver(serveCtx, listener, portal, linuxPortalDesktopTarget())
	}()
	server.session = portal
	server.listener = listener
	server.cancel = func() { serveCancel(); cancel() }
	server.done = done
	return nil
}

// Stop ends the Portal session and closes the JSONL socket.
func (server *PortalServer) Stop() error {
	if server == nil {
		return nil
	}
	server.mu.Lock()
	session := server.session
	listener := server.listener
	cancel := server.cancel
	done := server.done
	server.session = nil
	server.listener = nil
	server.cancel = nil
	server.done = nil
	server.mu.Unlock()
	if cancel != nil {
		cancel()
	}
	if listener != nil {
		_ = listener.Close()
	}
	if session != nil {
		_ = session.Close()
	}
	if done != nil {
		select {
		case <-done:
		case <-time.After(time.Second):
		}
	}
	return nil
}
