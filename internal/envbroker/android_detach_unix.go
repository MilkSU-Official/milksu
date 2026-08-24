//go:build unix

package envbroker

import (
	"os/exec"
	"syscall"
)

func withDetach(command *exec.Cmd) {
	command.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
}
