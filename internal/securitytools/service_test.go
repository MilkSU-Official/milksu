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

type scriptedProbe struct {
	paths   map[string]string
	outputs map[string]string
}

func (p scriptedProbe) LookPath(name string) (string, error) {
	if path, ok := p.paths[name]; ok && path != "" {
		return path, nil
	}
	return "", os.ErrNotExist
}

func (p scriptedProbe) Output(_ context.Context, command string, args ...string) (string, error) {
	if p.outputs != nil {
		if out, ok := p.outputs[command+" "+strings.Join(args, " ")]; ok {
			return out, nil
		}
		if out, ok := p.outputs[command]; ok {
			return out, nil
		}
		if out, ok := p.outputs[filepath.Base(command)]; ok {
			return out, nil
		}
	}
	return "", os.ErrNotExist
}

func readyGhidraProbe() scriptedProbe {
	return scriptedProbe{
		paths: map[string]string{
			"java": "/usr/bin/java",
			"jadx": "/usr/bin/jadx",
		},
		outputs: map[string]string{
			"java": `openjdk version "17.0.12" 2024-07-16`,
			"jadx": "1.5.0",
		},
	}
}

func TestGatedREOverlaysDefaultOffEvenWhenReady(t *testing.T) {
	t.Setenv("GHIDRA_INSTALL_DIR", writeGhidraInstall(t, "11.3.2"))
	service := NewService(t.TempDir(), &testSettings{value: config.DefaultSettings()}, nil)
	service.probe = readyGhidraProbe()

	found := map[string]ToolSnapshot{}
	for _, snapshot := range service.List(context.Background()) {
		found[snapshot.ID] = snapshot
	}
	for _, id := range GatedOverlayIDs {
		item, ok := found[id]
		if !ok {
			t.Fatalf("missing gated overlay %s", id)
		}
		if item.Enabled || item.UsableByAgent {
			t.Fatalf("ready overlay entered the catalog while default-off: %#v", item)
		}
		if item.Status != StatusReady {
			t.Fatalf("expected ready detection for %s: %#v", id, item)
		}
	}
	if _, ok := found["ghidra-ida-re"]; ok {
		t.Fatal("babysitter ghidra-ida-re must not appear in the factory catalog")
	}
	if paths := service.AdmittedOverlaySkillPaths(context.Background()); len(paths) != 0 {
		t.Fatalf("default-off overlays must not admit skill paths: %#v", paths)
	}
	if runtimeTools := service.RuntimeTools(context.Background()); len(runtimeTools) != 0 {
		t.Fatalf("gated overlays must not enter runtime tools: %#v", runtimeTools)
	}
}

