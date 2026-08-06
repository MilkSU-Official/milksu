package main

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/MilkSU-Official/milksu/internal/appdata"
)

func TestSingleInstanceUniqueIDUsesDefault(t *testing.T) {
	t.Setenv(instanceIDEnv, "")
	if got := singleInstanceUniqueID(); got != appdata.BundleIdentifier {
		t.Fatalf("singleInstanceUniqueID() = %q, want %q", got, appdata.BundleIdentifier)
	}
}

func TestSingleInstanceUniqueIDUsesSafeSuffix(t *testing.T) {
	t.Setenv(instanceIDEnv, "codex-ui-qa.1")
	expected := appdata.BundleIdentifier + ".codex-ui-qa.1"
	if got := singleInstanceUniqueID(); got != expected {
		t.Fatalf("singleInstanceUniqueID() = %q, want %q", got, expected)
	}
}

func TestSingleInstanceUniqueIDRejectsUnsafeSuffix(t *testing.T) {
	for name, value := range map[string]string{
		"slash":      "codex/ui",
		"whitespace": "codex ui",
		"empty":      "",
	} {
		t.Run(name, func(t *testing.T) {
			t.Setenv(instanceIDEnv, value)
			if got := singleInstanceUniqueID(); got != appdata.BundleIdentifier {
				t.Fatalf("singleInstanceUniqueID() = %q, want default %q", got, appdata.BundleIdentifier)
			}
		})
	}
}

func TestNormalizeAgentWorkspaceSelectionCanonicalizesDirectories(t *testing.T) {
	target := t.TempDir()
	parent := t.TempDir()
	link := filepath.Join(parent, "milksu-link")
	if err := os.Symlink(target, link); err != nil {
		t.Skipf("symlink unavailable: %v", err)
	}

	resolved, err := normalizeAgentWorkspaceSelection(link + string(os.PathSeparator))
	if err != nil {
		t.Fatal(err)
	}
	expected, err := filepath.EvalSymlinks(target)
	if err != nil {
		t.Fatal(err)
	}
	if resolved != filepath.Clean(expected) {
		t.Fatalf("normalizeAgentWorkspaceSelection() = %q, want %q", resolved, expected)
	}
}
