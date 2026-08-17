package main

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"testing"

	"github.com/MilkSU-Official/milksu/internal/computercap"
)

type stubDesktopHost struct {
	mu      sync.Mutex
	calls   []string
	payload any
	result  any
	err     error
}

func (h *stubDesktopHost) Emit(string, any) {}

func (h *stubDesktopHost) Call(_ context.Context, method string, payload, result any) error {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.calls = append(h.calls, method)
	h.payload = payload
	if h.err != nil {
		return h.err
	}
	if result == nil || h.result == nil {
		return nil
	}
	raw, err := json.Marshal(h.result)
	if err != nil {
		return err
	}
	return json.Unmarshal(raw, result)
}

func TestDesktopComputerUsePermissionProbeUsesHostAndFailsClosed(t *testing.T) {
	host := &stubDesktopHost{
		result: map[string]bool{
			"accessibility":   true,
			"screenRecording": true,
		},
	}
	probe := desktopComputerUsePermissionProbe(host)
	got := probe(true) // prompt flag must not invent a host prompt path
	if !got.Ready() {
		t.Fatalf("expected host grants, got %#v", got)
	}
	if len(host.calls) != 1 || host.calls[0] != "computerUse.permissions" {
		t.Fatalf("unexpected host calls: %#v", host.calls)
	}
	payload, _ := host.payload.(map[string]any)
	if payload["prompt"] != false {
		t.Fatalf("probe must force prompt=false, got %#v", payload)
	}

	host.err = errors.New("host down")
	host.calls = nil
	got = desktopComputerUsePermissionProbe(host)(false)
	if got.Accessibility || got.ScreenRecording {
		t.Fatalf("host failure must fail closed, got %#v", got)
	}
}

func TestDesktopComputerUseHostPIDUsesOnlyValidEnvironmentValue(t *testing.T) {
	t.Setenv(desktopHostPIDEnv, "4321")
	if got := desktopComputerUseHostPID(); got != 4321 {
		t.Fatalf("desktop host PID = %d, want 4321", got)
	}

	for _, value := range []string{"", "not-a-pid", "1", "-7"} {
		t.Setenv(desktopHostPIDEnv, value)
		if got := desktopComputerUseHostPID(); got != 0 {
			t.Fatalf("desktop host PID for %q = %d, want 0", value, got)
		}
	}
}

func TestDesktopComputerUsePermissionOpenCallsHost(t *testing.T) {
	host := &stubDesktopHost{}
	open := desktopComputerUsePermissionOpen(host)
	open(computercap.PermissionScreenRecording)
	if len(host.calls) != 1 || host.calls[0] != "computerUse.openPermissions" {
		t.Fatalf("unexpected host calls: %#v", host.calls)
	}
	payload, _ := host.payload.(map[string]any)
	if payload["permission"] != computercap.PermissionScreenRecording {
		t.Fatalf("unexpected open payload: %#v", payload)
	}
}

func TestRelaunchDesktopAppDelegatesToElectronHost(t *testing.T) {
	host := &stubDesktopHost{result: true}
	app := &App{host: host}
	started, err := app.RelaunchDesktopApp()
	if err != nil {
		t.Fatalf("relaunch desktop app: %v", err)
	}
	if !started {
		t.Fatal("desktop host did not acknowledge relaunch")
	}
	if len(host.calls) != 1 || host.calls[0] != "app.relaunch" {
		t.Fatalf("unexpected host calls: %#v", host.calls)
	}
}
