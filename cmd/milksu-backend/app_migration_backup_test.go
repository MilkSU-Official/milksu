package main

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"os"
	"path/filepath"
	"testing"

	"github.com/MilkSU-Official/milksu/internal/appdata"
	"github.com/MilkSU-Official/milksu/internal/ctf"
	"github.com/MilkSU-Official/milksu/internal/ctfshow"
	"github.com/MilkSU-Official/milksu/internal/modelusage"
	"github.com/MilkSU-Official/milksu/internal/nssctf"
	"github.com/MilkSU-Official/milksu/internal/securityruntime"

	_ "modernc.org/sqlite"
)

func TestRestoredLegacyBackupIsProtectedBeforeAllDatabaseUpgrades(t *testing.T) {
	legacyRoot := t.TempDir()
	writeDataLayoutFixture(t, legacyRoot)
	createThenDowngradeAllDatabases(t, legacyRoot)
	sourceArchive := filepath.Join(t.TempDir(), "legacy-backup.zip")
	exported, err := appdata.ExportBackup(context.Background(), legacyRoot, sourceArchive)
	if err != nil {
		t.Fatal(err)
	}
	if exported.CredentialsIncluded {
		t.Fatalf("legacy source backup included credentials: %#v", exported)
	}

	liveRoot := t.TempDir()
	writeDataLayoutFixture(t, liveRoot)
	credentialPath := filepath.Join(liveRoot, "credentials.db")
	const syntheticOpaqueCredentialFixture = "synthetic-opaque-credential-fixture"
	if err := os.WriteFile(credentialPath, []byte(syntheticOpaqueCredentialFixture), 0o600); err != nil {
		t.Fatal(err)
	}
	credentialHash := testFileSHA256(t, credentialPath)

	stage, err := appdata.StageBackupRestore(liveRoot, sourceArchive)
	if err != nil {
		t.Fatal(err)
	}
	if !stage.RequiresRestart {
		t.Fatalf("restore stage = %#v, want restart", stage)
	}
	restored, err := appdata.ApplyPendingRestore(liveRoot)
	if err != nil {
		t.Fatal(err)
	}
	if !restored.Applied {
		t.Fatalf("restore result = %#v, want applied", restored)
	}
	assertNoMigrationHistory(t, liveRoot)
	if after := testFileSHA256(t, credentialPath); after != credentialHash {
		t.Fatalf("restore changed credentials fixture: %s -> %s", credentialHash, after)
	}

	migrationBackup, err := appdata.EnsurePreMigrationBackup(
		context.Background(),
		liveRoot,
		databaseCompatDescriptors(),
	)
	if err != nil {
		t.Fatal(err)
	}
	if !migrationBackup.Required || !migrationBackup.Created ||
		migrationBackup.PendingDatabaseCount != 5 ||
		migrationBackup.CredentialsIncluded {
		t.Fatalf("unexpected migration backup result: %#v", migrationBackup)
	}
	validation, err := appdata.ValidateBackup(migrationBackup.Path)
	if err != nil {
		t.Fatal(err)
	}
	if !validation.Valid || validation.CredentialsIncluded {
		t.Fatalf("unexpected migration backup validation: %#v", validation)
	}
	if after := testFileSHA256(t, credentialPath); after != credentialHash {
		t.Fatalf("migration backup changed credentials fixture: %s -> %s", credentialHash, after)
	}

	// The durable safety archive must still contain the pre-migrator state.
	protectedRoot := t.TempDir()
	writeDataLayoutFixture(t, protectedRoot)
	if _, err := appdata.StageBackupRestore(protectedRoot, migrationBackup.Path); err != nil {
		t.Fatal(err)
	}
	if _, err := appdata.ApplyPendingRestore(protectedRoot); err != nil {
		t.Fatal(err)
	}
	assertNoMigrationHistory(t, protectedRoot)

	openAndCloseAllDatabases(t, liveRoot)
	statuses := appdata.InspectDatabaseCompatibility(
		context.Background(),
		liveRoot,
		databaseCompatDescriptors(),
	)
	if len(statuses) != 5 {
		t.Fatalf("database status count = %d, want 5: %#v", len(statuses), statuses)
	}
	for _, status := range statuses {
		if status.State != "compatible" || status.Current == nil ||
			status.Supported == nil || *status.Current != *status.Supported {
			t.Fatalf("database did not upgrade after restore: %#v", status)
		}
	}
	if after := testFileSHA256(t, credentialPath); after != credentialHash {
		t.Fatalf("database upgrades changed credentials fixture: %s -> %s", credentialHash, after)
	}
}

