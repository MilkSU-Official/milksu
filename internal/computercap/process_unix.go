//go:build !windows

package computercap

import (
	"context"
	"fmt"
	"net"
	"os"
	"os/exec"
	"syscall"
	"time"
)

func platformHostExecutable(int) string { return "" }

func driverExecutableName(string) string { return "cua-driver" }

func waitForEndpoint(ctx context.Context, _ string, path string, exited <-chan error) error {
	ticker := time.NewTicker(40 * time.Millisecond)
	defer ticker.Stop()
	for {
		connection, err := net.DialTimeout("unix", path, 80*time.Millisecond)
		if err == nil {
			_ = connection.Close()
			return nil
		}
		select {
		case processError, open := <-exited:
			if !open || processError == nil {
				return fmt.Errorf("driver stopped before opening its private socket")
			}
			return processError
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
		}
	}
}

func configureProcessGroup(command *exec.Cmd) {
	command.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
}

func runtimeRootOwnerMatches(info os.FileInfo) bool {
	stat, known := info.Sys().(*syscall.Stat_t)
	return !known || int(stat.Uid) == os.Getuid()
}

func terminateProcess(command *exec.Cmd, force bool) {
	if command == nil || command.Process == nil {
		return
	}
	signal := syscall.SIGTERM
	if force {
		signal = syscall.SIGKILL
	}
	if err := syscall.Kill(-command.Process.Pid, signal); err != nil {
		if force {
			_ = command.Process.Kill()
		} else {
			_ = command.Process.Signal(signal)
		}
	}
}
