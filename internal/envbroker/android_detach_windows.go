//go:build windows

package envbroker

import "os/exec"

func withDetach(command *exec.Cmd) {}
