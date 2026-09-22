package codingenv

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestDiscoverImagesFindsRecentPNG(t *testing.T) {
	workspace := t.TempDir()
	assets := filepath.Join(workspace, "assets")
	if err := os.MkdirAll(assets, 0o700); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(assets, "hero.png")
	if err := os.WriteFile(path, []byte("png"), 0o600); err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	if err := os.Chtimes(path, now, now); err != nil {
		t.Fatal(err)
	}
	paths := DiscoverImages(workspace, nil, []string{"assets"})
	if len(paths) != 1 || paths[0] != "assets/hero.png" {
		t.Fatalf("paths = %#v", paths)
	}
}

func TestDiscoverImagesSkipsNonImages(t *testing.T) {
	workspace := t.TempDir()
	if err := os.WriteFile(filepath.Join(workspace, "notes.md"), []byte("# hi"), 0o600); err != nil {
		t.Fatal(err)
	}
	if paths := DiscoverImages(workspace, nil, []string{"."}); len(paths) != 0 {
		t.Fatalf("unexpected paths %#v", paths)
	}
}
