package codingenv

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestInspectMCPConfigReturnsOnlyDisplaySafeMetadata(t *testing.T) {
	workspace := t.TempDir()
	config := `{
		"mcpServers": {
			"remote-docs": {
				"url": "https://example.test/mcp",
				"headers": {"Authorization": "Bearer must-not-cross-ui"},
				"includeTools": ["search", "read"],
				"milksu": {
					"source": "https://github.com/example/remote-docs",
					"version": "v1.2.3",
					"taskScope": "只读文档检索"
				}
			},
			"local-browser": {
				"command": "npx",
				"args": ["-y", "browser-mcp"],
				"env": {"TOKEN": "must-not-cross-ui"},
				"includeTools": ["navigate", "screenshot"],
				"milksu": {
					"source": "npm:browser-mcp",
					"version": "2.4.1",
					"taskScope": "项目页面回归"
				}
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
		snapshot.Servers[0].Source != "npm:browser-mcp" ||
		snapshot.Servers[0].Version != "2.4.1" ||
		snapshot.Servers[0].TaskScope != "项目页面回归" ||
		!snapshot.Servers[0].ReviewReady ||
		snapshot.Servers[0].NetworkAccess != "任意出站网络" ||
		snapshot.Servers[0].CredentialAccess !=
			"使用项目专用配置；Provider Credential 保持隔离" ||
		len(snapshot.Servers[0].Tools) != 2 ||
		snapshot.Servers[1].Name != "remote-docs" ||
		snapshot.Servers[1].Transport != "远程 HTTP" ||
		snapshot.Servers[1].NetworkAccess != "仅连接 https://example.test" {
		t.Fatalf("unexpected MCP servers: %#v", snapshot.Servers)
	}
	rendered, err := json.Marshal(snapshot)
	if err != nil {
		t.Fatal(err)
	}
	for _, secret := range []string{
		"must-not-cross-ui",
		"Authorization",
		"TOKEN",
	} {
		if strings.Contains(string(rendered), secret) {
			t.Fatalf("secret metadata crossed the desktop boundary: %s", secret)
		}
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

func TestInspectMCPConfigRequiresFixedReviewMetadata(t *testing.T) {
	workspace := t.TempDir()
	config := `{
		"mcpServers": {
			"missing-review": {
				"command": "tool",
				"includeTools": ["read"]
			},
			"floating-version": {
				"url": "https://user:secret@example.test/mcp",
				"includeTools": ["search"],
				"milksu": {
					"source": "npm:floating",
					"version": "latest",
					"taskScope": "搜索"
				}
			},
			"missing-tools": {
				"socket": "/private/tmp/example.sock",
				"milksu": {
					"source": "local:example",
					"version": "sha256:1234",
					"taskScope": "本地索引"
				}
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
	if len(snapshot.Servers) != 3 {
		t.Fatalf("unexpected servers: %#v", snapshot.Servers)
	}
	for _, server := range snapshot.Servers {
		if server.ReviewReady || server.ReviewProblem == "" {
			t.Fatalf("unreviewed server was enabled: %#v", server)
		}
		if strings.Contains(server.NetworkAccess, "user:secret") {
			t.Fatalf("remote URL credentials crossed the UI: %#v", server)
		}
	}
}

func TestValidMCPVersionRejectsFloatingRanges(t *testing.T) {
	for _, version := range []string{
		"latest",
		"^1.2.3",
		"~1.2.3",
		">=1.2.3",
		"1.2.x",
		"1.2.3 || 2.0.0",
	} {
		if validMCPVersion(version) {
			t.Fatalf("floating version was accepted: %q", version)
		}
	}
	for _, version := range []string{"v1.2.3", "2026.08.03", "sha256:1234abcd"} {
		if !validMCPVersion(version) {
			t.Fatalf("fixed version was rejected: %q", version)
		}
	}
}
