package computercap

import (
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/MilkSU-Official/milksu/internal/hostpath"
)

func TestLinuxComputerUseStaysUnavailableWithoutPortal(t *testing.T) {
	manager := New(Options{
		GOOS:            "linux",
		GrantDirectory:  t.TempDir(),
		LinuxPortal:     func() bool { return false },
		PermissionProbe: func(bool) Permissions { return Permissions{} },
		PermissionOpen:  func(PermissionKind) {},
		SigningProbe:    func() SigningStatus { return SigningStatus{} },
		TargetProvider:  func() ([]Target, error) { return nil, nil },
	})
	defer manager.Close()
	status := manager.Status()
	if status.Available || status.Phase != "unavailable" {
		t.Fatalf("Linux Computer Use without portal must stay unavailable: %#v", status)
	}
	if !strings.Contains(status.Problem, "Linux") && !strings.Contains(status.Problem, "不可用") {
		t.Fatalf("Linux unavailable copy = %q", status.Problem)
	}
	prepared, err := manager.Prepare(t.Context(), PrepareOptions{})
	if err == nil || prepared.Ready {
		t.Fatalf("Linux Prepare without portal must not claim ready: %#v %v", prepared, err)
	}
}

func TestLinuxComputerUseSocketUsesHostpath(t *testing.T) {
	sessionID := "computer_0123456789abcdef0123456789abcdef"
	got := endpointForSession("linux", filepath.Join(hostpath.ComputerUseRuntimeRoot(), sessionID), sessionID)
	want := hostpath.ComputerUseSocket(runtime.GOOS, sessionID)
	if got != want {
		t.Fatalf("linux socket = %q, want hostpath %q", got, want)
	}
	if strings.Contains(got, "/private/tmp/milksu-computer-use") || strings.HasPrefix(got, "/tmp/milksu-computer-use/") {
		t.Fatalf("linux socket still hardcodes a temp root: %q", got)
	}
}
