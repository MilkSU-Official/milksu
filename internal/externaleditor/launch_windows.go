//go:build windows

package externaleditor

import (
	"os/exec"
	"syscall"
)

func configureLaunch(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
}
