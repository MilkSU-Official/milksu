package agentresources

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

type fakeSecrets map[string]string

func (s fakeSecrets) PutManagedSecret(account, secret string) error {
	s[account] = secret
	return nil
}

func (s fakeSecrets) DeleteManagedSecret(account string) error {
	delete(s, account)
	return nil
}

func (s fakeSecrets) LookupManagedSecret(account string) (string, error) {
	return s[account], nil
}

func TestUserMCPKeepsSecretsOutOfSnapshots(t *testing.T) {
	root := t.TempDir()
	secrets := fakeSecrets{}
	store, err := NewStore(root, secrets)
	if err != nil {
		t.Fatal(err)
	}
	enabled := true
	snapshot, err := store.UpsertMCPServer(MCPServerInput{
		Name:      "github",
		Enabled:   &enabled,
		Transport: "command",
		Command:   "npx",
		Args:      []string{"-y", "@modelcontextprotocol/server-github"},
		Env:       map[string]string{"GITHUB_TOKEN": "ghp_must-not-cross-ui"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(snapshot.MCPServers) != 1 ||
		snapshot.MCPServers[0].Name != "github" ||
		!snapshot.MCPServers[0].Enabled ||
		snapshot.MCPServers[0].Transport != "command" ||
		snapshot.MCPServers[0].Command != "npx" ||
		snapshot.MCPServers[0].Scope != "user" ||
		!snapshot.MCPServers[0].ReviewReady ||
		len(snapshot.MCPServers[0].EnvNames) != 1 ||
		snapshot.MCPServers[0].EnvNames[0] != "GITHUB_TOKEN" {
		t.Fatalf("unexpected snapshot: %#v", snapshot.MCPServers)
	}
	rendered, err := json.Marshal(snapshot)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(rendered), "ghp_must-not-cross-ui") {
		t.Fatal("MCP secret crossed the catalog snapshot")
	}
	runtime := store.Runtime()
	if len(runtime.MCPServers) != 1 || runtime.MCPServers[0].Name != "github" {
		t.Fatalf("unexpected runtime: %#v", runtime)
	}
	env, _ := runtime.MCPServers[0].Definition["env"].(map[string]string)
	if env["GITHUB_TOKEN"] != "ghp_must-not-cross-ui" {
		t.Fatalf("runtime missing resolved env: %#v", runtime.MCPServers[0].Definition)
	}
}

func TestReservedMCPNamesAreRejected(t *testing.T) {
	store, err := NewStore(t.TempDir(), fakeSecrets{})
	if err != nil {
		t.Fatal(err)
	}
	_, err = store.UpsertMCPServer(MCPServerInput{
		Name:      "milksu-playwright",
		Transport: "command",
		Command:   "npx",
	})
	if err == nil || !strings.Contains(err.Error(), "reserved") {
		t.Fatalf("expected reserved name error, got %v", err)
	}
}

func TestImportSkillCopiesSKILLMarkdownOnly(t *testing.T) {
	source := t.TempDir()
	if err := os.WriteFile(filepath.Join(source, "SKILL.md"), []byte("---\nname: demo-review\ndescription: Review a local change\n---\n\n# Demo\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(source, "scripts"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(source, "scripts", "check.sh"), []byte("#!/bin/sh\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(source, "notes.txt"), []byte("ignore"), 0o600); err != nil {
		t.Fatal(err)
	}
	store, err := NewStore(t.TempDir(), fakeSecrets{})
	if err != nil {
		t.Fatal(err)
	}
	snapshot, err := store.ImportSkill(source)
	if err != nil {
		t.Fatal(err)
	}
	if len(snapshot.Skills) != 1 ||
		snapshot.Skills[0].Name != "demo-review" ||
		snapshot.Skills[0].Description != "Review a local change" ||
		!snapshot.Skills[0].Enabled ||
		snapshot.Skills[0].Origin != "user" {
		t.Fatalf("unexpected skill snapshot: %#v", snapshot.Skills)
	}
	runtime := store.Runtime()
	if len(runtime.SkillPaths) != 1 {
		t.Fatalf("expected one skill path, got %#v", runtime.SkillPaths)
	}
	if _, err := os.Stat(filepath.Join(runtime.SkillPaths[0], "SKILL.md")); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(runtime.SkillPaths[0], "scripts", "check.sh")); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(runtime.SkillPaths[0], "notes.txt")); err == nil {
		t.Fatal("unlisted skill files should not be copied")
	}
}

func TestImportSkillPreservesSlashOnlyFrontmatter(t *testing.T) {
	source := t.TempDir()
	if err := os.WriteFile(filepath.Join(source, "SKILL.md"), []byte("---\nname: release-helper\ndescription: Use when publishing MilkSU.\ndisable-model-invocation: true\n---\n\n# Body stays on disk\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	store, err := NewStore(t.TempDir(), fakeSecrets{})
	if err != nil {
		t.Fatal(err)
	}
	snapshot, err := store.ImportSkill(source)
	if err != nil {
		t.Fatal(err)
	}
	if len(snapshot.Skills) != 1 || !snapshot.Skills[0].SlashOnly {
		t.Fatalf("expected slash-only skill snapshot: %#v", snapshot.Skills)
	}
	copied, err := os.ReadFile(filepath.Join(store.Runtime().SkillPaths[0], "SKILL.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(copied), "disable-model-invocation: true") {
		t.Fatal("imported SKILL.md must keep Pi disable-model-invocation for the harness catalog")
	}
	if !strings.Contains(string(copied), "# Body stays on disk") {
		t.Fatal("skill body must stay in the file Pi reads, not a MilkSU prompt")
	}
}

func TestImportMCPJSONKeepsSecretsOutOfSnapshots(t *testing.T) {
	store, err := NewStore(t.TempDir(), fakeSecrets{})
	if err != nil {
		t.Fatal(err)
	}
	snapshot, err := store.ImportMCPJSON([]byte(`{
		"mcpServers": {
			"GitHub Docs": {
				"url": "https://example.test/mcp",
				"headers": { "Authorization": "Bearer secret-token" }
			},
			"local_tools": {
				"command": "npx",
				"args": ["-y", "@modelcontextprotocol/server-memory"],
				"env": { "MEMORY_PATH": "/var/secret/memory" }
			}
		}
	}`))
	if err != nil {
		t.Fatal(err)
	}
	if len(snapshot.MCPServers) != 2 {
		t.Fatalf("expected two imported servers, got %#v", snapshot.MCPServers)
	}
	rendered, err := json.Marshal(snapshot)
	if err != nil {
		t.Fatal(err)
	}
	for _, secret := range []string{"secret-token", "/var/secret/memory"} {
		if strings.Contains(string(rendered), secret) {
			t.Fatalf("imported secret %q crossed the catalog snapshot", secret)
		}
	}
	runtime := store.Runtime()
	if len(runtime.MCPServers) != 2 {
		t.Fatalf("expected runtime servers, got %#v", runtime.MCPServers)
	}
}

func TestDisabledUserResourcesStayOutOfRuntime(t *testing.T) {
	store, err := NewStore(t.TempDir(), fakeSecrets{})
	if err != nil {
		t.Fatal(err)
	}
	enabled := true
	if _, err := store.UpsertMCPServer(MCPServerInput{
		Name:      "docs",
		Enabled:   &enabled,
		Transport: "url",
		URL:       "https://example.test/mcp",
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.SetMCPServerEnabled("docs", false); err != nil {
		t.Fatal(err)
	}
	if runtime := store.Runtime(); len(runtime.MCPServers) != 0 {
		t.Fatalf("disabled MCP should not enter runtime: %#v", runtime)
	}
}
