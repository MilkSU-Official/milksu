package appdata

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestEnsureDataLayoutCreatesPrivateCurrentMarker(t *testing.T) {
	directory := t.TempDir()
	if err := ensureDataLayout(directory); err != nil {
		t.Fatal(err)
	}
	layout, err := ReadDataLayout(directory)
	if err != nil {
		t.Fatal(err)
	}
	if layout.Schema != DataLayoutSchema ||
		layout.Version != CurrentDataLayoutVersion ||
		layout.UpdatedAt == "" {
		t.Fatalf("unexpected data layout: %#v", layout)
	}
	info, err := os.Stat(filepath.Join(directory, DataLayoutFile))
	if err != nil {
		t.Fatal(err)
	}
	if runtime.GOOS != "windows" && info.Mode().Perm() != 0o600 {
		t.Fatalf("data layout permissions = %o, want 600", info.Mode().Perm())
	}
}

func TestEnsureDataLayoutIsIdempotent(t *testing.T) {
	directory := t.TempDir()
	layout := DataLayout{
		Schema:    DataLayoutSchema,
		Version:   CurrentDataLayoutVersion,
		UpdatedAt: "2026-01-02T03:04:05Z",
	}
	writeDataLayoutFixture(t, directory, layout)
	before, err := os.ReadFile(filepath.Join(directory, DataLayoutFile))
	if err != nil {
		t.Fatal(err)
	}
	time.Sleep(time.Millisecond)
	if err := ensureDataLayout(directory); err != nil {
		t.Fatal(err)
	}
	after, err := os.ReadFile(filepath.Join(directory, DataLayoutFile))
	if err != nil {
		t.Fatal(err)
	}
	if string(after) != string(before) {
		t.Fatalf("current layout was rewritten:\nbefore=%s\nafter=%s", before, after)
	}
}

func TestEnsureDataLayoutMigratesLegacyVersionZero(t *testing.T) {
	directory := t.TempDir()
	writeDataLayoutFixture(t, directory, DataLayout{
		Schema:    DataLayoutSchema,
		Version:   0,
		UpdatedAt: "2026-01-02T03:04:05Z",
	})
	if err := ensureDataLayout(directory); err != nil {
		t.Fatal(err)
	}
	layout, err := ReadDataLayout(directory)
	if err != nil {
		t.Fatal(err)
	}
	if layout.Version != CurrentDataLayoutVersion ||
		layout.UpdatedAt == "2026-01-02T03:04:05Z" {
		t.Fatalf("legacy layout was not migrated: %#v", layout)
	}
}

func TestEnsureDataLayoutRejectsFutureVersionWithoutOverwriting(t *testing.T) {
	directory := t.TempDir()
	future := DataLayout{
		Schema:    DataLayoutSchema,
		Version:   CurrentDataLayoutVersion + 1,
		UpdatedAt: "2030-01-02T03:04:05Z",
	}
	writeDataLayoutFixture(t, directory, future)
	before, err := os.ReadFile(filepath.Join(directory, DataLayoutFile))
	if err != nil {
		t.Fatal(err)
	}
	err = ensureDataLayout(directory)
	if err == nil || !strings.Contains(err.Error(), "newer than this app supports") {
		t.Fatalf("future layout was not rejected clearly: %v", err)
	}
	after, readErr := os.ReadFile(filepath.Join(directory, DataLayoutFile))
	if readErr != nil {
		t.Fatal(readErr)
	}
	if string(after) != string(before) {
		t.Fatalf("future layout was overwritten:\nbefore=%s\nafter=%s", before, after)
	}
}

func TestEnsureDataLayoutRejectsSymlinkMarker(t *testing.T) {
	directory := t.TempDir()
	target := filepath.Join(t.TempDir(), "outside.json")
	if err := os.WriteFile(target, []byte(`{"schema":"outside"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(target, filepath.Join(directory, DataLayoutFile)); err != nil {
		t.Fatal(err)
	}
	if err := ensureDataLayout(directory); err == nil {
		t.Fatal("expected symlink data layout to be rejected")
	}
}

func writeDataLayoutFixture(t *testing.T, directory string, layout DataLayout) {
	t.Helper()
	payload, err := json.Marshal(layout)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(directory, DataLayoutFile), payload, 0o600); err != nil {
		t.Fatal(err)
	}
}
