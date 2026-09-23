package codingenv

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestWorkspaceImageFileResolvesARealImage(t *testing.T) {
	workspace := t.TempDir()
	relative := "milk-cat.png"
	absolute := filepath.Join(workspace, relative)
	png := []byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n', 0, 0, 0, 0}
	if err := os.WriteFile(absolute, png, 0o600); err != nil {
		t.Fatal(err)
	}
	got, err := WorkspaceImageFile(workspace, relative)
	if err != nil {
		t.Fatal(err)
	}
	want, err := filepath.EvalSymlinks(absolute)
	if err != nil {
		t.Fatal(err)
	}
	if got != want {
		t.Fatalf("path = %s, want %s", got, want)
	}
}

func TestWorkspaceImageFileRejectsEscapesAndNonImages(t *testing.T) {
	workspace := t.TempDir()
	for _, path := range []string{"", "../outside.png", "/tmp/outside.png", "notes.md"} {
		if _, err := WorkspaceImageFile(workspace, path); err == nil {
			t.Fatalf("expected %q to be rejected", path)
		}
	}
	spoofed := filepath.Join(workspace, "spoofed.png")
	if err := os.WriteFile(spoofed, []byte("<script>alert(1)</script>"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := WorkspaceImageFile(workspace, "spoofed.png"); err == nil ||
		!strings.Contains(err.Error(), "does not match") {
		t.Fatalf("expected signature rejection, got %v", err)
	}
}

func TestCopyRegularFileWritesTheChosenDestination(t *testing.T) {
	dir := t.TempDir()
	source := filepath.Join(dir, "milk-cat.png")
	body := []byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n'}
	if err := os.WriteFile(source, body, 0o600); err != nil {
		t.Fatal(err)
	}
	destination := filepath.Join(dir, "saved", "cat.png")
	if err := CopyRegularFile(source, destination); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(destination)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != string(body) {
		t.Fatalf("copied %q", got)
	}
	if err := CopyRegularFile(source, source); err == nil {
		t.Fatal("expected the source path to be refused as a destination")
	}
	if err := CopyRegularFile(source, "relative.png"); err == nil {
		t.Fatal("expected a relative destination to be refused")
	}
}
