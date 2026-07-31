package appdata

import (
	"os"
	"path/filepath"
	"testing"
)

func TestDirectoryLivesUnderCurrentUserConfigDirectory(t *testing.T) {
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
