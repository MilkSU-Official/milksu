package appdata

import (
	"os"
	"path/filepath"
	"testing"
)

func TestHomeResolutionOrder(t *testing.T) {
	t.Setenv(HomeOverrideEnv, "")
	t.Setenv(DirectoryOverrideEnv, "")
	home, err := os.UserHomeDir()
	if err != nil {
		t.Fatalf("UserHomeDir() error = %v", err)
	}
	root, err := Home()
	if err != nil {
		t.Fatalf("Home() error = %v", err)
	}
	if want := filepath.Join(home, ".milksu"); root != want {
		t.Fatalf("Home() = %q, want %q", root, want)
	}

	t.Setenv(DirectoryOverrideEnv, filepath.Join(t.TempDir(), "legacy-root"))
	root, err = Home()
	if err != nil {
		t.Fatalf("Home() with legacy override error = %v", err)
	}
	if filepath.Base(root) != "legacy-root" {
		t.Fatalf("Home() with legacy override = %q", root)
	}

	t.Setenv(HomeOverrideEnv, filepath.Join(t.TempDir(), "home-root"))
	root, err = Home()
	if err != nil {
		t.Fatalf("Home() with MILKSU_HOME error = %v", err)
	}
	if filepath.Base(root) != "home-root" {
		t.Fatalf("Home() with MILKSU_HOME = %q", root)
	}
}

func TestHomeOverrideValidation(t *testing.T) {
	t.Setenv(DirectoryOverrideEnv, "")
	t.Setenv(HomeOverrideEnv, "relative/path")
	if _, err := Home(); err == nil {
		t.Fatal("expected relative MILKSU_HOME to be rejected")
	}
	t.Setenv(HomeOverrideEnv, "/")
	if _, err := Home(); err == nil {
		t.Fatal("expected filesystem-root MILKSU_HOME to be rejected")
	}
	home, err := os.UserHomeDir()
	if err != nil {
		t.Fatalf("UserHomeDir() error = %v", err)
	}
	t.Setenv(HomeOverrideEnv, home)
	if _, err := Home(); err == nil {
		t.Fatal("expected $HOME MILKSU_HOME to be rejected")
	}
}

func TestEnsureCreatesUnifiedSkeleton(t *testing.T) {
	root := filepath.Join(t.TempDir(), "milksu-home")
	t.Setenv(HomeOverrideEnv, root)
	t.Setenv(DirectoryOverrideEnv, "")
	data, err := Ensure()
	if err != nil {
		t.Fatalf("Ensure() error = %v", err)
	}
	if data != filepath.Join(root, "data") {
		t.Fatalf("Ensure() = %q, want %q", data, filepath.Join(root, "data"))
	}
	for _, name := range []string{"data-layout.json", "data", "config", "workspaces", "backups"} {
		if _, err := os.Lstat(filepath.Join(root, name)); err != nil {
			t.Fatalf("expected %s in unified root: %v", name, err)
		}
	}
	layout, err := ReadDataLayout(root)
	if err != nil {
		t.Fatalf("ReadDataLayout() error = %v", err)
	}
	if layout.Version != CurrentDataLayoutVersion {
		t.Fatalf("layout version = %d, want %d", layout.Version, CurrentDataLayoutVersion)
	}
}

func TestMigrateLegacyHomeMovesEveryEntry(t *testing.T) {
	legacy := t.TempDir()
	writeMigrationFixture(t, filepath.Join(legacy, "settings.json"), "{}")
	writeMigrationFixture(t, filepath.Join(legacy, "credentials.db"), "secret")
	writeMigrationFixture(t, filepath.Join(legacy, "conversations", "one.json"), "{}")
	writeMigrationFixture(t, filepath.Join(legacy, "agent-home", "pi", "sessions", "s.jsonl"), "")
	writeMigrationFixture(t, filepath.Join(legacy, "runtime", "events.sqlite3"), "")
	writeMigrationFixture(t, filepath.Join(legacy, "lifespan.json"), "{}")
	writeMigrationFixture(t, filepath.Join(legacy, "browser", "bridge-pairing.json"), "{}")
	writeMigrationFixture(t, filepath.Join(legacy, "unknown-leftover.bin"), "data")
	writeMigrationFixture(t, filepath.Join(legacy, "data-layout.json"), "{}")

	root := filepath.Join(t.TempDir(), "milksu-home")
	if err := os.MkdirAll(root, 0o700); err != nil {
		t.Fatal(err)
	}
	migrateLegacyHomeForTest(t, legacy, root)

	for _, target := range []string{
		filepath.Join("config", "settings.json"),
		filepath.Join("config", "credentials.db"),
		filepath.Join("data", "stores", "conversations", "one.json"),
		filepath.Join("data", "agent", "home", "pi", "sessions", "s.jsonl"),
		filepath.Join("data", "runtime", "events.sqlite3"),
		filepath.Join("data", "runtime", "lifespan.json"),
		filepath.Join("workspaces", "browser", "bridge-pairing.json"),
		filepath.Join("data", "legacy-unmapped", "unknown-leftover.bin"),
	} {
		if _, err := os.Lstat(filepath.Join(root, target)); err != nil {
			t.Fatalf("expected migrated %s: %v", target, err)
		}
	}
	if err := ensureDataLayout(root); err != nil {
		t.Fatalf("ensureDataLayout() after migration error = %v", err)
	}
	layout, err := ReadDataLayout(root)
	if err != nil {
		t.Fatalf("ReadDataLayout() error = %v", err)
	}
	if layout.Version != CurrentDataLayoutVersion {
		t.Fatalf("layout version = %d, want %d", layout.Version, CurrentDataLayoutVersion)
	}
	renamed := legacy + legacyHomeRenameSuffix
	if info, err := os.Stat(renamed); err != nil || !info.IsDir() {
		t.Fatalf("expected legacy directory renamed to %s: %v", renamed, err)
	}
	if _, err := os.Lstat(filepath.Join(root, homeMigrationJournalName)); !os.IsNotExist(err) {
		t.Fatalf("expected migration journal removed, stat err = %v", err)
	}
}

