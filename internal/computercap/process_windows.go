//go:build windows

package computercap

import (
	"os"
	"os/exec"
)

func configureProcessGroup(*exec.Cmd) {}

func runtimeRootOwnerMatches(os.FileInfo) bool { return true }

func terminateProcess(command *exec.Cmd, _ bool) {
	if command == nil || command.Process == nil {
		return
	}
	// Computer Use is unavailable on Windows. Keep shutdown deterministic if a
	// future caller reaches this cleanup path without introducing Unix signals.
	_ = command.Process.Kill()
}
