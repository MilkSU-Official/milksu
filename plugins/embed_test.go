package plugins

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestMaterializeOfficialCreatesStableVerifiedSnapshot(t *testing.T) {
	dataDirectory := t.TempDir()
	files, digest, err := embeddedOfficialFiles()
	if err != nil {
		t.Fatal(err)
	}
	if len(files) == 0 || len(digest) != 64 {
		t.Fatalf("embedded official inventory = %d files, digest %q", len(files), digest)
	}
	root, err := MaterializeOfficial(dataDirectory)
	if err != nil {
		t.Fatal(err)
	}
	if filepath.Base(filepath.Dir(root)) != digest || filepath.Base(root) != "official" {
		t.Fatalf("materialized root = %q, want content-addressed %q/official", root, digest)
	}
	if err := verifyMaterializedOfficial(root, files); err != nil {
		t.Fatal(err)
	}
	again, err := MaterializeOfficial(dataDirectory)
	if err != nil {
		t.Fatal(err)
	}
	if again != root {
		t.Fatalf("second materialization root = %q, want %q", again, root)
	}
}

func TestMaterializeOfficialFailsClosedOnCacheTamper(t *testing.T) {
	dataDirectory := t.TempDir()
	files, _, err := embeddedOfficialFiles()
	if err != nil {
		t.Fatal(err)
	}
	root, err := MaterializeOfficial(dataDirectory)
	if err != nil {
		t.Fatal(err)
	}
	tampered := filepath.Join(root, filepath.FromSlash(files[0].path))
	if err := os.WriteFile(tampered, []byte("tampered"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := MaterializeOfficial(dataDirectory); err == nil || !strings.Contains(err.Error(), "does not match") {
		t.Fatalf("tampered embedded cache error = %v", err)
	}
}

func TestVerifyMaterializedOfficialRejectsExtraFileAndSymlink(t *testing.T) {
	dataDirectory := t.TempDir()
	files, _, err := embeddedOfficialFiles()
	if err != nil {
		t.Fatal(err)
	}
	root, err := MaterializeOfficial(dataDirectory)
	if err != nil {
		t.Fatal(err)
	}
	extra := filepath.Join(root, "unexpected.txt")
	if err := os.WriteFile(extra, []byte("unexpected"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := verifyMaterializedOfficial(root, files); err == nil || !strings.Contains(err.Error(), "file count") {
		t.Fatalf("extra embedded cache file error = %v", err)
	}
	if err := os.Remove(extra); err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(root, filepath.FromSlash(files[0].path))
	link := filepath.Join(root, "unexpected-link")
	if err := os.Symlink(target, link); err != nil {
		t.Skipf("symlink unavailable: %v", err)
	}
	if err := verifyMaterializedOfficial(root, files); err == nil || !strings.Contains(err.Error(), "symlink") {
		t.Fatalf("embedded cache symlink error = %v", err)
	}
}

func TestSafeDestinationRejectsEscapes(t *testing.T) {
	root := t.TempDir()
	for _, relative := range []string{".", "../outside", "nested/../../outside", "/absolute"} {
		if _, err := safeDestination(root, relative); err == nil {
			t.Errorf("safeDestination accepted %q", relative)
		}
	}
}
