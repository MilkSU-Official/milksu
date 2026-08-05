package main

import (
	"encoding/base64"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/MilkSU-Official/milksu/internal/appdata"
)

func TestMaybeRunCodingArtifactPreviewSmokePreviewsAndRejects(t *testing.T) {
	workspace := t.TempDir()
	writeArtifactPreviewFixture(t, workspace)
	reportPath := filepath.Join(t.TempDir(), "artifact-preview-smoke.json")
	t.Setenv(codingArtifactPreviewSmokeResultEnv, reportPath)
	t.Setenv(codingArtifactPreviewSmokeWorkspaceEnv, workspace)

	application := &App{
		dataDirectory: t.TempDir(),
		diagnostics:   appdata.NewDiagnosticRecorder(32),
	}
	application.maybeRunCodingArtifactPreviewSmoke()

	payload, err := os.ReadFile(reportPath)
	if err != nil {
		t.Fatalf("read smoke report: %v", err)
	}
	var report codingArtifactPreviewSmokeReport
	if err := json.Unmarshal(payload, &report); err != nil {
		t.Fatalf("decode smoke report: %v", err)
	}
	if report.Schema != "milksu-coding-artifact-preview-smoke/v1" ||
		report.Error != "" ||
		report.Workspace != workspace {
		t.Fatalf("unexpected smoke report: %#v", report)
	}
	if len(report.Previews) != 3 {
		t.Fatalf("preview count = %d, want 3: %#v", len(report.Previews), report.Previews)
	}
	byPath := make(map[string]string)
	for _, preview := range report.Previews {
		byPath[preview.RelativePath] = preview.Kind
	}
	if byPath["reports/summary.md"] != "markdown" ||
		byPath["reports/result.html"] != "html" ||
		byPath["images/screenshot.png"] != "image" {
		t.Fatalf("unexpected preview kinds: %#v", report.Previews)
	}
	if !strings.Contains(report.Previews[0].Content, "MilkSU packaged artifact preview") {
		t.Fatalf("markdown preview did not include fixture content: %#v", report.Previews[0])
	}
	expectedPNG := "data:image/png;base64," + base64.StdEncoding.EncodeToString(artifactPreviewSmokePNG())
	if report.Previews[2].DataURL != expectedPNG {
		t.Fatalf("image preview data URL mismatch: %#v", report.Previews[2])
	}
	for _, path := range []string{"../outside.md", "images/spoofed.png", "archive/result.svg"} {
		if report.Rejected[path] == "" {
			t.Fatalf("missing rejection for %s: %#v", path, report.Rejected)
		}
	}
	info, err := os.Stat(reportPath)
	if err != nil {
		t.Fatalf("stat smoke report: %v", err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("smoke report mode = %o, want 0600", info.Mode().Perm())
	}
}

func TestMaybeRunCodingArtifactPreviewSmokeRequiresWorkspace(t *testing.T) {
	reportPath := filepath.Join(t.TempDir(), "artifact-preview-smoke.json")
	t.Setenv(codingArtifactPreviewSmokeResultEnv, reportPath)

	application := &App{
		dataDirectory: t.TempDir(),
		diagnostics:   appdata.NewDiagnosticRecorder(32),
	}
	application.maybeRunCodingArtifactPreviewSmoke()

	payload, err := os.ReadFile(reportPath)
	if err != nil {
		t.Fatalf("read smoke report: %v", err)
	}
	var report codingArtifactPreviewSmokeReport
	if err := json.Unmarshal(payload, &report); err != nil {
		t.Fatalf("decode smoke report: %v", err)
	}
	if report.Schema != "milksu-coding-artifact-preview-smoke/v1" ||
		!strings.Contains(report.Error, codingArtifactPreviewSmokeWorkspaceEnv) {
		t.Fatalf("unexpected missing workspace report: %#v", report)
	}
}

func writeArtifactPreviewFixture(t *testing.T, workspace string) {
	t.Helper()
	files := map[string][]byte{
		"reports/summary.md":    []byte("# MilkSU packaged artifact preview\n\nThis came from a fixture workspace.\n"),
		"reports/result.html":   []byte("<!doctype html><meta charset=\"utf-8\"><h1>Preview</h1>"),
		"images/screenshot.png": artifactPreviewSmokePNG(),
		"images/spoofed.png":    []byte("<script>alert(1)</script>"),
		"archive/result.svg":    []byte("<svg/>"),
	}
	for relativePath, content := range files {
		absolute := filepath.Join(workspace, filepath.FromSlash(relativePath))
		if err := os.MkdirAll(filepath.Dir(absolute), 0o700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(absolute, content, 0o600); err != nil {
			t.Fatal(err)
		}
	}
}

func artifactPreviewSmokePNG() []byte {
	return []byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n', 0, 0, 0, 0}
}
