package appdata

import (
	"os"
	"path/filepath"
	"testing"
)

func TestDirectoryLivesUnderCurrentUserConfigDirectory(t *testing.T) {
	t.Setenv(DirectoryOverrideEnv, "")
	base, err := os.UserConfigDir()
	if err != nil {
		t.Fatal(err)
	}
	directory, err := Directory()
	if err != nil {
		t.Fatal(err)
	}
	expected := filepath.Join(base, BundleIdentifier)
	if directory != expected {
		t.Fatalf("app data directory = %q, want user-owned path %q", directory, expected)
	}
}

func TestDirectoryCanUseExplicitIsolatedOverride(t *testing.T) {
	override := filepath.Join(t.TempDir(), "milksu-appdata")
	t.Setenv(DirectoryOverrideEnv, override)

	directory, err := Directory()
	if err != nil {
		t.Fatal(err)
	}
	if directory != override {
		t.Fatalf("app data directory = %q, want override %q", directory, override)
	}
}

func TestDirectoryRejectsDangerousOverrides(t *testing.T) {
	for name, value := range map[string]string{
		"relative": "relative/milksu",
		"root":     string(filepath.Separator),
	} {
		t.Run(name, func(t *testing.T) {
			t.Setenv(DirectoryOverrideEnv, value)
			if _, err := Directory(); err == nil {
				t.Fatalf("Directory() accepted %s override %q", name, value)
			}
		})
	}

	if home, err := os.UserHomeDir(); err == nil {
		t.Setenv(DirectoryOverrideEnv, home)
		if _, err := Directory(); err == nil {
			t.Fatalf("Directory() accepted user home override %q", home)
		}
	}
}
