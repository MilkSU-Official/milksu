package appdata

import (
	"os"
	"path/filepath"
	"testing"
)

func TestDirectoryLivesUnderUnifiedHome(t *testing.T) {
	t.Setenv(DirectoryOverrideEnv, "")
	t.Setenv(HomeOverrideEnv, "")
	home, err := os.UserHomeDir()
	if err != nil {
		t.Fatal(err)
	}
	directory, err := Directory()
	if err != nil {
		t.Fatal(err)
	}
	expected := filepath.Join(home, ".milksu", "data")
	if directory != expected {
		t.Fatalf("app data directory = %q, want unified home path %q", directory, expected)
	}
}

func TestDirectoryCanUseExplicitIsolatedOverride(t *testing.T) {
	override := filepath.Join(t.TempDir(), "milksu-appdata")
	t.Setenv(DirectoryOverrideEnv, override)
	t.Setenv(HomeOverrideEnv, "")

	directory, err := Directory()
	if err != nil {
		t.Fatal(err)
	}
	// The override names the whole state root, not the data directory.
	expected := filepath.Join(override, "data")
	if directory != expected {
		t.Fatalf("app data directory = %q, want override data path %q", directory, expected)
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
