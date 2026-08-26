//go:build windows

package computercap

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"
	"unsafe"
)

var (
	kernel32      = syscall.NewLazyDLL("kernel32.dll")
	waitNamedPipe = kernel32.NewProc("WaitNamedPipeW")
)

func platformHostExecutable(pid int) string {
	if pid <= 1 {
		return ""
	}
	return processExecutablePath(uint32(pid))
}

func driverExecutableName(string) string { return "cua-driver.exe" }

func waitForEndpoint(ctx context.Context, _ string, path string, exited <-chan error) error {
	pathPointer, err := syscall.UTF16PtrFromString(path)
	if err != nil {
		return fmt.Errorf("invalid Computer Use named pipe: %w", err)
	}
	ticker := time.NewTicker(40 * time.Millisecond)
	defer ticker.Stop()
	for {
		ready, _, _ := waitNamedPipe.Call(uintptr(unsafe.Pointer(pathPointer)), 80)
		if ready != 0 {
			return nil
		}
		select {
		case processError, open := <-exited:
			if !open || processError == nil {
				return fmt.Errorf("driver stopped before opening its private named pipe")
			}
			return processError
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
		}
	}
}

func configureProcessGroup(command *exec.Cmd) {
	command.SysProcAttr = &syscall.SysProcAttr{CreationFlags: syscall.CREATE_NEW_PROCESS_GROUP}
}

func runtimeRootOwnerMatches(os.FileInfo) bool { return true }

func terminateProcess(command *exec.Cmd, force bool) {
	if command == nil || command.Process == nil {
		return
	}
	systemRoot := strings.TrimSpace(os.Getenv("SystemRoot"))
	if systemRoot == "" {
		systemRoot = `C:\Windows`
	}
	taskkill := filepath.Join(systemRoot, "System32", "taskkill.exe")
	arguments := []string{"/PID", strconv.Itoa(command.Process.Pid), "/T"}
	if force {
		arguments = append(arguments, "/F")
	}
	if err := exec.Command(taskkill, arguments...).Run(); err != nil {
		_ = command.Process.Kill()
	}
}
