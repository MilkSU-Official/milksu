package codingenv

import (
	"encoding/base64"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestInspectArtifactPreviewReadsMarkdownAndHTML(t *testing.T) {
	workspace := t.TempDir()
	fixtures := []struct {
		path      string
		content   string
		kind      string
		mediaType string
	}{
		{"reports/summary.md", "# Summary\n\nSafe.", "markdown", "text/markdown"},
		{"reports/result.html", "<!doctype html><h1>Result</h1>", "html", "text/html"},
	}
	for _, fixture := range fixtures {
		absolute := filepath.Join(workspace, filepath.FromSlash(fixture.path))
		if err := os.MkdirAll(filepath.Dir(absolute), 0o700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(absolute, []byte(fixture.content), 0o600); err != nil {
			t.Fatal(err)
		}
		preview, err := InspectArtifactPreview(workspace, fixture.path)
		if err != nil {
			t.Fatalf("preview %s: %v", fixture.path, err)
		}
		if preview.Kind != fixture.kind || preview.MediaType != fixture.mediaType ||
			preview.Content != fixture.content || preview.DataURL != "" {
			t.Fatalf("unexpected preview for %s: %#v", fixture.path, preview)
		}
	}
}

// An agent's ordinary deliverable is a text file that is not Markdown. Those
// read on the same plain-text path instead of being refused for their
// extension.
func TestInspectArtifactPreviewReadsOrdinaryTextOutput(t *testing.T) {
	workspace := t.TempDir()
	for _, relative := range []string{
		"results.json",
		"out.log",
		"bench.csv",
		"changes.diff",
		"notes.txt",
		"diagram.svg",
		"src/main.go",
	} {
		absolute := filepath.Join(workspace, filepath.FromSlash(relative))
		if err := os.MkdirAll(filepath.Dir(absolute), 0o700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(absolute, []byte("payload\n"), 0o600); err != nil {
			t.Fatal(err)
		}
		preview, err := InspectArtifactPreview(workspace, relative)
		if err != nil {
			t.Fatalf("preview %s: %v", relative, err)
		}
		if preview.Kind != "text" || preview.MediaType != "text/plain" ||
			preview.Content != "payload\n" || preview.DataURL != "" {
			t.Fatalf("unexpected text preview for %s: %#v", relative, preview)
		}
	}
}

func TestInspectArtifactPreviewReturnsSignatureCheckedImageData(t *testing.T) {
	workspace := t.TempDir()
	relative := "output/screenshot.png"
	absolute := filepath.Join(workspace, filepath.FromSlash(relative))
	if err := os.MkdirAll(filepath.Dir(absolute), 0o700); err != nil {
		t.Fatal(err)
	}
	png := []byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n', 0, 0, 0, 0}
	if err := os.WriteFile(absolute, png, 0o600); err != nil {
		t.Fatal(err)
	}
	preview, err := InspectArtifactPreview(workspace, relative)
	if err != nil {
		t.Fatal(err)
	}
	expected := "data:image/png;base64," + base64.StdEncoding.EncodeToString(png)
	if preview.Kind != "image" || preview.MediaType != "image/png" ||
		preview.DataURL != expected || preview.Content != "" {
		t.Fatalf("unexpected image preview: %#v", preview)
	}
}

func TestInspectArtifactPreviewRejectsEscapesUnsupportedAndSpoofedFiles(t *testing.T) {
	workspace := t.TempDir()
	for _, path := range []string{"", "../outside.md", "/tmp/outside.md"} {
		if _, err := InspectArtifactPreview(workspace, path); err == nil {
			t.Fatalf("expected %q to be rejected", path)
		}
	}

	binary := filepath.Join(workspace, "out.bin")
	if err := os.WriteFile(binary, []byte{'M', 'Z', 0x00, 0x01}, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := InspectArtifactPreview(workspace, "out.bin"); err == nil ||
		!strings.Contains(err.Error(), "valid UTF-8") {
		t.Fatalf("expected unreadable binary rejection, got %v", err)
	}

	spoofed := filepath.Join(workspace, "spoofed.png")
	if err := os.WriteFile(spoofed, []byte("<script>alert(1)</script>"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := InspectArtifactPreview(workspace, "spoofed.png"); err == nil ||
		!strings.Contains(err.Error(), "does not match") {
		t.Fatalf("expected image signature rejection, got %v", err)
	}

	outside := filepath.Join(t.TempDir(), "outside.md")
	if err := os.WriteFile(outside, []byte("# Outside"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(workspace, "linked.md")); err != nil {
		t.Fatal(err)
	}
	if _, err := InspectArtifactPreview(workspace, "linked.md"); err == nil ||
		!strings.Contains(err.Error(), "escapes the Coding workspace") {
		t.Fatalf("expected symlink escape rejection, got %v", err)
	}
}

func TestInspectArtifactPreviewRejectsOversizedAndInvalidText(t *testing.T) {
	workspace := t.TempDir()
	oversized := filepath.Join(workspace, "oversized.md")
	if err := os.WriteFile(oversized, []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Truncate(oversized, maxArtifactTextPreviewBytes+1); err != nil {
		t.Fatal(err)
	}
	if _, err := InspectArtifactPreview(workspace, "oversized.md"); err == nil ||
		!strings.Contains(err.Error(), "exceeds") {
		t.Fatalf("expected size rejection, got %v", err)
	}

	invalid := filepath.Join(workspace, "invalid.md")
	if err := os.WriteFile(invalid, []byte{0xff, 0xfe}, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := InspectArtifactPreview(workspace, "invalid.md"); err == nil ||
		!strings.Contains(err.Error(), "valid UTF-8") {
		t.Fatalf("expected UTF-8 rejection, got %v", err)
	}
}
