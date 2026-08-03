package appdata

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestBeginLifespanFirstRun(t *testing.T) {
	root := t.TempDir()
	start, handle, err := BeginLifespan(root, 4242)
	if err != nil {
		t.Fatal(err)
	}
	if !handle.Valid() {
		t.Fatal("missing lifespan handle")
	}
	if start.PreviousExit != LifespanExitNone {
		t.Fatalf("previous exit = %q, want none", start.PreviousExit)
	}
	if start.ConsecutiveAbnormalExits != 0 {
		t.Fatalf("consecutive abnormal exits = %d, want 0", start.ConsecutiveAbnormalExits)
	}
	if start.StartedAt == "" {
		t.Fatal("missing started timestamp")
	}
	state, err := ReadLifespanState(root)
	if err != nil {
		t.Fatal(err)
	}
	if state.LastExit != LifespanExitRunning {
		t.Fatalf("persisted exit = %q, want running", state.LastExit)
	}
	if state.PID != 4242 {
		t.Fatalf("persisted pid = %d, want 4242", state.PID)
	}
	if state.RunID == "" {
		t.Fatal("persisted run id is empty")
	}
	if state.Schema != LifespanSchema {
		t.Fatalf("schema = %q, want %q", state.Schema, LifespanSchema)
	}
}

func TestBeginLifespanAfterCleanExit(t *testing.T) {
	root := t.TempDir()
	_, firstHandle, err := BeginLifespan(root, 1)
	if err != nil {
		t.Fatal(err)
	}
	if err := MarkCleanExit(root, firstHandle); err != nil {
		t.Fatal(err)
	}
	start, _, err := BeginLifespan(root, 2)
	if err != nil {
		t.Fatal(err)
	}
	if start.PreviousExit != LifespanExitClean {
		t.Fatalf("previous exit = %q, want clean", start.PreviousExit)
	}
	if start.ConsecutiveAbnormalExits != 0 {
		t.Fatalf("consecutive abnormal exits = %d, want 0", start.ConsecutiveAbnormalExits)
	}
	if start.LastCleanExitAt == "" {
		t.Fatal("missing last clean exit timestamp")
	}
	if start.PreviousPID != 1 {
		t.Fatalf("previous pid = %d, want 1", start.PreviousPID)
	}
}

func TestBeginLifespanDetectsAbnormalExit(t *testing.T) {
	root := t.TempDir()
	first, _, err := BeginLifespan(root, 11)
	if err != nil {
		t.Fatal(err)
	}
	// No MarkCleanExit: the first run is treated as terminated abnormally.
	second, _, err := BeginLifespan(root, 12)
	if err != nil {
		t.Fatal(err)
	}
	if second.PreviousExit != LifespanExitAbnormal {
		t.Fatalf("previous exit = %q, want abnormal", second.PreviousExit)
	}
	if second.ConsecutiveAbnormalExits != 1 {
		t.Fatalf("consecutive abnormal exits = %d, want 1", second.ConsecutiveAbnormalExits)
	}
	if second.PreviousStartedAt != first.StartedAt {
		t.Fatalf("previous started at = %q, want %q", second.PreviousStartedAt, first.StartedAt)
	}
	if second.PreviousPID != 11 {
		t.Fatalf("previous pid = %d, want 11", second.PreviousPID)
	}
}

func TestConsecutiveAbnormalExitsResetByCleanExit(t *testing.T) {
	root := t.TempDir()
	for run := 0; run < 3; run++ {
		if _, _, err := BeginLifespan(root, run+100); err != nil {
			t.Fatal(err)
		}
	}
	start, currentHandle, err := BeginLifespan(root, 200)
	if err != nil {
		t.Fatal(err)
	}
	if start.ConsecutiveAbnormalExits != 3 {
		t.Fatalf("consecutive abnormal exits = %d, want 3", start.ConsecutiveAbnormalExits)
	}
	if err := MarkCleanExit(root, currentHandle); err != nil {
		t.Fatal(err)
	}
	start, _, err = BeginLifespan(root, 201)
	if err != nil {
		t.Fatal(err)
	}
	if start.PreviousExit != LifespanExitClean {
		t.Fatalf("previous exit = %q, want clean", start.PreviousExit)
	}
	if start.ConsecutiveAbnormalExits != 0 {
		t.Fatalf("consecutive abnormal exits after clean exit = %d, want 0", start.ConsecutiveAbnormalExits)
	}
}

