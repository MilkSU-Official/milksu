package securitytools

import (
	"context"
	"os"
	"path/filepath"
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

func TestReadyCapaEntersRuntimeCatalogAndCanBeDisabled(t *testing.T) {
	dataDirectory := t.TempDir()
	command := filepath.Join(dataDirectory, "security-tools", ToolCapa, capaVersion, "capa")
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

type mapProbe struct {
	paths  map[string]string
	output string
}

func (p mapProbe) LookPath(name string) (string, error) {
	if path, ok := p.paths[name]; ok && path != "" {
		return path, nil
	}
	return "", os.ErrNotExist
}

func (p mapProbe) Output(context.Context, string, ...string) (string, error) {
	if p.output == "" {
		return "", os.ErrNotExist
	}
	return p.output, nil
}

func TestGatedREOverlaysDefaultOffAndStayOutOfCatalog(t *testing.T) {
	service := NewService(t.TempDir(), &testSettings{value: config.DefaultSettings()}, nil)
	service.probe = mapProbe{
		paths:  map[string]string{"analyzeHeadless": "/usr/bin/analyzeHeadless", "jadx": "/usr/bin/jadx"},
		output: "1.5.0",
	}

	found := map[string]ToolSnapshot{}
	for _, snapshot := range service.List(context.Background()) {
		found[snapshot.ID] = snapshot
	}
	for _, id := range GatedOverlayIDs {
		item, ok := found[id]
		if !ok {
			t.Fatalf("missing gated overlay %s", id)
		}
		if item.Enabled || item.UsableByAgent || item.Status == StatusReady {
			t.Fatalf("gated overlay entered the catalog: %#v", item)
		}
	}
	if found[ToolGhidraRPC].Status != StatusDetected || found[ToolJADXAndroid].Status != StatusDetected {
		t.Fatalf("local tools should be detected without becoming ready: %#v %#v", found[ToolGhidraRPC], found[ToolJADXAndroid])
	}
	if paths := service.AdmittedOverlaySkillPaths(context.Background()); len(paths) != 0 {
		t.Fatalf("detected overlays must not admit skill paths: %#v", paths)
	}
	if runtimeTools := service.RuntimeTools(context.Background()); len(runtimeTools) != 0 {
		t.Fatalf("gated overlays must not enter runtime tools: %#v", runtimeTools)
	}
}

func TestEnabledButUnreadyOverlayDoesNotAdmitSkillPath(t *testing.T) {
	settings := &testSettings{value: config.DefaultSettings()}
	service := NewService(t.TempDir(), settings, nil)
	service.probe = mapProbe{paths: map[string]string{"jadx": "/usr/bin/jadx"}, output: "1.5.0"}
	if err := service.SetEnabled(ToolJADXAndroid, true); err != nil {
		t.Fatal(err)
	}
	if paths := service.AdmittedOverlaySkillPaths(context.Background()); len(paths) != 0 {
		t.Fatalf("enabled but unready overlay admitted a skill path: %#v", paths)
	}
}

func TestAdmitOverlayRequiresReadyAndEnabled(t *testing.T) {
	if admitOverlay(false, StatusReady) || admitOverlay(true, StatusDetected) || !admitOverlay(true, StatusReady) {
		t.Fatal("admitOverlay gate is wrong")
	}
}

func TestOverlayStubsStayOnDiskAndDoNotVendorUpstreamBodies(t *testing.T) {
	for _, id := range []string{ToolGhidraIDARE, ToolGhidraRPC, ToolJADXAndroid} {
		body, err := OverlayStubDocument(id)
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(body, "name: "+id) {
			t.Fatalf("stub %s missing catalog name", id)
		}
		if !strings.Contains(body, "description:") {
			t.Fatalf("stub %s missing when-to-use description", id)
		}
		if strings.Contains(body, "uv run ghidra-rpc") ||
			strings.Contains(body, "androguard") ||
			strings.Contains(body, "Anubis") ||
			strings.Contains(body, "analyzeHeadless \"$PROJECT_DIR\"") {
			t.Fatalf("stub %s vendored an unreviewed upstream body", id)
		}
		if !strings.Contains(body, "Do not paste the body into the system prompt") {
			t.Fatalf("stub %s lost the progressive-disclosure rule", id)
		}
	}
}
