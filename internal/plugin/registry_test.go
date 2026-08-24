package plugin

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestOfficialPluginLockMatchesPackages(t *testing.T) {
	root := filepath.Join("..", "..", "plugins", "official")
	lock, err := readLockFile(filepath.Join(root, lockFileName))
	if err != nil {
		t.Fatal(err)
	}
	locked := make(map[string]LockEntry, len(lock.Plugins))
	for _, entry := range lock.Plugins {
		locked[entry.ID] = entry
	}
	entries, err := os.ReadDir(root)
	if err != nil {
		t.Fatal(err)
	}
	seen := 0
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		directory := filepath.Join(root, entry.Name())
		manifest, err := readManifest(directory)
		if err != nil {
			t.Fatalf("read %s manifest: %v", entry.Name(), err)
		}
		digest, err := packageDigest(directory)
		if err != nil {
			t.Fatalf("digest %s: %v", entry.Name(), err)
		}
		t.Logf("%s %s", manifest.ID, digest)
		lockedEntry, ok := locked[manifest.ID]
		if !ok {
			t.Errorf("official package %s is missing from lock", manifest.ID)
			continue
		}
		if lockedEntry.Version != manifest.Version || !strings.EqualFold(lockedEntry.SHA256, digest) {
			t.Errorf("official package %s does not match lock: version=%s digest=%s", manifest.ID, manifest.Version, digest)
		}
		seen++
	}
	if seen != len(lock.Plugins) {
		t.Errorf("validated %d official packages, lock contains %d", seen, len(lock.Plugins))
	}
}

func TestPackageDigestRejectsSymlink(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "entry.txt"), []byte("entry"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(root, "entry.txt"), filepath.Join(root, "link.txt")); err != nil {
		t.Skipf("symlink unavailable: %v", err)
	}
	if _, err := packageDigest(root); err == nil || !strings.Contains(err.Error(), "symlink") {
		t.Fatalf("packageDigest symlink error = %v", err)
	}
}
