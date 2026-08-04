package vuln

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func writeSnapshotFixture(t *testing.T, root string, name string) string {
	t.Helper()
	directory := filepath.Join(root, "vuln", "feed-snapshots", "nvd")
	if err := os.MkdirAll(directory, 0o700); err != nil {
		t.Fatalf("create snapshot directory: %v", err)
	}
	path := filepath.Join(directory, name)
	if err := os.WriteFile(path, []byte(`{"vulnerabilities":[]}`), 0o600); err != nil {
		t.Fatalf("write snapshot: %v", err)
	}
	return path
}

func TestResolveFeedSnapshotPathAcceptsPersistedSnapshot(t *testing.T) {
	root := t.TempDir()
	snapshotPath := writeSnapshotFixture(t, root, "20260804T070809Z-abcdef1234567890.json")

	resolved, err := ResolveFeedSnapshotPath(root, snapshotPath)
	if err != nil {
		t.Fatalf("ResolveFeedSnapshotPath() error = %v", err)
	}
	if resolved != snapshotPath {
		t.Fatalf("resolved path = %q, want %q", resolved, snapshotPath)
	}
}

func TestResolveFeedSnapshotPathRejectsEscapeAndSymlink(t *testing.T) {
	root := t.TempDir()
	outside := filepath.Join(t.TempDir(), "outside.json")
	if err := os.WriteFile(outside, []byte(`{}`), 0o600); err != nil {
		t.Fatalf("write outside file: %v", err)
	}
	if _, err := ResolveFeedSnapshotPath(root, outside); err == nil ||
		!strings.Contains(err.Error(), "escaped") {
		t.Fatalf("expected escaped path rejection, got %v", err)
	}

	directory := filepath.Join(root, "vuln", "feed-snapshots", "nvd")
	if err := os.MkdirAll(directory, 0o700); err != nil {
		t.Fatalf("create snapshot directory: %v", err)
	}
	linkPath := filepath.Join(directory, "20260804T070809Z-linked.json")
	if err := os.Symlink(outside, linkPath); err != nil {
		t.Skipf("symlink unavailable on this filesystem: %v", err)
	}
	if _, err := ResolveFeedSnapshotPath(root, linkPath); err == nil ||
		!strings.Contains(err.Error(), "symlinks") {
		t.Fatalf("expected symlink rejection, got %v", err)
	}
}

func TestResolveFeedSnapshotPathRejectsRelativeNonJSONAndDirectory(t *testing.T) {
	root := t.TempDir()
	if _, err := ResolveFeedSnapshotPath(root, "vuln/feed-snapshots/nvd/file.json"); err == nil ||
		!strings.Contains(err.Error(), "absolute") {
		t.Fatalf("expected relative path rejection, got %v", err)
	}
	textPath := writeSnapshotFixture(t, root, "20260804T070809Z-abcdef1234567890.txt")
	if _, err := ResolveFeedSnapshotPath(root, textPath); err == nil ||
		!strings.Contains(err.Error(), "JSON") {
		t.Fatalf("expected non-JSON rejection, got %v", err)
	}
	directory := filepath.Join(root, "vuln", "feed-snapshots", "nvd", "20260804T070809Z-directory.json")
	if err := os.MkdirAll(directory, 0o700); err != nil {
		t.Fatalf("create directory fixture: %v", err)
	}
	if _, err := ResolveFeedSnapshotPath(root, directory); err == nil ||
		!strings.Contains(err.Error(), "regular file") {
		t.Fatalf("expected directory rejection, got %v", err)
	}
}

func TestRevealFeedSnapshotInFinderUsesInjectedOpener(t *testing.T) {
	if runtime.GOOS != "darwin" {
		t.Skip("Finder integration is macOS-only")
	}
	var revealed []string
	if err := RevealFeedSnapshotInFinder("/tmp/snapshot.json", func(path string) error {
		revealed = append(revealed, path)
		return nil
	}); err != nil {
		t.Fatalf("RevealFeedSnapshotInFinder() error = %v", err)
	}
	if len(revealed) != 1 || revealed[0] != "/tmp/snapshot.json" {
		t.Fatalf("unexpected revealed paths: %#v", revealed)
	}
	if err := RevealFeedSnapshotInFinder("/tmp/snapshot.json", func(string) error {
		return os.ErrPermission
	}); err == nil || !strings.Contains(err.Error(), "打开 CVE Feed 快照") {
		t.Fatalf("expected opener error, got %v", err)
	}
}
