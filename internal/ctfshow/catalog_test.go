package ctfshow

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestCatalogReplacePersistsIndependentSnapshot(t *testing.T) {
	path := filepath.Join(t.TempDir(), "ctfshow", "catalog.sqlite3")
	service, err := NewCatalogService(path)
	if err != nil {
		t.Fatal(err)
	}
	defer service.Close()

	snapshot, err := service.Replace(context.Background(), []CatalogProblem{
		{PlatformID: 12, Title: "web1", Category: "Web", Points: 50, SolvedCount: 28, Tags: []string{"sql"}},
		{PlatformID: 13, Title: "misc1", Category: "Misc", Points: 100, SolvedCount: 9},
	})
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.Total != 2 || snapshot.Problems[0].PlatformID != 13 {
		t.Fatalf("unexpected snapshot: %#v", snapshot)
	}
	if snapshot.Problems[1].SourceURL != "https://ctf.show/challenges#12" {
		t.Fatalf("unexpected challenge URL: %q", snapshot.Problems[1].SourceURL)
	}

	replaced, err := service.Replace(context.Background(), []CatalogProblem{
		{PlatformID: 99, Title: "pwn1", Category: "Pwn", Points: 200},
	})
	if err != nil {
		t.Fatal(err)
	}
	if replaced.Total != 1 || replaced.Problems[0].PlatformID != 99 {
		t.Fatalf("old challenges were not pruned: %#v", replaced)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("catalog mode = %o, want 600", info.Mode().Perm())
	}
}

func TestCatalogSQLiteFilesArePrivate(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("POSIX permission bits are not authoritative on Windows")
	}
	path := filepath.Join(t.TempDir(), "ctfshow", "catalog.sqlite3")
	service, err := NewCatalogService(path)
	if err != nil {
		t.Fatal(err)
	}
	defer service.Close()
	for _, candidate := range []string{path, path + "-wal", path + "-shm"} {
		info, err := os.Stat(candidate)
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			t.Fatal(err)
		}
		if info.Mode().Perm() != 0o600 {
			t.Fatalf("catalog file is not private: %s has %o", candidate, info.Mode().Perm())
		}
	}
}

func TestCatalogRejectsInvalidOrDuplicateChallenges(t *testing.T) {
	service, err := NewCatalogService(filepath.Join(t.TempDir(), "catalog.sqlite3"))
	if err != nil {
		t.Fatal(err)
	}
	defer service.Close()
	if _, err := service.Replace(context.Background(), []CatalogProblem{{PlatformID: 0, Title: "bad"}}); err == nil {
		t.Fatal("expected invalid challenge error")
	}
	if _, err := service.Replace(context.Background(), []CatalogProblem{
		{PlatformID: 1, Title: "first"},
		{PlatformID: 1, Title: "second"},
	}); err == nil {
		t.Fatal("expected duplicate challenge error")
	}
}
