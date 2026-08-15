//go:build !windows

package computercap

import (
	"os"
	"os/exec"
	"syscall"
)

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
