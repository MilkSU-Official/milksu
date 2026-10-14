package computercap

import "os"

// ProbePermissions reports Accessibility / Screen Recording for this process.
// Callers that own the Electron TCC principal should probe the host instead.
func ProbePermissions(prompt bool) Permissions {
	return platformPermissions(prompt)
}

// ListPlatformWindows returns the OS-visible window list. The session layer
// still filters out the host identity.
func ListPlatformWindows() ([]Target, error) {
	return platformTargets()
}

// RequestPlatformPermission opens the OS permission surface. On Darwin this
// is System Settings; Windows and Linux are no-ops.
func RequestPlatformPermission(kind PermissionKind) {
	platformRequestPermissions(kind)
}

// ProbeSigning reports the current binary's code-signing identity.
func ProbeSigning() SigningStatus {
	return platformSigningStatus()
}

// HostExecutable returns the absolute image path for pid on Windows.
func HostExecutable(pid int) string {
	return platformHostExecutable(pid)
}

// LinuxDesktopInfo is the GNOME Portal availability probe.
type LinuxDesktopInfo struct {
	Available bool   `json:"available"`
	Problem   string `json:"problem,omitempty"`
}

// ProbeLinuxDesktop reports whether this Linux session can use Portal.
func ProbeLinuxDesktop() LinuxDesktopInfo {
	if linuxGnomeWayland(os.Getenv) {
		return LinuxDesktopInfo{Available: true}
	}
	return LinuxDesktopInfo{
		Available: false,
		Problem:   linuxUnavailableProblem(os.Getenv),
	}
}

// LinuxDesktopTarget is the synthetic whole-desktop Portal target.
func LinuxDesktopTarget() Target {
	return linuxPortalDesktopTarget()
}

// LinuxDesktopSigning is the Portal signing projection.
func LinuxDesktopSigning() SigningStatus {
	return linuxPortalSigning()
}
