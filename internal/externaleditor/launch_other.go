//go:build !windows

package externaleditor

import "os/exec"

func configureLaunch(*exec.Cmd) {}
