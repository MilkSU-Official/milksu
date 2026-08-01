package codingenv

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestInspectArchitecturePreviewReadsBoundedArchifyArtifact(t *testing.T) {
	workspace := t.TempDir()
	relative := filepath.Join(
		"docs",
		"architecture",
		"generated",
		"system.html",
	)
	absolute := filepath.Join(workspace, relative)
	if err := os.MkdirAll(filepath.Dir(absolute), 0o700); err != nil {
		t.Fatal(err)
	}
	content := `<!doctype html><meta name="generator" content="archify 2.12.0"><h1>System</h1>`
	if err := os.WriteFile(absolute, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	preview, err := InspectArchitecturePreview(workspace, filepath.ToSlash(relative))
	if err != nil {
		t.Fatal(err)
	}
	if !preview.Exists || preview.HTML != content || preview.SizeBytes != int64(len(content)) {
		t.Fatalf("unexpected architecture preview: %#v", preview)
	}
}

func TestInspectArchitecturePreviewReportsMissingArtifact(t *testing.T) {
	preview, err := InspectArchitecturePreview(
		t.TempDir(),
		"docs/architecture/generated/missing.html",
	)
	if err != nil {
		t.Fatal(err)
	}
	if preview.Exists || preview.RelativePath == "" {
		t.Fatalf("unexpected missing preview: %#v", preview)
	}
}

func TestInspectArchitecturePreviewRejectsEscapeAndUntrustedHTML(t *testing.T) {
	workspace := t.TempDir()
	for _, path := range []string{
		"../outside.html",
		"docs/architecture/other.html",
		"docs/architecture/generated/spec.json",
	} {
		if _, err := InspectArchitecturePreview(workspace, path); err == nil {
			t.Fatalf("expected %q to be rejected", path)
		}
	}

	relative := "docs/architecture/generated/untrusted.html"
	absolute := filepath.Join(workspace, filepath.FromSlash(relative))
	if err := os.MkdirAll(filepath.Dir(absolute), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(absolute, []byte("<html>not archify</html>"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := InspectArchitecturePreview(workspace, relative); err == nil ||
		!strings.Contains(err.Error(), "not an Archify artifact") {
		t.Fatalf("expected untrusted HTML rejection, got %v", err)
	}

	outside := filepath.Join(t.TempDir(), "outside.html")
	if err := os.WriteFile(
		outside,
		[]byte(`<!doctype html><meta name="generator" content="archify 2.12.0">`),
		0o600,
	); err != nil {
		t.Fatal(err)
	}
	symlinkRelative := "docs/architecture/generated/symlink.html"
	symlinkPath := filepath.Join(workspace, filepath.FromSlash(symlinkRelative))
	if err := os.Symlink(outside, symlinkPath); err != nil {
		t.Fatal(err)
	}
	if _, err := InspectArchitecturePreview(workspace, symlinkRelative); err == nil ||
		!strings.Contains(err.Error(), "escapes the Coding workspace") {
		t.Fatalf("expected final symlink escape rejection, got %v", err)
	}
}
