package appdata

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	_ "modernc.org/sqlite"
)

func TestEnsurePreMigrationBackupSkipsCurrentAndMissingDatabasesWithoutWriting(t *testing.T) {
	root := t.TempDir()
	currentPath := filepath.Join(root, "runtime", "events.sqlite3")
	if err := os.MkdirAll(filepath.Dir(currentPath), 0o700); err != nil {
		t.Fatal(err)
	}
	seedMigrationHistory(t, currentPath, true, [][2]any{{1, "2026-08-02T00:00:00Z"}})

	result, err := EnsurePreMigrationBackup(
		context.Background(),
		root,
		managedMigrationDescriptorsForTest(),
	)
	if err != nil {
		t.Fatal(err)
	}
	if result != (MigrationBackupResult{}) {
		t.Fatalf("result = %#v, want zero result", result)
	}
	backupDirectory := migrationBackupDirectoryForTest(root)
	if _, err := os.Lstat(backupDirectory); !os.IsNotExist(err) {
		t.Fatalf("backup directory was created without pending migrations: %v", err)
	}
}

func TestEnsurePreMigrationBackupCreatesCredentialFreeBackupAndReusesIt(t *testing.T) {
	root := t.TempDir()
	databasePath := filepath.Join(root, "ctf", "memory.sqlite3")
	createBackupDatabase(t, databasePath)
	writeBackupFixture(t, filepath.Join(root, "settings.json"), `{"locale":"zh"}`)
	credentialPath := filepath.Join(root, "credentials.db")
	const syntheticOpaqueCredentialFixture = "synthetic-opaque-credential-fixture"
	writeBackupFixture(t, credentialPath, syntheticOpaqueCredentialFixture)
	beforeCredentialHash := fileSHA256(t, credentialPath)
	beforeCredentialInfo, err := os.Stat(credentialPath)
	if err != nil {
		t.Fatal(err)
	}

	descriptor := managedMigrationDescriptorsForTest()
	result, err := EnsurePreMigrationBackup(context.Background(), root, descriptor)
	if err != nil {
		t.Fatal(err)
	}
	if !result.Required || !result.Created || result.Reused ||
		result.PendingDatabaseCount != 1 || result.Path == "" ||
		result.CredentialsIncluded {
		t.Fatalf("unexpected first result: %#v", result)
	}
	backupInfo, err := os.Stat(result.Path)
	if err != nil {
		t.Fatal(err)
	}
	if backupInfo.Mode().Perm() != 0o600 {
		t.Fatalf("migration backup mode = %o, want 600", backupInfo.Mode().Perm())
	}
	directoryInfo, err := os.Stat(filepath.Dir(result.Path))
	if err != nil {
		t.Fatal(err)
	}
	if directoryInfo.Mode().Perm() != 0o700 {
		t.Fatalf("migration backup directory mode = %o, want 700", directoryInfo.Mode().Perm())
	}
	validation, err := ValidateBackup(result.Path)
	if err != nil {
		t.Fatal(err)
	}
	if !validation.Valid || validation.CredentialsIncluded {
		t.Fatalf("unexpected backup validation: %#v", validation)
	}
	names, manifest := readBackupArchive(t, result.Path)
	if !slices.Contains(names, "data/ctf/memory.sqlite3") {
		t.Fatalf("migration backup is missing the pending database: %#v", names)
	}
	if strings.Contains(strings.Join(names, "\n"), "credentials.db") ||
		manifest.CredentialsIncluded {
		t.Fatalf("migration backup included credentials: %#v %#v", names, manifest)
	}
	if after := fileSHA256(t, credentialPath); after != beforeCredentialHash {
		t.Fatalf("credentials fixture changed: %s -> %s", beforeCredentialHash, after)
	}
	afterCredentialInfo, err := os.Stat(credentialPath)
	if err != nil {
		t.Fatal(err)
	}
	if !afterCredentialInfo.ModTime().Equal(beforeCredentialInfo.ModTime()) {
		t.Fatalf(
			"credentials fixture mtime changed: %s -> %s",
			beforeCredentialInfo.ModTime(),
			afterCredentialInfo.ModTime(),
		)
	}

	reused, err := EnsurePreMigrationBackup(context.Background(), root, descriptor)
	if err != nil {
		t.Fatal(err)
	}
	if !reused.Required || reused.Created || !reused.Reused ||
		reused.Path != result.Path || reused.CredentialsIncluded {
		t.Fatalf("unexpected reused result: %#v", reused)
	}
	entries, err := os.ReadDir(migrationBackupDirectoryForTest(root))
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 || entries[0].Name() != filepath.Base(result.Path) {
		t.Fatalf("unexpected migration backup files: %#v", entries)
	}
}

