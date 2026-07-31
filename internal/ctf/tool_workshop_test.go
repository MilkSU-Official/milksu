package ctf

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestReadToolWorkshopStateProjectsRequestsAndTools(t *testing.T) {
	workspace := t.TempDir()
	requestDirectory := filepath.Join(workspace, "work", "tool-requests")
	toolDirectory := filepath.Join(workspace, "work", "tools")
	for _, directory := range []string{requestDirectory, toolDirectory} {
		if err := os.MkdirAll(directory, 0o700); err != nil {
			t.Fatal(err)
		}
	}
	pendingPath := filepath.Join(requestDirectory, "001-parser.md")
	readyPath := filepath.Join(requestDirectory, "002-validator.md")
	if err := os.WriteFile(
		pendingPath,
		[]byte("# Packet parser\n\nstatus: pending\n"),
		0o600,
	); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(
		readyPath,
		[]byte("# Flag validator\n\n状态：已交付\n"),
		0o600,
	); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(
		filepath.Join(requestDirectory, "README.md"),
		[]byte("not a request"),
		0o600,
	); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(
		filepath.Join(toolDirectory, "validate.py"),
		[]byte("print('fixture')\n"),
		0o600,
	); err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	if err := os.Chtimes(readyPath, now.Add(time.Second), now.Add(time.Second)); err != nil {
		t.Fatal(err)
	}

	state, err := ReadToolWorkshopState(workspace)
	if err != nil {
		t.Fatal(err)
	}
	if state.SchemaVersion != ToolWorkshopSchemaVersion ||
		len(state.Requests) != 2 ||
		state.PendingCount != 1 ||
		state.ReadyCount != 1 ||
		state.ToolCount != 1 ||
		state.LatestRequest == nil ||
		state.LatestRequest.Status != ToolRequestStatusReady ||
		state.LatestRequest.Title != "Flag validator" {
		t.Fatalf("unexpected tool workshop state: %#v", state)
	}
}

func TestReadToolWorkshopStateDoesNotFollowSymlinks(t *testing.T) {
	workspace := t.TempDir()
	requestDirectory := filepath.Join(workspace, "work", "tool-requests")
	toolDirectory := filepath.Join(workspace, "work", "tools")
	for _, directory := range []string{requestDirectory, toolDirectory} {
		if err := os.MkdirAll(directory, 0o700); err != nil {
			t.Fatal(err)
		}
	}
	outside := filepath.Join(t.TempDir(), "outside.md")
	if err := os.WriteFile(outside, []byte("# Outside\n\nstatus: pending\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(requestDirectory, "001-outside.md")); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(toolDirectory, "outside.py")); err != nil {
		t.Fatal(err)
	}

	state, err := ReadToolWorkshopState(workspace)
	if err != nil {
		t.Fatal(err)
	}
	if len(state.Requests) != 0 || state.ToolCount != 0 {
		t.Fatalf("symlinked content escaped workshop projection: %#v", state)
	}
}
