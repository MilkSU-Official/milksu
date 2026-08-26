package computercap

import (
	"strings"
	"testing"
)

func TestLinuxComputerUseStaysUnavailableWithoutHostControl(t *testing.T) {
	manager := New(Options{
		GOOS:            "linux",
		GrantDirectory:  t.TempDir(),
		PermissionProbe: func(bool) Permissions { return Permissions{} },
		PermissionOpen:  func(PermissionKind) {},
		SigningProbe:    func() SigningStatus { return SigningStatus{} },
		TargetProvider:  func() ([]Target, error) { return nil, nil },
	})
	defer manager.Close()
	status := manager.Status()
	if status.Available || status.Phase != "unavailable" {
		t.Fatalf("Linux Computer Use must stay unavailable: %#v", status)
	}
	if !strings.Contains(status.Problem, "Linux") || !strings.Contains(status.Problem, "不控制宿主桌面") {
		t.Fatalf("Linux unavailable copy = %q", status.Problem)
	}
	prepared, err := manager.Prepare(t.Context(), PrepareOptions{})
	if err == nil || prepared.Ready {
		t.Fatalf("Linux Prepare must not install a host-control driver: %#v %v", prepared, err)
	}
	if prepared.Problem != linuxComputerUseProblem {
		t.Fatalf("Prepare problem = %q", prepared.Problem)
	}
}
