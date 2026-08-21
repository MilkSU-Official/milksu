package codingworkspace

import (
	"os"
	"path/filepath"
	"testing"
)

func mustResolve(t *testing.T, path string) string {
	t.Helper()
	resolved, err := filepath.EvalSymlinks(path)
	if err != nil {
		t.Fatal(err)
	}
	return filepath.Clean(resolved)
}

func TestRememberAndForgetRoundTrip(t *testing.T) {
	t.Setenv("MILKSU_APPDATA_DIR", t.TempDir())
	store, err := NewStore()
	if err != nil {
		t.Fatal(err)
	}
	first := mustResolve(t, t.TempDir())
	second := mustResolve(t, t.TempDir())
	if _, err := store.Remember(first); err != nil {
		t.Fatal(err)
	}
	got, err := store.Remember(second)
	if err != nil {
		t.Fatal(err)
	}
	if got.LastWorkspacePath != second {
		t.Fatalf("last workspace = %q", got.LastWorkspacePath)
	}
	if got.EffectiveWorkspace != second {
		t.Fatalf("effective workspace = %q", got.EffectiveWorkspace)
	}
	if len(got.Recents) != 2 || got.Recents[0].Path != second || got.Recents[1].Path != first {
		t.Fatalf("recents = %#v", got.Recents)
	}
	forgotten, err := store.Forget(second)
	if err != nil {
		t.Fatal(err)
	}
	if forgotten.LastWorkspacePath != first {
		t.Fatalf("last after forget = %q", forgotten.LastWorkspacePath)
	}
	if len(forgotten.Recents) != 1 || forgotten.Recents[0].Path != first {
		t.Fatalf("recents after forget = %#v", forgotten.Recents)
	}
}

func TestGetFallsBackToHomeWhenLastProjectIsMissing(t *testing.T) {
	t.Setenv("MILKSU_APPDATA_DIR", t.TempDir())
	store, err := NewStore()
	if err != nil {
		t.Fatal(err)
	}
	missing := filepath.Join(t.TempDir(), "gone")
	memory := storedMemory{LastWorkspacePath: missing}
	if err := store.writeLocked(memory); err != nil {
		t.Fatal(err)
	}
	got, err := store.Get()
	if err != nil {
		t.Fatal(err)
	}
	home, err := os.UserHomeDir()
	if err != nil {
		t.Fatal(err)
	}
	if got.EffectiveWorkspace != filepath.Clean(home) {
		t.Fatalf("effective workspace = %q, want home %q", got.EffectiveWorkspace, home)
	}
}

func TestRememberSkipsGeneratedScratchWorkspaces(t *testing.T) {
	t.Setenv("MILKSU_APPDATA_DIR", t.TempDir())
	store, err := NewStore()
	if err != nil {
		t.Fatal(err)
	}
	scratch := filepath.Join(t.TempDir(), "MilkSU", "Coding", "新编码任务-abcd1234")
	if err := os.MkdirAll(scratch, 0o700); err != nil {
		t.Fatal(err)
	}
	got, err := store.Remember(scratch)
	if err != nil {
		t.Fatal(err)
	}
	if got.LastWorkspacePath != "" || len(got.Recents) != 0 {
		t.Fatalf("scratch workspace was remembered: %#v", got)
	}
}