func TestMigrateLegacyHomeResumesFromJournal(t *testing.T) {
	legacy := t.TempDir()
	writeMigrationFixture(t, filepath.Join(legacy, "settings.json"), "{}")
	writeMigrationFixture(t, filepath.Join(legacy, "conversations", "one.json"), "{}")

	root := filepath.Join(t.TempDir(), "milksu-home")
	if err := os.MkdirAll(root, 0o700); err != nil {
		t.Fatal(err)
	}
	// Simulate a crash after the first move completed.
	if err := os.MkdirAll(filepath.Join(root, "config"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(
		filepath.Join(legacy, "settings.json"),
		filepath.Join(root, "config", "settings.json"),
	); err != nil {
		t.Fatal(err)
	}
	if err := writeHomeMigrationJournal(root, homeMigrationJournal{
		Schema:    homeMigrationJournalSchema,
		Legacy:    legacy,
		StartedAt: "2026-09-27T00:00:00Z",
		Completed: []string{"settings.json"},
	}); err != nil {
		t.Fatal(err)
	}

	migrateLegacyHomeForTest(t, legacy, root)
	if _, err := os.Lstat(filepath.Join(root, "data", "stores", "conversations", "one.json")); err != nil {
		t.Fatalf("expected resumed migration to finish: %v", err)
	}
	data, err := os.ReadFile(filepath.Join(root, "config", "settings.json"))
	if err != nil || string(data) != "{}" {
		t.Fatalf("resumed migration overwrote settings: %q %v", data, err)
	}
}

func TestMigrateLegacyHomeMovesMigrationBackups(t *testing.T) {
	legacy := t.TempDir()
	writeMigrationFixture(t, filepath.Join(legacy, "settings.json"), "{}")
	backupDir := filepath.Join(
		filepath.Dir(legacy),
		"."+filepath.Base(legacy)+migrationBackupDirectorySuffix,
	)
	writeMigrationFixture(t, filepath.Join(backupDir, "migration-abc.zip"), "zip")

	root := filepath.Join(t.TempDir(), "milksu-home")
	if err := os.MkdirAll(root, 0o700); err != nil {
		t.Fatal(err)
	}
	migrateLegacyHomeForTest(t, legacy, root)
	if _, err := os.Lstat(filepath.Join(root, "backups", "migration-backups", "migration-abc.zip")); err != nil {
		t.Fatalf("expected legacy migration backups migrated: %v", err)
	}
}

func TestMigrateLegacyHomeSkipsWhenLayoutMarkerExists(t *testing.T) {
	legacy := t.TempDir()
	writeMigrationFixture(t, filepath.Join(legacy, "settings.json"), "{}")
	root := filepath.Join(t.TempDir(), "milksu-home")
	if err := os.MkdirAll(root, 0o700); err != nil {
		t.Fatal(err)
	}
	writeMigrationFixture(t, filepath.Join(root, DataLayoutFile), "{}")

	migrateLegacyHomeForTest(t, legacy, root)
	if _, err := os.Lstat(filepath.Join(legacy, "settings.json")); err != nil {
		t.Fatalf("legacy data must stay untouched when marker exists: %v", err)
	}
	if _, err := os.Lstat(filepath.Join(root, "config", "settings.json")); !os.IsNotExist(err) {
		t.Fatalf("unexpected migration with existing marker: %v", err)
	}
}

// migrateLegacyHomeForTest runs the production migration from legacy into
// root without touching the real platform config directory.
func migrateLegacyHomeForTest(t *testing.T, legacy, root string) {
	t.Helper()
	if err := migrateLegacyHomeFrom(root, legacy); err != nil {
		t.Fatalf("migrateLegacyHomeFrom() error = %v", err)
	}
}

func writeMigrationFixture(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
}