func TestEnsurePreMigrationBackupRejectsFutureOrMalformedHistoryBeforeWriting(t *testing.T) {
	tests := []struct {
		name string
		seed func(t *testing.T, path string)
		want string
	}{
		{
			name: "future",
			seed: func(t *testing.T, path string) {
				if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
					t.Fatal(err)
				}
				seedMigrationHistory(t, path, true, [][2]any{
					{1, "2026-08-01T00:00:00Z"},
					{2, "2026-08-02T00:00:00Z"},
				})
			},
			want: "supports 1",
		},
		{
			name: "malformed",
			seed: func(t *testing.T, path string) {
				if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
					t.Fatal(err)
				}
				database, err := sql.Open("sqlite", path)
				if err != nil {
					t.Fatal(err)
				}
				if _, err := database.Exec(`CREATE TABLE schema_migrations (
					version INTEGER PRIMARY KEY,
					unexpected TEXT NOT NULL
				)`); err != nil {
					database.Close()
					t.Fatal(err)
				}
				if err := database.Close(); err != nil {
					t.Fatal(err)
				}
			},
			want: "corrupt migration history",
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			root := t.TempDir()
			path := filepath.Join(root, "runtime", "events.sqlite3")
			test.seed(t, path)
			before := fileSHA256(t, path)
			result, err := EnsurePreMigrationBackup(
				context.Background(),
				root,
				managedMigrationDescriptorsForTest(),
			)
			if err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("result = %#v, error = %v, want %q", result, err, test.want)
			}
			if after := fileSHA256(t, path); after != before {
				t.Fatalf("database changed during rejected preflight: %s -> %s", before, after)
			}
			if _, err := os.Lstat(migrationBackupDirectoryForTest(root)); !os.IsNotExist(err) {
				t.Fatalf("rejected preflight created a backup directory: %v", err)
			}
			for _, suffix := range []string{"-wal", "-shm", "-journal"} {
				if _, err := os.Lstat(path + suffix); !os.IsNotExist(err) {
					t.Fatalf("rejected preflight created %s: %v", suffix, err)
				}
			}
		})
	}
}

func TestEnsurePreMigrationBackupFailureLeavesNoPartialArchive(t *testing.T) {
	root := t.TempDir()
	createBackupDatabase(t, filepath.Join(root, "ctf", "memory.sqlite3"))
	writeBackupFixture(t, filepath.Join(root, "settings.json"), `{not-json`)

	result, err := EnsurePreMigrationBackup(
		context.Background(),
		root,
		managedMigrationDescriptorsForTest(),
	)
	if err == nil || !strings.Contains(err.Error(), "decode settings") {
		t.Fatalf("result = %#v, error = %v, want settings backup failure", result, err)
	}
	entries, readErr := os.ReadDir(migrationBackupDirectoryForTest(root))
	if readErr != nil {
		t.Fatal(readErr)
	}
	if len(entries) != 0 {
		t.Fatalf("failed migration backup left files behind: %#v", entries)
	}
}

func TestEnsurePreMigrationBackupRequiresCompleteBackupAllowlist(t *testing.T) {
	root := t.TempDir()
	result, err := EnsurePreMigrationBackup(context.Background(), root, []DatabaseDescriptor{{
		LogicalName:  "EventStore",
		RelativePath: "runtime/events.sqlite3",
		Supported:    1,
	}})
	if err == nil || !strings.Contains(err.Error(), "missing database descriptors") {
		t.Fatalf("result = %#v, error = %v, want complete allowlist rejection", result, err)
	}
	if _, err := os.Lstat(migrationBackupDirectoryForTest(root)); !os.IsNotExist(err) {
		t.Fatalf("incomplete preflight created backup state: %v", err)
	}
}

func TestEnsurePreMigrationBackupNeverAcceptsCredentialDatabase(t *testing.T) {
	root := t.TempDir()
	credentialPath := filepath.Join(root, "credentials.db")
	writeBackupFixture(t, credentialPath, "synthetic-opaque-credential-fixture")
	before := fileSHA256(t, credentialPath)
	beforeInfo, err := os.Stat(credentialPath)
	if err != nil {
		t.Fatal(err)
	}
	// Make mtime comparisons meaningful even on coarse filesystems.
	fixed := time.Unix(1_700_000_000, 0)
	if err := os.Chtimes(credentialPath, fixed, fixed); err != nil {
		t.Fatal(err)
	}
	beforeInfo, err = os.Stat(credentialPath)
	if err != nil {
		t.Fatal(err)
	}

	result, err := EnsurePreMigrationBackup(context.Background(), root, []DatabaseDescriptor{{
		LogicalName:  "Credentials",
		RelativePath: "credentials.db",
		Supported:    1,
	}})
	if err == nil || !strings.Contains(err.Error(), "cannot participate") {
		t.Fatalf("result = %#v, error = %v, want credential rejection", result, err)
	}
	if after := fileSHA256(t, credentialPath); after != before {
		t.Fatalf("credential file changed: %s -> %s", before, after)
	}
	afterInfo, err := os.Stat(credentialPath)
	if err != nil {
		t.Fatal(err)
	}
	if !afterInfo.ModTime().Equal(beforeInfo.ModTime()) {
		t.Fatalf("credential mtime changed: %s -> %s", beforeInfo.ModTime(), afterInfo.ModTime())
	}
	if _, err := os.Lstat(migrationBackupDirectoryForTest(root)); !os.IsNotExist(err) {
		t.Fatalf("credential rejection created backup state: %v", err)
	}
}

func migrationBackupDirectoryForTest(root string) string {
	return filepath.Join(
		filepath.Dir(root),
		"."+filepath.Base(root)+migrationBackupDirectorySuffix,
	)
}

func managedMigrationDescriptorsForTest() []DatabaseDescriptor {
	return []DatabaseDescriptor{
		{LogicalName: "EventStore", RelativePath: "runtime/events.sqlite3", Supported: 1},
		{LogicalName: "CTF Memory", RelativePath: "ctf/memory.sqlite3", Supported: 1},
		{LogicalName: "NSSCTF Catalog", RelativePath: "nssctf/catalog.sqlite3", Supported: 1},
		{LogicalName: "CTFshow Catalog", RelativePath: "ctfshow/catalog.sqlite3", Supported: 1},
		{LogicalName: "Coding Agent Usage", RelativePath: "usage/model-usage.sqlite3", Supported: 1},
	}
}
