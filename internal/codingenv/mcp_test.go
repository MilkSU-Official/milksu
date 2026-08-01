package codingenv

import (
	"os"
	"path/filepath"
	"testing"
)

func TestInspectMCPConfigReturnsOnlyDisplaySafeMetadata(t *testing.T) {
	workspace := t.TempDir()
	config := `{
		"mcpServers": {
			"remote-docs": {
				"url": "https://example.test/mcp",
				"headers": {"Authorization": "Bearer must-not-cross-ui"}
			},
			"local-browser": {
				"command": "npx",
				"args": ["-y", "browser-mcp"],
				"env": {"TOKEN": "must-not-cross-ui"}
			},
			"off": {
				"command": "disabled-server",
				"disabled": true
			}
		}
	}`
	if err := os.WriteFile(filepath.Join(workspace, ".mcp.json"), []byte(config), 0o600); err != nil {
		t.Fatal(err)
	}

	snapshot, err := InspectMCPConfig(workspace)
	if err != nil {
		t.Fatal(err)
	}
	if !snapshot.Configured || snapshot.Path != ".mcp.json" ||
		len(snapshot.Digest) != 64 || snapshot.Problem != "" {
		t.Fatalf("unexpected snapshot: %#v", snapshot)
	}
	if len(snapshot.Servers) != 2 ||
		snapshot.Servers[0].Name != "local-browser" ||
		snapshot.Servers[0].Transport != "本地进程" ||
		snapshot.Servers[1].Name != "remote-docs" ||
		snapshot.Servers[1].Transport != "远程 HTTP" {
		t.Fatalf("unexpected MCP servers: %#v", snapshot.Servers)
	}
}

func TestInspectMCPConfigRejectsSymlinkAndMalformedConfig(t *testing.T) {
	workspace := t.TempDir()
	outside := filepath.Join(t.TempDir(), "mcp.json")
	if err := os.WriteFile(outside, []byte(`{"mcpServers":{}}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(workspace, ".mcp.json")); err != nil {
		t.Fatal(err)
	}
	snapshot, err := InspectMCPConfig(workspace)
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.Problem == "" || len(snapshot.Servers) != 0 {
		t.Fatalf("symlinked config was not rejected: %#v", snapshot)
	}

	if err := os.Remove(filepath.Join(workspace, ".mcp.json")); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(workspace, ".mcp.json"), []byte(`{`), 0o600); err != nil {
		t.Fatal(err)
	}
	snapshot, err = InspectMCPConfig(workspace)
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.Problem == "" {
		t.Fatal("malformed config did not return an actionable problem")
	}
}
