package engine

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestNormalizeAssistantDelta(t *testing.T) {
	event := normalizeBridgeEvent(bridgeEvent{Type: "text_delta", ID: "session-1", Delta: "hello"})
	if event.Type != "assistant.delta" || event.Text != "hello" || event.SessionID != "session-1" {
		t.Fatalf("unexpected event: %#v", event)
	}
}

func TestNormalizeToolError(t *testing.T) {
	event := normalizeBridgeEvent(bridgeEvent{
		Type: "tool_call_end", ID: "session-1", ToolName: "read", Content: "denied", IsError: true,
	})
	if event.Type != "tool.completed" || event.Error != "denied" || !event.Done {
		t.Fatalf("unexpected event: %#v", event)
	}
}

func TestWriteCommandUsesOneJSONLine(t *testing.T) {
	var buffer bytes.Buffer
	if err := writeCommand(&buffer, map[string]string{"action": "probe"}); err != nil {
		t.Fatal(err)
	}
	lines := bytes.Split(bytes.TrimSpace(buffer.Bytes()), []byte{'\n'})
	if len(lines) != 1 || !json.Valid(lines[0]) {
		t.Fatalf("expected one JSON line, got %q", buffer.String())
	}
}

func TestSafeBaseEnvironmentDropsUnrelatedSecrets(t *testing.T) {
	filtered := safeBaseEnvironment([]string{
		"PATH=/bin",
		"HOME=/tmp/home",
		"GITHUB_TOKEN=secret",
		"NODE_OPTIONS=--require=/tmp/inject.js",
	})
	if len(filtered) != 2 {
		t.Fatalf("unexpected filtered environment: %#v", filtered)
	}
	for _, entry := range filtered {
		if entry == "GITHUB_TOKEN=secret" || entry == "NODE_OPTIONS=--require=/tmp/inject.js" {
			t.Fatalf("unsafe environment entry survived: %q", entry)
		}
	}
}

func TestResolveSidecarRuntimeUsesCompletePackagedOverride(t *testing.T) {
	directory := t.TempDir()
	node := filepath.Join(directory, "node")
	bridge := filepath.Join(directory, "security-bridge.cjs")
	if err := os.WriteFile(node, []byte("runtime"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(bridge, []byte("bridge"), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("MILKSU_SIDECAR_DIR", directory)

	runtime, err := resolveSidecarRuntime("security-bridge.cjs", "security-bridge.js")
	if err != nil {
		t.Fatal(err)
	}
	if !runtime.packaged || runtime.node != node || runtime.bridge != bridge {
		t.Fatalf("unexpected packaged runtime: %#v", runtime)
	}
}

func TestResolveSidecarRuntimeRejectsIncompleteOverride(t *testing.T) {
	t.Setenv("MILKSU_SIDECAR_DIR", t.TempDir())
	if _, err := resolveSidecarRuntime("security-bridge.cjs", "security-bridge.js"); err == nil {
		t.Fatal("expected an incomplete packaged runtime to be rejected")
	}
}
