package userartifact

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestEnsureCreatesVisibleSections(t *testing.T) {
	root := filepath.Join(t.TempDir(), "MilkSU")
	resolved, err := Ensure(root)
	if err != nil {
		t.Fatal(err)
	}
	if resolved != root {
		t.Fatalf("Ensure() = %q, want %q", resolved, root)
	}
	for _, name := range []string{"Coding", "CTF", "CVE"} {
		info, statErr := os.Stat(filepath.Join(root, name))
		if statErr != nil || !info.IsDir() {
			t.Fatalf("artifact section %s was not created: %v", name, statErr)
		}
		if runtime.GOOS != "windows" && info.Mode().Perm() != 0o700 {
			t.Fatalf("artifact section %s mode = %o, want 700", name, info.Mode().Perm())
		}
	}
}

func TestEnsureKeepsAlreadyProtectedVisibleSections(t *testing.T) {
	root := filepath.Join(t.TempDir(), "MilkSU")
	for _, directory := range []string{root, filepath.Join(root, "Coding"), filepath.Join(root, "CTF"), filepath.Join(root, "CVE")} {
		if err := os.MkdirAll(directory, 0o700); err != nil {
			t.Fatal(err)
		}
		if err := os.Chmod(directory, 0o700); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := Ensure(root); err != nil {
		t.Fatal(err)
	}
}

func TestWorkspaceUsesReadableNamesAndDiscoveryBoundary(t *testing.T) {
	root := filepath.Join(t.TempDir(), "MilkSU")
	cve, err := Workspace(root, KindCVE, "cve-research-cve-2024-3400", "cve-2024-3400")
	if err != nil {
		t.Fatal(err)
	}
	if filepath.Base(cve) != "CVE-2024-3400" {
		t.Fatalf("CVE workspace = %q", cve)
	}
	coding, err := Workspace(root, KindCoding, "conversation-one", "分析附件中的登录逻辑")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(filepath.Base(coding), "分析附件中的登录逻辑-") {
		t.Fatalf("Coding workspace = %q", coding)
	}
	if info, statErr := os.Stat(filepath.Join(coding, ".git")); statErr != nil || !info.IsDir() {
		t.Fatalf("Coding discovery boundary was not created: %v", statErr)
	}
}

func TestDirectoryRejectsBroadRoots(t *testing.T) {
	for _, path := range []string{"relative", string(filepath.Separator)} {
		if _, err := Ensure(path); err == nil {
			t.Fatalf("Ensure(%q) unexpectedly succeeded", path)
		}
	}
	if home, err := os.UserHomeDir(); err == nil {
		if _, err := Ensure(home); err == nil {
			t.Fatalf("Ensure(home) unexpectedly succeeded")
		}
	}
}

func TestWorkspaceRejectsPreexistingSymlink(t *testing.T) {
	root := filepath.Join(t.TempDir(), "MilkSU")
	section, err := Section(root, KindCVE)
	if err != nil {
		t.Fatal(err)
	}
	outside := t.TempDir()
	if err := os.Symlink(outside, filepath.Join(section, "CVE-2024-3400")); err != nil {
		t.Fatal(err)
	}
	if _, err := Workspace(root, KindCVE, "cve-2024-3400", "CVE-2024-3400"); err == nil {
		t.Fatal("Workspace() accepted a preexisting symlink")
	}
}
