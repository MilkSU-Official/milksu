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

func TestDesktopComputerUsePermissionOpenCallsHost(t *testing.T) {
	host := &stubDesktopHost{}
	open := desktopComputerUsePermissionOpen(host)
	open(computercap.Permissions{Accessibility: true, ScreenRecording: false})
	if len(host.calls) != 1 || host.calls[0] != "computerUse.openPermissions" {
		t.Fatalf("unexpected host calls: %#v", host.calls)
	}
	payload, _ := host.payload.(map[string]any)
	if payload["accessibility"] != true || payload["screenRecording"] != false {
		t.Fatalf("unexpected open payload: %#v", payload)
	}
}
