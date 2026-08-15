//go:build !windows

package appdata

import "syscall"

func noFollowOpenFlag() int { return syscall.O_NOFOLLOW }
