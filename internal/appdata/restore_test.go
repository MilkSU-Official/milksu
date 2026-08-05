package appdata

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestBackupRestoreRoundTripPreservesCredentialsAndCreatesRollback(t *testing.T) {
	backupRoot := t.TempDir()
	writeBackupFixture(
		t,
		filepath.Join(backupRoot, DataLayoutFile),
		`{"schema":"milksu-data-layout/v1","version":1,"updatedAt":"2026-08-02T00:00:00Z"}`,
	)
	writeBackupFixture(
		t,
		filepath.Join(backupRoot, "settings.json"),
		`{"locale":"zh","providers":{"deepseek":{"api_key":"must-not-restore","has_api_key":true}}}`,
	)
	writeBackupFixture(t, filepath.Join(backupRoot, "conversations", "restored.json"), `{"id":"restored"}`)
	writeBackupFixture(t, filepath.Join(backupRoot, "ctf-workspaces", "job", "notes.md"), "restored evidence")
	archive := filepath.Join(t.TempDir(), "backup.zip")
	if _, err := ExportBackup(context.Background(), backupRoot, archive); err != nil {
		t.Fatal(err)
	}

	liveRoot := t.TempDir()
	writeBackupFixture(
		t,
		filepath.Join(liveRoot, DataLayoutFile),
		`{"schema":"milksu-data-layout/v1","version":1,"updatedAt":"2026-08-02T01:00:00Z"}`,
	)
	writeBackupFixture(t, filepath.Join(liveRoot, "settings.json"), `{"locale":"en"}`)
	writeBackupFixture(t, filepath.Join(liveRoot, "conversations", "current.json"), `{"id":"current"}`)
	writeBackupFixture(t, filepath.Join(liveRoot, "credentials.db"), "provider-secret")
	writeBackupFixture(t, filepath.Join(liveRoot, "browser", "bridge-pairing.json"), "pairing-secret")
	writeBackupFixture(t, filepath.Join(liveRoot, "agent-home", "pi", "auth.json"), "pi-secret")
	writeBackupFixture(t, filepath.Join(liveRoot, "ctf", "memory.sqlite3-wal"), "stale-wal")

	staged, err := StageBackupRestore(liveRoot, archive)
	if err != nil {
		t.Fatal(err)
	}
	if staged.Cancelled || !staged.RequiresRestart || staged.FileCount != 4 {
		t.Fatalf("unexpected staged restore: %#v", staged)
	}
	result, err := ApplyPendingRestore(liveRoot)
	if err != nil {
		t.Fatal(err)
	}
	if !result.Applied || result.FileCount != staged.FileCount || result.RollbackPath == "" {
		t.Fatalf("unexpected restore result: %#v", result)
	}
	assertBackupFixture(t, filepath.Join(liveRoot, "conversations", "restored.json"), `{"id":"restored"}`)
	if _, err := os.Stat(filepath.Join(liveRoot, "conversations", "current.json")); !os.IsNotExist(err) {
		t.Fatalf("current conversation was not replaced: %v", err)
	}
	assertBackupFixture(t, filepath.Join(liveRoot, "ctf-workspaces", "job", "notes.md"), "restored evidence")
	assertBackupFixture(t, filepath.Join(liveRoot, "credentials.db"), "provider-secret")
	assertBackupFixture(t, filepath.Join(liveRoot, "browser", "bridge-pairing.json"), "pairing-secret")
	assertBackupFixture(t, filepath.Join(liveRoot, "agent-home", "pi", "auth.json"), "pi-secret")
	if _, err := os.Stat(filepath.Join(liveRoot, "ctf", "memory.sqlite3-wal")); !os.IsNotExist(err) {
		t.Fatalf("stale SQLite WAL survived restore: %v", err)
	}
	settings, err := os.ReadFile(filepath.Join(liveRoot, "settings.json"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(settings), "must-not-restore") || strings.Contains(string(settings), `"api_key"`) {
		t.Fatalf("restored settings contained a credential: %s", settings)
	}
	assertBackupFixture(
		t,
		filepath.Join(result.RollbackPath, "conversations", "current.json"),
		`{"id":"current"}`,
	)
	assertBackupFixture(t, filepath.Join(result.RollbackPath, "ctf", "memory.sqlite3-wal"), "stale-wal")
	if _, err := os.Stat(filepath.Join(result.RollbackPath, "applied-backup.zip")); err != nil {
		t.Fatalf("applied backup was not retained with rollback snapshot: %v", err)
	}
	if _, err := os.Stat(filepath.Join(liveRoot, restoreDirectoryName, pendingRestoreName)); !os.IsNotExist(err) {
		t.Fatalf("pending restore was not consumed: %v", err)
	}
}

func TestStageBackupRestoreRejectsFutureDataLayout(t *testing.T) {
	backupRoot := t.TempDir()
	writeBackupFixture(
		t,
		filepath.Join(backupRoot, DataLayoutFile),
		`{"schema":"milksu-data-layout/v1","version":2,"updatedAt":"2026-08-02T00:00:00Z"}`,
	)
	writeBackupFixture(t, filepath.Join(backupRoot, "conversations", "one.json"), `{"id":"one"}`)
	archive := filepath.Join(t.TempDir(), "future.zip")
	if _, err := ExportBackup(context.Background(), backupRoot, archive); err != nil {
		t.Fatal(err)
	}
	liveRoot := t.TempDir()
	writeBackupFixture(
		t,
		filepath.Join(liveRoot, DataLayoutFile),
		`{"schema":"milksu-data-layout/v1","version":1,"updatedAt":"2026-08-02T01:00:00Z"}`,
	)
	if _, err := StageBackupRestore(liveRoot, archive); err == nil ||
		!strings.Contains(err.Error(), "not supported") {
		t.Fatalf("expected future layout rejection, got %v", err)
	}
}

func TestApplyPendingRestoreRecoversInterruptedTransactionFirst(t *testing.T) {
	root := t.TempDir()
	writeBackupFixture(
		t,
		filepath.Join(root, DataLayoutFile),
		`{"schema":"milksu-data-layout/v1","version":1,"updatedAt":"2026-08-02T00:00:00Z"}`,
	)
	writeBackupFixture(t, filepath.Join(root, "conversations", "original.json"), `{"id":"original"}`)
	stageDirectory, err := os.MkdirTemp(filepath.Dir(root), ".milksu-restore-stage-*")
	if err != nil {
		t.Fatal(err)
	}
	rollbackDirectory, err := os.MkdirTemp(filepath.Dir(root), ".milksu-restore-rollback-*")
	if err != nil {
		t.Fatal(err)
	}
	paths := make([]restoreTransactionPath, 0, len(restoreManagedPaths))
	for _, relativePath := range restoreManagedPaths {
		_, statErr := os.Lstat(filepath.Join(root, relativePath))
		paths = append(paths, restoreTransactionPath{
			Path:      filepath.ToSlash(relativePath),
			HadTarget: statErr == nil,
			Touched:   filepath.Clean(relativePath) == "conversations",
		})
	}
	if err := os.MkdirAll(filepath.Join(rollbackDirectory), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(
		filepath.Join(root, "conversations"),
		filepath.Join(rollbackDirectory, "conversations"),
	); err != nil {
		t.Fatal(err)
	}
	writeBackupFixture(t, filepath.Join(root, "conversations", "partial.json"), `{"id":"partial"}`)
	if err := writeRestoreTransaction(root, restoreTransaction{
		Schema:            restoreTransactionSchema,
		Phase:             "applying",
		StageDirectory:    stageDirectory,
		RollbackDirectory: rollbackDirectory,
		Paths:             paths,
	}); err != nil {
		t.Fatal(err)
	}
	result, err := ApplyPendingRestore(root)
	if err != nil {
		t.Fatal(err)
	}
	if result.Applied || !result.RecoveredFirst {
		t.Fatalf("unexpected recovery result: %#v", result)
	}
	assertBackupFixture(t, filepath.Join(root, "conversations", "original.json"), `{"id":"original"}`)
	if _, err := os.Stat(filepath.Join(root, "conversations", "partial.json")); !os.IsNotExist(err) {
		t.Fatalf("partial restore survived recovery: %v", err)
	}
}

func TestApplyPendingRestoreRejectsSymlinkParentsWithoutTouchingExternalData(t *testing.T) {
	backupRoot := t.TempDir()
	writeBackupFixture(
		t,
		filepath.Join(backupRoot, DataLayoutFile),
		`{"schema":"milksu-data-layout/v1","version":1,"updatedAt":"2026-08-02T00:00:00Z"}`,
	)
	writeBackupFixture(t, filepath.Join(backupRoot, "ctf", "memories", "restored.json"), `{"id":"restored"}`)
	archive := filepath.Join(t.TempDir(), "backup.zip")
	if _, err := ExportBackup(context.Background(), backupRoot, archive); err != nil {
		t.Fatal(err)
	}
	root := t.TempDir()
	originalLayout := `{"schema":"milksu-data-layout/v1","version":1,"updatedAt":"2026-08-02T02:00:00Z"}`
	writeBackupFixture(t, filepath.Join(root, DataLayoutFile), originalLayout)
	external := t.TempDir()
	writeBackupFixture(t, filepath.Join(external, "sentinel"), "keep")
	if err := os.Symlink(external, filepath.Join(root, "ctf")); err != nil {
		t.Fatal(err)
	}
	if _, err := StageBackupRestore(root, archive); err != nil {
		t.Fatal(err)
	}
	if _, err := ApplyPendingRestore(root); err == nil || !strings.Contains(err.Error(), "symlink") {
		t.Fatalf("expected symlink rejection, got %v", err)
	}
	assertBackupFixture(t, filepath.Join(external, "sentinel"), "keep")
	assertBackupFixture(t, filepath.Join(root, DataLayoutFile), originalLayout)
	if _, err := os.Stat(filepath.Join(root, restoreDirectoryName, restoreTransactionName)); !os.IsNotExist(err) {
		t.Fatalf("failed restore transaction was not cleared: %v", err)
	}
}

func assertBackupFixture(t *testing.T, path, expected string) {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != expected {
		t.Fatalf("%s = %q, want %q", path, data, expected)
	}
}
