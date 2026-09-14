package codingenv

import (
	"os"
	"path/filepath"
	"slices"
	"testing"
	"time"
)

func TestDiscoverArtifactsKeepsDeliverableGitChangesFirst(t *testing.T) {
	paths := DiscoverArtifacts(t.TempDir(), []GitChange{
		{Path: "README.md"},
		{Path: "src/app.ts"},
		{Path: "docs/preview.html"},
		{Path: "results.json"},
		{Path: "out.log"},
		{Path: "README.md"},
	}, nil)
	expected := []string{
		"README.md",
		"docs/preview.html",
		"results.json",
		"out.log",
	}
	if !slices.Equal(paths, expected) {
		t.Fatalf("paths = %#v", paths)
	}
}

// An agent writes its report into the project's output directory, which is
// ignored by design. Git status names that directory but not the files inside,
// so discovery has to look, or the deliverable is permanently invisible.
func TestDiscoverArtifactsFindsFilesInsideAnIgnoredOutputDirectory(t *testing.T) {
	workspace := t.TempDir()
	output := filepath.Join(workspace, "out")
	if err := os.MkdirAll(filepath.Join(output, "nested"), 0o755); err != nil {
		t.Fatal(err)
	}
	writeArtifactFixture(t, filepath.Join(output, "report.md"))
	writeArtifactFixture(t, filepath.Join(output, "nested", "summary.json"))
	writeArtifactFixture(t, filepath.Join(output, "bundle.wasm"))

	paths := DiscoverArtifacts(workspace, nil, []string{"out"})
	if !slices.Contains(paths, "out/report.md") {
		t.Fatalf("the ignored output directory stayed invisible: %#v", paths)
	}
	if !slices.Contains(paths, "out/nested/summary.json") {
		t.Fatalf("discovery did not descend into the output directory: %#v", paths)
	}
	if slices.Contains(paths, "out/bundle.wasm") {
		t.Fatalf("discovery offered a build input as a deliverable: %#v", paths)
	}
}

// A workspace that is not a repository has no Git status at all, and its
// artifact panel used to be permanently empty.
func TestDiscoverArtifactsCoversAWorkspaceWithoutGit(t *testing.T) {
	workspace := t.TempDir()
	writeArtifactFixture(t, filepath.Join(workspace, "analysis.md"))

	paths := DiscoverArtifacts(workspace, nil, []string{"."})
	if !slices.Contains(paths, "analysis.md") {
		t.Fatalf("a workspace outside Git reported no deliverables: %#v", paths)
	}
}

// Recency is what separates a directory the task just wrote into from a
// dependency tree, so the scan descends into the newest directory first instead
// of relying on a hardcoded list of directory names.
func TestDiscoverArtifactsReachesTheDirectoryTheTaskJustWrote(t *testing.T) {
	workspace := t.TempDir()
	stale := filepath.Join(workspace, "dependencies")
	fresh := filepath.Join(workspace, "reports")
	for _, directory := range []string{stale, fresh} {
		if err := os.MkdirAll(directory, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	writeArtifactFixture(t, filepath.Join(stale, "changelog.md"))
	writeArtifactFixture(t, filepath.Join(fresh, "result.md"))

	old := time.Now().Add(-30 * 24 * time.Hour)
	for _, path := range []string{filepath.Join(stale, "changelog.md"), stale} {
		if err := os.Chtimes(path, old, old); err != nil {
			t.Fatal(err)
		}
	}

	paths := DiscoverArtifacts(workspace, nil, []string{"."})
	if len(paths) == 0 || paths[0] != "reports/result.md" {
		t.Fatalf("the freshly written deliverable was not offered first: %#v", paths)
	}
	if slices.Contains(paths, "dependencies/changelog.md") {
		t.Fatalf("last month's file was offered as this task's deliverable: %#v", paths)
	}
}

func TestDiscoverArtifactsStaysOutOfMilkSUInternalState(t *testing.T) {
	workspace := t.TempDir()
	internal := filepath.Join(workspace, ".milksu", "browser-evidence")
	if err := os.MkdirAll(internal, 0o755); err != nil {
		t.Fatal(err)
	}
	writeArtifactFixture(t, filepath.Join(internal, "trace.json"))

	if paths := DiscoverArtifacts(workspace, nil, []string{"."}); len(paths) != 0 {
		t.Fatalf("discovery offered MilkSU internal state as a deliverable: %#v", paths)
	}
}

func writeArtifactFixture(t *testing.T, path string) {
	t.Helper()
	if err := os.WriteFile(path, []byte("fixture\n"), 0o600); err != nil {
		t.Fatal(err)
	}
}
