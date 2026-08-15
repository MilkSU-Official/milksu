//go:build windows

package appdata

// Windows does not expose a direct os.OpenFile equivalent of O_NOFOLLOW.
// Callers already lstat the private app-owned path and reject symlinks before
// opening; return no additional platform flag here.
func noFollowOpenFlag() int { return 0 }
