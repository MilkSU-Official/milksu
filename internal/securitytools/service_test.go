package securitytools

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/MilkSU-Official/milksu/internal/config"
)

type testSettings struct {
	value config.AppSettings
}

func (s *testSettings) Get() config.AppSettings { return s.value }
func (s *testSettings) SetSecurityToolEnabled(id string, enabled bool) error {
	if s.value.SecurityTools == nil {
		s.value.SecurityTools = make(map[string]config.SecurityToolPreference)
	}
	s.value.SecurityTools[id] = config.SecurityToolPreference{Enabled: enabled}
	return nil
}

type testProbe struct{}

func (testProbe) LookPath(string) (string, error) { return "", os.ErrNotExist }
func (testProbe) Output(context.Context, string, ...string) (string, error) {
	return "", os.ErrNotExist
}

func TestCapaIsUnavailableOutsideSupportedMacOS(t *testing.T) {
	service := NewService(t.TempDir(), &testSettings{value: config.DefaultSettings()}, nil)
	service.probe = testProbe{}
	for _, platform := range []struct {
		goos   string
		goarch string
	}{
		{goos: "linux", goarch: "amd64"},
		{goos: "windows", goarch: "amd64"},
		{goos: "darwin", goarch: "386"},
	} {
		t.Run(platform.goos+"/"+platform.goarch, func(t *testing.T) {
			detected := service.detectCapaFor(context.Background(), platform.goos, platform.goarch)
			if detected.status != StatusUnavailable || detected.setupPossible {
				t.Errorf("unexpected detection: %#v", detected)
			}
		})
	}
}

func TestCapaManagedRuntimeIsReadyOnSupportedMacOS(t *testing.T) {
	dataDirectory := t.TempDir()
	command := filepath.Join(dataDirectory, "services", "security-tools", ToolCapa, capaVersion, "capa")
	if err := os.MkdirAll(filepath.Dir(command), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(command, []byte("fixture"), 0o700); err != nil {
		t.Fatal(err)
	}
	service := NewService(dataDirectory, &testSettings{value: config.DefaultSettings()}, nil)
	service.probe = testProbe{}
	detected := service.detectCapaFor(context.Background(), "darwin", "arm64")
	if detected.status != StatusReady || detected.command != command {
		t.Fatalf("unexpected detection: %#v", detected)
	}
}

func TestReadyCapaEntersRuntimeCatalogAndCanBeDisabled(t *testing.T) {
	if runtime.GOOS != "darwin" {
		t.Skip("capa is only supported on macOS")
	}
	dataDirectory := t.TempDir()
	command := filepath.Join(dataDirectory, "services", "security-tools", ToolCapa, capaVersion, "capa")
	if err := os.MkdirAll(filepath.Dir(command), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(command, []byte("fixture"), 0o700); err != nil {
		t.Fatal(err)
	}
	settings := &testSettings{value: config.DefaultSettings()}
	service := NewService(dataDirectory, settings, nil)
	service.probe = testProbe{}

	var capa ToolSnapshot
	for _, snapshot := range service.List(context.Background()) {
		if snapshot.ID == ToolCapa {
			capa = snapshot
		}
	}
	if capa.Status != StatusReady || !capa.UsableByAgent || !capa.Enabled {
		t.Fatalf("ready capa was not admitted: %#v", capa)
	}
	runtimeTools := service.RuntimeTools(context.Background())
	if len(runtimeTools) != 1 || runtimeTools[0].ID != ToolCapa || runtimeTools[0].Command != command {
		t.Fatalf("unexpected runtime catalog: %#v", runtimeTools)
	}

	if err := service.SetEnabled(ToolCapa, false); err != nil {
		t.Fatal(err)
	}
	if runtimeTools := service.RuntimeTools(context.Background()); len(runtimeTools) != 0 {
		t.Fatalf("disabled capa remained in runtime catalog: %#v", runtimeTools)
	}
}

func TestCodingHandoffStagesActionableTaskWithoutStartingSetup(t *testing.T) {
	settings := &testSettings{value: config.DefaultSettings()}
	service := NewService(t.TempDir(), settings, nil)
	service.probe = testProbe{}

	handoff, err := service.CodingHandoff(context.Background(), ToolCapa)
	if err != nil {
		t.Fatal(err)
	}
	if handoff.ToolID != ToolCapa || handoff.Prompt == "" || handoff.VisibleText == "" ||
		handoff.ExecutionMode != "go" || handoff.ApprovalPolicy != "full-auto" {
		t.Fatalf("unexpected handoff: %#v", handoff)
	}
	if !strings.Contains(handoff.Prompt, "15 秒超时") || !strings.Contains(handoff.Prompt, "不要直接启动") {
		t.Fatalf("handoff did not bound the health check: %q", handoff.Prompt)
	}
	status, err := service.SetupStatus(ToolCapa)
	if err != nil {
		t.Fatal(err)
	}
	if status.State != "idle" {
		t.Fatalf("handoff unexpectedly started setup: %#v", status)
	}
}

func TestCodingHandoffRejectsCapaOnUnsupportedPlatform(t *testing.T) {
	if runtime.GOOS == "darwin" {
		t.Skip("capa is supported on macOS")
	}
	service := NewService(t.TempDir(), &testSettings{value: config.DefaultSettings()}, nil)
	service.probe = testProbe{}
	if _, err := service.CodingHandoff(context.Background(), ToolCapa); err == nil {
		t.Error("expected CodingHandoff to reject capa on an unsupported platform")
	}
}