func createThenDowngradeAllDatabases(t *testing.T, root string) {
	t.Helper()
	openAndCloseAllDatabases(t, root)
	for _, descriptor := range databaseCompatDescriptors() {
		path := filepath.Join(root, filepath.FromSlash(descriptor.RelativePath))
		database, err := sql.Open("sqlite", path)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := database.Exec(`DROP TABLE schema_migrations`); err != nil {
			database.Close()
			t.Fatalf("downgrade %s: %v", descriptor.LogicalName, err)
		}
		if err := database.Close(); err != nil {
			t.Fatal(err)
		}
	}
}

func openAndCloseAllDatabases(t *testing.T, root string) {
	t.Helper()
	runtimeService, err := securityruntime.NewService(filepath.Join(root, "runtime"), nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := runtimeService.Close(); err != nil {
		t.Fatal(err)
	}
	memoryStore, err := ctf.NewMemoryStore(
		filepath.Join(root, "ctf", "memory.sqlite3"),
		filepath.Join(root, "ctf", "memories"),
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := memoryStore.Close(); err != nil {
		t.Fatal(err)
	}
	nssctfCatalog, err := nssctf.NewCatalogService(
		filepath.Join(root, "nssctf", "catalog.sqlite3"),
		nssctf.NewClient(nssctf.ClientOptions{}),
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := nssctfCatalog.Close(); err != nil {
		t.Fatal(err)
	}
	ctfshowCatalog, err := ctfshow.NewCatalogService(
		filepath.Join(root, "ctfshow", "catalog.sqlite3"),
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := ctfshowCatalog.Close(); err != nil {
		t.Fatal(err)
	}
	usageStore, err := modelusage.NewStore(
		filepath.Join(root, "usage", "model-usage.sqlite3"),
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := usageStore.Close(); err != nil {
		t.Fatal(err)
	}
}

func assertNoMigrationHistory(t *testing.T, root string) {
	t.Helper()
	for _, descriptor := range databaseCompatDescriptors() {
		path := filepath.Join(root, filepath.FromSlash(descriptor.RelativePath))
		database, err := sql.Open("sqlite", "file:"+path+"?mode=ro")
		if err != nil {
			t.Fatal(err)
		}
		var count int
		if err := database.QueryRow(`
			SELECT count(*)
			FROM sqlite_master
			WHERE type = 'table' AND name = 'schema_migrations'
		`).Scan(&count); err != nil {
			database.Close()
			t.Fatal(err)
		}
		if err := database.Close(); err != nil {
			t.Fatal(err)
		}
		if count != 0 {
			t.Fatalf("%s unexpectedly has migration history", descriptor.LogicalName)
		}
	}
}

func writeDataLayoutFixture(t *testing.T, root string) {
	t.Helper()
	data := []byte(
		`{"schema":"milksu-data-layout/v1","version":1,"updatedAt":"2026-08-02T00:00:00Z"}`,
	)
	if err := os.WriteFile(filepath.Join(root, appdata.DataLayoutFile), data, 0o600); err != nil {
		t.Fatal(err)
	}
}

func testFileSHA256(t *testing.T, path string) string {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(data)
	return hex.EncodeToString(digest[:])
}
