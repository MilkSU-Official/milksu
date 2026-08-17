package config

import (
	"bytes"
	"database/sql"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/MilkSU-Official/milksu/internal/sqlitemigrate"
)

func TestSQLiteSecretStoreUsesNumberedMigration(t *testing.T) {
	path := filepath.Join(t.TempDir(), localCredentialsDatabaseName)
	rawStore, err := newSQLiteSecretStore(path)
	if err != nil {
		t.Fatal(err)
	}
	store := rawStore.(sqliteSecretStore)
	database, err := store.open()
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()

	var (
		version   int
		name      string
		appliedAt string
	)
	if err := database.QueryRow(
		`SELECT version, name, applied_at FROM schema_migrations`,
	).Scan(&version, &name, &appliedAt); err != nil {
		t.Fatalf("query credential migration history: %v", err)
	}
	if version != SupportedCredentialsDatabaseVersion ||
		name != credentialsV1MigrationName ||
		strings.TrimSpace(appliedAt) == "" {
		t.Fatalf(
			"migration history = (%d, %q, %q), want (%d, %q, non-empty)",
			version,
			name,
			appliedAt,
			SupportedCredentialsDatabaseVersion,
			credentialsV1MigrationName,
		)
	}
}

func TestSQLiteSecretStoreAdoptsLegacySchemaWithoutRewritingRows(t *testing.T) {
	path := filepath.Join(t.TempDir(), localCredentialsDatabaseName)
	database := openCredentialFixtureDatabase(t, path)
	execCredentialFixtureStatements(t, database,
		`CREATE TABLE credentials (
			account TEXT PRIMARY KEY,
			secret TEXT NOT NULL,
			updated_at TEXT NOT NULL
		)`,
		`INSERT INTO credentials(account, secret, updated_at)
			VALUES ('fixture-account', 'opaque-fixture-value', '2026-07-31T12:34:56Z')`,
		`CREATE TRIGGER forbid_credential_update
			BEFORE UPDATE ON credentials
			BEGIN SELECT RAISE(ABORT, 'credential update forbidden'); END`,
		`CREATE TRIGGER forbid_credential_delete
			BEFORE DELETE ON credentials
			BEGIN SELECT RAISE(ABORT, 'credential delete forbidden'); END`,
	)
	if err := database.Close(); err != nil {
		t.Fatal(err)
	}

	rawStore, err := newSQLiteSecretStore(path)
	if err != nil {
		t.Fatalf("adopt pre-migrator credential database: %v", err)
	}
	store := rawStore.(sqliteSecretStore)
	checked, err := store.open()
	if err != nil {
		t.Fatal(err)
	}
	defer checked.Close()
	var unchanged int
	if err := checked.QueryRow(`
		SELECT count(*) FROM credentials
		WHERE account = 'fixture-account'
			AND secret = 'opaque-fixture-value'
			AND updated_at = '2026-07-31T12:34:56Z'
	`).Scan(&unchanged); err != nil {
		t.Fatal(err)
	}
	if unchanged != 1 {
		t.Fatal("legacy credential row was rewritten during schema adoption")
	}
	var triggerCount int
	if err := checked.QueryRow(`
		SELECT count(*) FROM sqlite_master
		WHERE type = 'trigger' AND name LIKE 'forbid_credential_%'
	`).Scan(&triggerCount); err != nil {
		t.Fatal(err)
	}
	if triggerCount != 2 {
		t.Fatalf("credential mutation sentinels changed: got %d, want 2", triggerCount)
	}

	if _, err := newSQLiteSecretStore(path); err != nil {
		t.Fatalf("idempotent credential migration reopen: %v", err)
	}
	var historyCount int
	if err := checked.QueryRow(`SELECT count(*) FROM schema_migrations`).Scan(&historyCount); err != nil {
		t.Fatal(err)
	}
	if historyCount != 1 {
		t.Fatalf("idempotent reopen recorded %d migrations, want 1", historyCount)
	}
}

func TestSQLiteSecretStoreRejectsFutureVersionWithoutWriting(t *testing.T) {
	path := filepath.Join(t.TempDir(), localCredentialsDatabaseName)
	database := openCredentialFixtureDatabase(t, path)
	execCredentialFixtureStatements(t, database,
		`CREATE TABLE schema_migrations (
			version INTEGER PRIMARY KEY,
			name TEXT NOT NULL,
			applied_at TEXT NOT NULL
		)`,
		`INSERT INTO schema_migrations(version, name, applied_at)
			VALUES (1, 'create local credential store', '2026-07-31T12:34:56Z')`,
		`INSERT INTO schema_migrations(version, name, applied_at)
			VALUES (2, 'future credential schema', '2026-08-01T12:34:56Z')`,
		`CREATE TABLE future_marker(value TEXT NOT NULL)`,
		`INSERT INTO future_marker(value) VALUES ('preserve-me')`,
	)
	if err := database.Close(); err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}

	store, err := newSQLiteSecretStore(path)
	if store != nil {
		t.Fatal("future credential database unexpectedly returned a store")
	}
	if !errors.Is(err, sqlitemigrate.ErrDatabaseTooNew) {
		t.Fatalf("future credential database error = %v, want ErrDatabaseTooNew", err)
	}
	after, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(before, after) {
		t.Fatal("future credential database rejection modified database bytes")
	}
	for _, sidecar := range []string{path + "-wal", path + "-shm"} {
		if _, err := os.Stat(sidecar); !os.IsNotExist(err) {
			t.Fatalf("future-version rejection created SQLite sidecar %q: %v", sidecar, err)
		}
	}
}

