package securityruntime

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestArtifactStoreIsContentAddressedAndIdempotent(t *testing.T) {
	root := t.TempDir()
	store, err := NewArtifactStore(root)
	if err != nil {
		t.Fatal(err)
	}
	data := []byte("committed observation")
	first, created, err := store.Put(context.Background(), "job_artifact", "action_one", "text/plain", data)
	if err != nil {
		t.Fatal(err)
	}
	if !created {
		t.Fatal("first write must create the artifact")
	}
	second, created, err := store.Put(context.Background(), "job_artifact", "action_two", "text/plain", data)
	if err != nil {
		t.Fatal(err)
	}
	if created {
		t.Fatal("identical second write must reuse the artifact")
	}
	if first.ID != second.ID || first.RelativePath != second.RelativePath {
		t.Fatalf("content address changed: %#v %#v", first, second)
	}
	read, err := store.Read(context.Background(), second)
	if err != nil {
		t.Fatal(err)
	}
	if string(read) != string(data) {
		t.Fatalf("unexpected artifact content %q", read)
	}
	info, err := os.Stat(filepath.Join(root, first.RelativePath))
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("artifact permissions = %o", info.Mode().Perm())
	}
}

func TestArtifactStoreRejectsPathExpansionAndTampering(t *testing.T) {
	store, err := NewArtifactStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := store.Put(context.Background(), "../escape", "action_one", "text/plain", []byte("x")); err == nil {
		t.Fatal("path-like job id was accepted")
	}
	artifact, _, err := store.Put(context.Background(), "job_safe", "action_one", "text/plain", []byte("safe"))
	if err != nil {
		t.Fatal(err)
	}
	artifact.RelativePath = "../settings.json"
	if _, err := store.Read(context.Background(), artifact); err == nil {
		t.Fatal("tampered artifact path was accepted")
	}
}