func TestMarkCleanExitRejectsEmptyOrStaleHandle(t *testing.T) {
	root := t.TempDir()
	if err := MarkCleanExit(root, LifespanHandle{}); err == nil {
		t.Fatal("expected empty lifespan handle to be rejected")
	}
	_, staleHandle, err := BeginLifespan(root, 7)
	if err != nil {
		t.Fatal(err)
	}
	_, currentHandle, err := BeginLifespan(root, 8)
	if err != nil {
		t.Fatal(err)
	}
	if err := MarkCleanExit(root, staleHandle); err == nil {
		t.Fatal("expected stale lifespan handle to be rejected")
	}
	state, err := ReadLifespanState(root)
	if err != nil {
		t.Fatal(err)
	}
	if state.LastExit != LifespanExitRunning || state.PID != 8 {
		t.Fatalf("stale handle changed current marker: %#v", state)
	}
	if err := MarkCleanExit(root, currentHandle); err != nil {
		t.Fatal(err)
	}
}

func TestLifespanFilePermissionsAndLayout(t *testing.T) {
	root := t.TempDir()
	if _, _, err := BeginLifespan(root, 9); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(filepath.Join(root, LifespanFile))
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("lifespan file permissions = %o, want 600", info.Mode().Perm())
	}
	payload, err := os.ReadFile(filepath.Join(root, LifespanFile))
	if err != nil {
		t.Fatal(err)
	}
	for _, forbidden := range []string{
		"message",
		"content",
		"prompt",
		"output",
		"api_key",
		"token",
		"credential",
	} {
		if strings.Contains(string(payload), forbidden) {
			t.Fatalf("lifespan file must not carry %q-like fields: %s", forbidden, payload)
		}
	}
}

func TestLifespanRejectsSymlink(t *testing.T) {
	root := t.TempDir()
	target := filepath.Join(t.TempDir(), "outside")
	if err := os.WriteFile(target, []byte(`{"schema":"milksu-lifespan/v1","lastExit":"clean"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(target, filepath.Join(root, LifespanFile)); err != nil {
		t.Fatal(err)
	}
	if _, _, err := BeginLifespan(root, 5); err == nil {
		t.Fatal("expected BeginLifespan to reject a symlinked marker")
	}
	if _, err := ReadLifespanState(root); err == nil {
		t.Fatal("expected ReadLifespanState to reject a symlinked marker")
	}
}

func TestLifespanRejectsCorruptOrForeignFile(t *testing.T) {
	root := t.TempDir()
	cases := map[string]string{
		"corrupt.json":  `{"schema":`,
		"foreign.json":  `{"schema":"other/v2","lastExit":"clean"}`,
		"extra-field":   `{"schema":"milksu-lifespan/v1","lastExit":"clean","secret":"sk-abcdef123456"}`,
		"invalid-exit":  `{"schema":"milksu-lifespan/v1","lastExit":"unknown"}`,
		"trailing.json": `{"schema":"milksu-lifespan/v1","lastExit":"clean"}{"x":1}`,
	}
	for name, payload := range cases {
		t.Run(name, func(t *testing.T) {
			if err := os.WriteFile(
				filepath.Join(root, LifespanFile),
				[]byte(payload),
				0o600,
			); err != nil {
				t.Fatal(err)
			}
			if _, _, err := BeginLifespan(root, 5); err == nil {
				t.Fatalf("expected BeginLifespan to reject %s", name)
			}
		})
	}
}