func TestSQLiteSecretStoreMigrationFailureRollsBackHistory(t *testing.T) {
	path := filepath.Join(t.TempDir(), localCredentialsDatabaseName)
	database := openCredentialFixtureDatabase(t, path)
	execCredentialFixtureStatements(t, database,
		`CREATE TABLE credentials (
			account TEXT PRIMARY KEY,
			marker TEXT NOT NULL
		)`,
		`INSERT INTO credentials(account, marker)
			VALUES ('fixture-account', 'preserve-me')`,
	)
	if err := database.Close(); err != nil {
		t.Fatal(err)
	}

	store, err := newSQLiteSecretStore(path)
	if store != nil {
		t.Fatal("incompatible credential database unexpectedly returned a store")
	}
	if err == nil || !strings.Contains(err.Error(), "incompatible local credential columns") {
		t.Fatalf("incompatible credential database error = %v, want schema-shape failure", err)
	}

	checked := openCredentialFixtureDatabase(t, path)
	defer checked.Close()
	var historyCount int
	if err := checked.QueryRow(`
		SELECT count(*) FROM sqlite_master
		WHERE type = 'table' AND name = 'schema_migrations'
	`).Scan(&historyCount); err != nil {
		t.Fatal(err)
	}
	if historyCount != 0 {
		t.Fatal("failed credential migration left schema_migrations behind")
	}
	rows, err := checked.Query(`PRAGMA table_info(credentials)`)
	if err != nil {
		t.Fatal(err)
	}
	var columns []string
	for rows.Next() {
		var (
			position     int
			name         string
			columnType   string
			notNull      int
			defaultValue sql.NullString
			primaryKey   int
		)
		if err := rows.Scan(
			&position,
			&name,
			&columnType,
			&notNull,
			&defaultValue,
			&primaryKey,
		); err != nil {
			rows.Close()
			t.Fatal(err)
		}
		columns = append(columns, name)
	}
	if err := rows.Close(); err != nil {
		t.Fatal(err)
	}
	if strings.Join(columns, ",") != "account,marker" {
		t.Fatalf("failed credential migration changed legacy columns: %v", columns)
	}
	var marker string
	if err := checked.QueryRow(
		`SELECT marker FROM credentials WHERE account = 'fixture-account'`,
	).Scan(&marker); err != nil {
		t.Fatal(err)
	}
	if marker != "preserve-me" {
		t.Fatal("failed credential migration changed legacy marker row")
	}
}

func TestSQLiteSecretStoreRoundTripAndPrivatePermissions(t *testing.T) {
	directory := t.TempDir()
	path := filepath.Join(directory, localCredentialsDatabaseName)
	rawStore, err := newSQLiteSecretStore(path)
	if err != nil {
		t.Fatal(err)
	}
	store := rawStore.(sqliteSecretStore)

	if err := store.Set("provider:deepseek", "sqlite-secret"); err != nil {
		t.Fatal(err)
	}
	value, err := store.Get("provider:deepseek")
	if err != nil || value != "sqlite-secret" {
		t.Fatalf("unexpected SQLite credential round trip: value=%q err=%v", value, err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	// Windows ACLs do not expose Unix permission bits; the 0o600 hardening
	// contract is only assertable on Unix-like platforms.
	if runtime.GOOS != "windows" && info.Mode().Perm() != 0o600 {
		t.Fatalf("credential database permissions = %o, want 600", info.Mode().Perm())
	}
	if err := store.Delete("provider:deepseek"); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Get("provider:deepseek"); !errors.Is(err, errSecretNotFound) {
		t.Fatalf("deleted credential is still readable: %v", err)
	}
}

func openCredentialFixtureDatabase(t *testing.T, path string) *sql.DB {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	database, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	database.SetMaxOpenConns(1)
	return database
}

func execCredentialFixtureStatements(t *testing.T, database *sql.DB, statements ...string) {
	t.Helper()
	for _, statement := range statements {
		if _, err := database.Exec(statement); err != nil {
			database.Close()
			t.Fatalf("execute credential fixture statement: %v", err)
		}
	}
}