func TestEnabledButUnreadyOverlayDoesNotAdmitSkillPath(t *testing.T) {
	settings := &testSettings{value: config.DefaultSettings()}
	service := NewService(t.TempDir(), settings, nil)
	service.probe = testProbe{}
	if err := service.SetEnabled(ToolJADXAndroid, true); err != nil {
		t.Fatal(err)
	}
	if err := service.SetEnabled(ToolGhidraRPC, true); err != nil {
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

func TestReadyEnabledJADXMaterializesVendoredSubtree(t *testing.T) {
	settings := &testSettings{value: config.DefaultSettings()}
	service := NewService(t.TempDir(), settings, nil)
	service.probe = readyGhidraProbe()
	if err := service.SetEnabled(ToolJADXAndroid, true); err != nil {
		t.Fatal(err)
	}
	paths := service.AdmittedOverlaySkillPaths(context.Background())
	if len(paths) != 1 {
		t.Fatalf("expected one admitted JADX skill path: %#v", paths)
	}
	if _, err := os.Stat(filepath.Join(paths[0], "SKILL.md")); err != nil {
		t.Fatal(err)
	}
	vendor := filepath.Join(paths[0], "vendor", "SKILL.md")
	body, err := os.ReadFile(vendor)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(body), "name: reverse-engineering-android-malware-with-jadx") {
		t.Fatalf("vendored skill missing upstream name: %s", body)
	}
	if _, err := os.Stat(filepath.Join(paths[0], "vendor", "scripts", "agent.py")); err != nil {
		t.Fatal(err)
	}
}

func TestGhidraRPCReadyRequiresInstallJavaAndDir(t *testing.T) {
	service := NewService(t.TempDir(), &testSettings{value: config.DefaultSettings()}, nil)
	service.probe = readyGhidraProbe()
	got, err := service.Check(context.Background(), ToolGhidraRPC)
	if err != nil {
		t.Fatal(err)
	}
	if got.Status == StatusReady {
		t.Fatalf("missing GHIDRA_INSTALL_DIR must not be ready: %#v", got)
	}

	t.Setenv("GHIDRA_INSTALL_DIR", writeGhidraInstall(t, "10.4"))
	got, err = service.Check(context.Background(), ToolGhidraRPC)
	if err != nil {
		t.Fatal(err)
	}
	if got.Status == StatusReady {
		t.Fatalf("Ghidra 10 must not be ready: %#v", got)
	}

	t.Setenv("GHIDRA_INSTALL_DIR", writeGhidraInstall(t, "11.3.2"))
	service.probe = scriptedProbe{
		paths:   map[string]string{"java": "/usr/bin/java"},
		outputs: map[string]string{"java": `openjdk version "11.0.2"`},
	}
	got, err = service.Check(context.Background(), ToolGhidraRPC)
	if err != nil {
		t.Fatal(err)
	}
	if got.Status == StatusReady {
		t.Fatalf("Java 11 must not be ready: %#v", got)
	}

	service.probe = readyGhidraProbe()
	got, err = service.Check(context.Background(), ToolGhidraRPC)
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != StatusReady {
		t.Fatalf("Ghidra 11 + Java 17 + GHIDRA_INSTALL_DIR should be ready: %#v", got)
	}
}

func TestOverlayDocumentsMatchSecurityTriage(t *testing.T) {
	if _, err := OverlayStubDocument("ghidra-ida-re"); err == nil {
		t.Fatal("ghidra-ida-re must not ship a factory overlay")
	}

	ghidra, err := OverlayStubDocument(ToolGhidraRPC)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(ghidra, "name: "+ToolGhidraRPC) || !strings.Contains(ghidra, "description:") {
		t.Fatalf("ghidra-rpc overlay lost catalog frontmatter: %s", ghidra)
	}
	if !strings.Contains(ghidra, GhidraRPCRevision) {
		t.Fatal("ghidra-rpc overlay must pin main 1743305487b1...")
	}
	if !strings.Contains(ghidra, "no LICENSE file") {
		t.Fatal("ghidra-rpc overlay must note the missing upstream LICENSE file")
	}
	if strings.Contains(ghidra, "uv run ghidra-rpc") || strings.Contains(ghidra, "allowed-tools") {
		t.Fatal("ghidra-rpc overlay must stay a short when-to-use, not an upstream body")
	}

	jadx, err := OverlayStubDocument(ToolJADXAndroid)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(jadx, "name: "+ToolJADXAndroid) {
		t.Fatal("jadx overlay must use the MilkSU catalog name")
	}
	if !strings.Contains(jadx, JADXSkillRevision) || !strings.Contains(jadx, JADXSkillSubtree) {
		t.Fatal("jadx overlay must pin the vendored subtree")
	}
	if !strings.Contains(jadx, "InjuredAndroid") || !strings.Contains(strings.ToLower(jadx), "computer use") {
		t.Fatal("jadx overlay must keep the lab / InjuredAndroid and no-CU bound")
	}

	vendor, err := overlayFS.ReadFile("overlays/jadx-android-malware/vendor/SKILL.md")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(vendor), "name: reverse-engineering-android-malware-with-jadx") {
		t.Fatal("expected the pinned JADX skill subtree only")
	}
	entries, err := overlayFS.ReadDir("overlays/jadx-android-malware/vendor")
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		switch entry.Name() {
		case "LICENSE", "SKILL.md", "PIN", "references", "scripts":
		default:
			t.Fatalf("unexpected vendored path %s; do not vendor the whole Anthropic repo", entry.Name())
		}
	}
}
