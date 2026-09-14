package codingcollab

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

// A writer worktree is populated on macOS, Linux and Windows, so the copy that
// reproduces a .worktreeinclude path cannot depend on a platform copy utility.
// A dependency directory carries symbolic links and executable files, and both
// have to arrive intact for the copied tree to be usable.
func TestCopyPathReproducesADependencyTree(t *testing.T) {
	root := t.TempDir()
	source := filepath.Join(root, "node_modules")
	if err := os.MkdirAll(filepath.Join(source, ".bin"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(source, "index.js"), []byte("module.exports = 1\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(source, ".bin", "tool"), []byte("#!/bin/sh\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join("..", "index.js"), filepath.Join(source, ".bin", "index.js")); err != nil {
		t.Skipf("this platform cannot create the symlink the fixture needs: %v", err)
	}

	destination := filepath.Join(root, "writer-1", "node_modules")
	if err := copyPath(t.Context(), source, destination); err != nil {
		t.Fatalf("copy dependency tree: %v", err)
	}

	link, err := os.Lstat(filepath.Join(destination, ".bin", "index.js"))
	if err != nil {
		t.Fatalf("copied tree lost its symlink: %v", err)
	}
	if link.Mode()&os.ModeSymlink == 0 {
		t.Fatal("the copy followed a symlink instead of reproducing it")
	}
	executable, err := os.Stat(filepath.Join(destination, ".bin", "tool"))
	if err != nil {
		t.Fatal(err)
	}
	if executable.Mode()&0o111 == 0 {
		t.Fatalf("the copy dropped the execute bit: %v", executable.Mode())
	}
	body, err := os.ReadFile(filepath.Join(destination, "index.js"))
	if err != nil || string(body) != "module.exports = 1\n" {
		t.Fatalf("copied file content = %q, err = %v", body, err)
	}
}

// Preparation runs under a deadline because copying a dependency directory takes
// minutes. A copy that ignored the context would keep writing into a worktree the
// caller has already given up on.
func TestCopyTreeStopsWhenThePreparationIsCancelled(t *testing.T) {
	root := t.TempDir()
	source := filepath.Join(root, "source")
	if err := os.MkdirAll(source, 0o755); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"a.txt", "b.txt", "c.txt"} {
		if err := os.WriteFile(filepath.Join(source, name), []byte(name), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	cancelled, cancel := context.WithCancel(t.Context())
	cancel()
	destination := filepath.Join(root, "destination")
	if err := copyTree(cancelled, source, destination); err == nil {
		t.Fatal("a cancelled preparation still copied the tree")
	}
	entries, err := os.ReadDir(destination)
	if err != nil && !os.IsNotExist(err) {
		t.Fatal(err)
	}
	if len(entries) != 0 {
		t.Fatalf("a cancelled copy still wrote %d entries", len(entries))
	}
}
