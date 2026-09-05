package agentresources

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeFactorySkill(t *testing.T, root, name, body string) {
	t.Helper()
	dir := filepath.Join(root, name)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "SKILL.md"), []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
}

func TestBuiltinSkillOverlayAndRestore(t *testing.T) {
	data := t.TempDir()
	factory := t.TempDir()
	writeFactorySkill(t, factory, "product-design", "---\nname: product-design\ndescription: Factory when-to-use\n---\n\n# Factory\n")
	store, err := NewStore(data, fakeSecrets{})
	if err != nil {
		t.Fatal(err)
	}
	store.SetFactorySkillsDir(factory)
	got, err := store.GetBuiltinSkillDocument("product-design")
	if err != nil {
		t.Fatal(err)
	}
	if got.Customized || !strings.Contains(got.Document, "# Factory") {
		t.Fatalf("expected factory document: %#v", got)
	}
	if _, err := store.SetBuiltinSkillDocument("product-design", "---\nname: product-design\ndescription: User when-to-use\n---\n\n# Overlay\n"); err != nil {
		t.Fatal(err)
	}
	got, err = store.GetBuiltinSkillDocument("product-design")
	if err != nil {
		t.Fatal(err)
	}
	if !got.Customized || !strings.Contains(got.Document, "# Overlay") {
		t.Fatalf("expected overlay document: %#v", got)
	}
	runtime := store.Runtime()
	if len(runtime.HideFactorySkills) != 1 || runtime.HideFactorySkills[0] != "product-design" {
		t.Fatalf("expected hide factory: %#v", runtime.HideFactorySkills)
	}
	if len(runtime.SkillPaths) != 1 || !strings.Contains(runtime.SkillPaths[0], "overlays") {
		t.Fatalf("expected overlay path: %#v", runtime.SkillPaths)
	}
	if _, err := store.RestoreBuiltinSkill("product-design"); err != nil {
		t.Fatal(err)
	}
	got, err = store.GetBuiltinSkillDocument("product-design")
	if err != nil {
		t.Fatal(err)
	}
	if got.Customized || !strings.Contains(got.Document, "# Factory") {
		t.Fatalf("restore should return factory: %#v", got)
	}
}

func TestBuiltinMCPOverlayWorkspaceRoundTrip(t *testing.T) {
	store, err := NewStore(t.TempDir(), fakeSecrets{})
	if err != nil {
		t.Fatal(err)
	}
	enabled := false
	snapshot, err := store.UpsertBuiltinMCP(BuiltinMCPInput{
		Name:    "ida-pro",
		Enabled: &enabled,
		Command: "idalib-mcp",
		Args:    []string{"--stdio"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(snapshot.BuiltinMCP) == 0 || snapshot.BuiltinMCP[0].Name != "ida-pro" || !snapshot.BuiltinMCP[0].Customized {
		t.Fatalf("unexpected builtin snapshot: %#v", snapshot.BuiltinMCP)
	}
	command, args, on, customized := store.LookupBuiltinMCP("ida-pro")
	if command != "idalib-mcp" || len(args) != 1 || on || !customized {
		t.Fatalf("lookup %#v %#v %v %v", command, args, on, customized)
	}
	workspace, err := store.EnsureConfigWorkspace()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(workspace, "mcp", "ida-pro.json"), []byte(`{"id":"ida-pro","enabled":true,"command":"","args":[]}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Snapshot(); err != nil {
		t.Fatal(err)
	}
	command, _, on, customized = store.LookupBuiltinMCP("ida-pro")
	if command != "" || !on || customized {
		t.Fatalf("workspace restore failed: %q %v %v", command, on, customized)
	}
}

func TestArchifyFactorySkillIsResolved(t *testing.T) {
	store, err := NewStore(t.TempDir(), fakeSecrets{})
	if err != nil {
		t.Fatal(err)
	}
	got, err := store.GetBuiltinSkillDocument("archify")
	if err != nil {
		t.Skip("archify factory skill is not available in this checkout")
	}
	if got.Name != "archify" || strings.TrimSpace(got.Document) == "" {
		t.Fatalf("expected archify factory document: %#v", got)
	}
}

func TestReservedUserMCPStillRejected(t *testing.T) {
	store, err := NewStore(t.TempDir(), fakeSecrets{})
	if err != nil {
		t.Fatal(err)
	}
	_, err = store.UpsertMCPServer(MCPServerInput{Name: "milksu-ida-pro", Transport: "command", Command: "true"})
	if err == nil || !strings.Contains(err.Error(), "reserved") {
		t.Fatalf("expected reserved user MCP, got %v", err)
	}
}
