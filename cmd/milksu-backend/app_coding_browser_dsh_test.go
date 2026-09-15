package main

import (
	"errors"
	"testing"

	"github.com/MilkSU-Official/milksu/internal/engine"
)

func TestResolveInteractiveCodingBrowserPiReusesWithoutEnsure(t *testing.T) {
	ensured := 0
	descriptor, err := resolveInteractiveCodingBrowser(
		engine.KernelPi,
		"go",
		"workspace-auto",
		func() error {
			ensured++
			return nil
		},
		func() (*engine.CodingBrowserDescriptor, bool) {
			return nil, false
		},
	)
	if err != nil {
		t.Fatalf("pi reuse: %v", err)
	}
	if descriptor != nil {
		t.Fatalf("pi without an open rail must not invent a descriptor: %#v", descriptor)
	}
	if ensured != 0 {
		t.Fatalf("pi send must not Ensure Chromium, calls=%d", ensured)
	}
}

func TestResolveInteractiveCodingBrowserDSHEnsuresBeforeAttach(t *testing.T) {
	ensured := 0
	descriptor, err := resolveInteractiveCodingBrowser(
		"deepseek-harness",
		"go",
		"workspace-auto",
		func() error {
			ensured++
			return nil
		},
		func() (*engine.CodingBrowserDescriptor, bool) {
			return &engine.CodingBrowserDescriptor{
				SessionID:   "browser_dsh",
				CDPEndpoint: "http://127.0.0.1:9333",
			}, true
		},
	)
	if err != nil {
		t.Fatalf("dsh ensure: %v", err)
	}
	if ensured != 1 {
		t.Fatalf("dsh send must Ensure once, calls=%d", ensured)
	}
	if descriptor == nil || descriptor.CDPEndpoint != "http://127.0.0.1:9333" {
		t.Fatalf("dsh descriptor = %#v", descriptor)
	}
}

func TestResolveInteractiveCodingBrowserDSHFailsClosedWithoutCDP(t *testing.T) {
	_, err := resolveInteractiveCodingBrowser(
		engine.KernelDSH,
		"go",
		"ask",
		func() error { return nil },
		func() (*engine.CodingBrowserDescriptor, bool) { return nil, false },
	)
	if err == nil {
		t.Fatal("expected DSH send to fail when CDP is missing")
	}
}

func TestResolveInteractiveCodingBrowserDSHEnsureErrorStopsSend(t *testing.T) {
	want := errors.New("browser down")
	_, err := resolveInteractiveCodingBrowser(
		engine.KernelDSH,
		"go",
		"full-auto",
		func() error { return want },
		func() (*engine.CodingBrowserDescriptor, bool) {
			t.Fatal("lookup must not run after ensure fails")
			return nil, false
		},
	)
	if !errors.Is(err, want) {
		t.Fatalf("ensure error = %v", err)
	}
}

func TestResolveInteractiveCodingBrowserSkipsPlanAndReadOnly(t *testing.T) {
	ensured := 0
	ensure := func() error {
		ensured++
		return nil
	}
	for _, policy := range []struct {
		kernel   string
		mode     string
		approval string
	}{
		{engine.KernelDSH, "plan", "workspace-auto"},
		{engine.KernelDSH, "go", "read-only"},
		{engine.KernelPi, "plan", "ask"},
	} {
		descriptor, err := resolveInteractiveCodingBrowser(
			policy.kernel,
			policy.mode,
			policy.approval,
			ensure,
			func() (*engine.CodingBrowserDescriptor, bool) {
				t.Fatalf("lookup must not run for %s %s %s", policy.kernel, policy.mode, policy.approval)
				return nil, false
			},
		)
		if err != nil || descriptor != nil {
			t.Fatalf("%s %s %s = (%#v, %v)", policy.kernel, policy.mode, policy.approval, descriptor, err)
		}
	}
	if ensured != 0 {
		t.Fatalf("plan/read-only must not Ensure, calls=%d", ensured)
	}
}
