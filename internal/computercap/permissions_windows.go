//go:build windows

package computercap

// Windows exposes UI Automation, SendInput, and Windows Graphics Capture to
// an ordinary interactive user without macOS-style TCC grants. Higher-
// integrity windows remain deliberately out of scope.
func platformPermissions(bool) Permissions {
	return Permissions{Accessibility: true, ScreenRecording: true}
}

func platformRequestPermissions(PermissionKind) {}
