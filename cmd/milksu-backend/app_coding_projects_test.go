package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCleanAgentWorkspaceName(t *testing.T) {
	valid := map[string]string{
		"milksu":           "milksu",
		"  my project  ":   "my project",
		"项目甲":              "项目甲",
		"trailing dot.":    "trailing dot",
		"windows name . .": "windows name",
	}
	for input, want := range valid {
		got, err := cleanAgentWorkspaceName(input)
		if err != nil {
			t.Fatalf("cleanAgentWorkspaceName(%q) returned error: %v", input, err)
		}
		if got != want {
			t.Fatalf("cleanAgentWorkspaceName(%q) = %q, want %q", input, got, want)
		}
	}

	invalid := []string{
		"",
		"   ",
		".",
		"..",
		"a/b",
		`a\b`,
		"a:b",
		"a?b",
		"a\x00b",
		"a\x7fb",
		strings.Repeat("x", 65),
	}
	for _, input := range invalid {
		if got, err := cleanAgentWorkspaceName(input); err == nil {
			t.Fatalf("cleanAgentWorkspaceName(%q) = %q, want error", input, got)
		}
	}
}

func TestCreateAgentWorkspaceCreatesUniqueDirectories(t *testing.T) {
	parent := t.TempDir()
	first, err := (&App{}).CreateAgentWorkspace(parent, "demo")
	if err != nil {
		t.Fatalf("CreateAgentWorkspace returned error: %v", err)
	}
	if filepath.Base(first) != "demo" {
		t.Fatalf("first project base = %q, want demo", filepath.Base(first))
	}
	second, err := (&App{}).CreateAgentWorkspace(parent, "demo")
	if err != nil {
		t.Fatalf("CreateAgentWorkspace returned error: %v", err)
	}
	if filepath.Base(second) != "demo-2" {
		t.Fatalf("second project base = %q, want demo-2", filepath.Base(second))
	}
	for _, dir := range []string{first, second} {
		info, err := os.Stat(dir)
		if err != nil {
			t.Fatalf("stat %q: %v", dir, err)
		}
		if !info.IsDir() {
			t.Fatalf("%q is not a directory", dir)
		}
	}
}

func TestCreateAgentWorkspaceRejectsBadParentAndName(t *testing.T) {
	parent := t.TempDir()
	if _, err := (&App{}).CreateAgentWorkspace(filepath.Join(parent, "missing"), "demo"); err == nil {
		t.Fatal("CreateAgentWorkspace with a missing parent returned no error")
	}
	if _, err := (&App{}).CreateAgentWorkspace(parent, "a/b"); err == nil {
		t.Fatal("CreateAgentWorkspace with a reserved name returned no error")
	}
}
