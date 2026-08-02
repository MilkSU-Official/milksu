package ctfshow

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/MilkSU-Official/milksu/internal/sqlitemigrate"
)

func TestCatalogDatabaseUsesNumberedMigration(t *testing.T) {
	path := filepath.Join(t.TempDir(), "ctfshow", "catalog.sqlite3")
	service, err := NewCatalogService(path)
	if err != nil {
		t.Fatal(err)
	}
	defer service.Close()

	var (
		version   int
		name      string
		appliedAt string
	)
	if err := service.db.QueryRow(
		`SELECT version, name, applied_at FROM schema_migrations`,
	).Scan(&version, &name, &appliedAt); err != nil {
		t.Fatalf("query CTFshow catalog migration history: %v", err)
	}
	if version != SupportedCTFshowCatalogDatabaseVersion ||
		name != ctfshowCatalogV1MigrationName ||
		strings.TrimSpace(appliedAt) == "" {
		t.Fatalf(
			"migration history = (%d, %q, %q), want (%d, %q, non-empty)",
			version,
			name,
			appliedAt,
			SupportedCTFshowCatalogDatabaseVersion,
			ctfshowCatalogV1MigrationName,
		)
	}
}

func TestCatalogDatabaseAdoptsPreMigratorSchemaWithoutLosingRows(t *testing.T) {
	path := filepath.Join(t.TempDir(), "catalog.sqlite3")
	database := openCatalogFixtureDatabase(t, path)
	execCatalogFixtureStatements(t, database,
		`CREATE TABLE catalog_meta (
			key TEXT PRIMARY KEY,
			value TEXT NOT NULL
		)`,
		`CREATE TABLE catalog_problems (
			platform_id INTEGER PRIMARY KEY,
			source_url TEXT NOT NULL,
			title TEXT NOT NULL,
			category TEXT NOT NULL,
			points INTEGER NOT NULL,
			solved_count INTEGER NOT NULL,
			tags_json TEXT NOT NULL,
			synced_at TEXT NOT NULL
		)`,
		`CREATE INDEX catalog_problems_category
			ON catalog_problems(category, platform_id)`,
		`INSERT INTO catalog_meta(key, value)
			VALUES ('last_synced_at', '2026-07-31T12:34:56Z')`,
		`INSERT INTO catalog_problems (
			platform_id, source_url, title, category, points, solved_count,
			tags_json, synced_at
		) VALUES (
			12, 'https://ctf.show/challenges#12', 'legacy fixture', 'Web',
			50, 28, '["legacy","sql"]', '2026-07-31T12:34:56Z'
		)`,
	)
	if err := database.Close(); err != nil {
		t.Fatal(err)
	}

	service, err := NewCatalogService(path)
	if err != nil {
		t.Fatalf("upgrade pre-migrator CTFshow catalog: %v", err)
	}
	snapshot, err := service.Snapshot(context.Background())
	if err != nil {
		t.Fatalf("read upgraded CTFshow catalog: %v", err)
	}
	if snapshot.Total != 1 ||
		snapshot.LastSyncedAt != "2026-07-31T12:34:56Z" ||
		snapshot.Problems[0].PlatformID != 12 ||
		snapshot.Problems[0].Title != "legacy fixture" ||
		snapshot.Problems[0].Category != "Web" ||
		strings.Join(snapshot.Problems[0].Tags, ",") != "legacy,sql" {
		t.Fatalf("pre-migrator CTFshow catalog data changed: %#v", snapshot)
	}
	if err := service.Close(); err != nil {
		t.Fatal(err)
	}

	reopened, err := NewCatalogService(path)
	if err != nil {
		t.Fatalf("reopen migrated CTFshow catalog: %v", err)
	}
	defer reopened.Close()
	var historyCount int
	if err := reopened.db.QueryRow(`SELECT count(*) FROM schema_migrations`).Scan(&historyCount); err != nil {
		t.Fatal(err)
	}
	if historyCount != 1 {
		t.Fatalf("idempotent reopen recorded %d migrations, want 1", historyCount)
	}
}

func TestCatalogDatabaseRejectsFutureVersionWithoutWriting(t *testing.T) {
	path := filepath.Join(t.TempDir(), "catalog.sqlite3")
	database := openCatalogFixtureDatabase(t, path)
	execCatalogFixtureStatements(t, database,
		`CREATE TABLE schema_migrations (
			version INTEGER PRIMARY KEY,
			name TEXT NOT NULL,
			applied_at TEXT NOT NULL
		)`,
		`INSERT INTO schema_migrations(version, name, applied_at)
			VALUES (1, 'create CTFshow catalog', '2026-07-31T12:34:56Z')`,
		`INSERT INTO schema_migrations(version, name, applied_at)
			VALUES (2, 'future CTFshow catalog schema', '2026-08-01T12:34:56Z')`,
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

	service, err := NewCatalogService(path)
	if service != nil {
		service.Close()
		t.Fatal("future CTFshow catalog unexpectedly returned a service")
	}
	if !errors.Is(err, sqlitemigrate.ErrDatabaseTooNew) {
		t.Fatalf("future CTFshow catalog error = %v, want ErrDatabaseTooNew", err)
	}
	after, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(before, after) {
		t.Fatal("future CTFshow catalog rejection modified database bytes")
	}
	for _, sidecar := range []string{path + "-wal", path + "-shm"} {
		if _, err := os.Stat(sidecar); !os.IsNotExist(err) {
			t.Fatalf("future-version rejection created SQLite sidecar %q: %v", sidecar, err)
		}
	}
}

func TestCatalogDatabaseMigrationFailureRollsBackSchemaAndHistory(t *testing.T) {
	path := filepath.Join(t.TempDir(), "catalog.sqlite3")
	database := openCatalogFixtureDatabase(t, path)
	execCatalogFixtureStatements(t, database,
		`CREATE TABLE catalog_problems (
			platform_id INTEGER PRIMARY KEY,
			marker TEXT NOT NULL
		)`,
		`INSERT INTO catalog_problems(platform_id, marker)
			VALUES (1, 'preserve-me')`,
	)
	if err := database.Close(); err != nil {
		t.Fatal(err)
	}

	service, err := NewCatalogService(path)
	if service != nil {
		service.Close()
		t.Fatal("incompatible CTFshow catalog unexpectedly returned a service")
	}
	if err == nil || !strings.Contains(err.Error(), "incompatible CTFshow catalog_problems columns") {
		t.Fatalf("incompatible CTFshow catalog error = %v, want schema-shape migration failure", err)
	}

	checked := openCatalogFixtureDatabase(t, path)
	defer checked.Close()
	for _, table := range []string{"schema_migrations", "catalog_meta"} {
		var count int
		if err := checked.QueryRow(
			`SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = ?`,
			table,
		).Scan(&count); err != nil {
			t.Fatal(err)
		}
		if count != 0 {
			t.Fatalf("failed migration left table %q behind", table)
		}
	}
	rows, err := checked.Query(`PRAGMA table_info(catalog_problems)`)
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
	if strings.Join(columns, ",") != "platform_id,marker" {
		t.Fatalf("failed migration changed legacy columns: %v", columns)
	}
	var marker string
	if err := checked.QueryRow(
		`SELECT marker FROM catalog_problems WHERE platform_id = 1`,
	).Scan(&marker); err != nil {
		t.Fatal(err)
	}
	if marker != "preserve-me" {
		t.Fatalf("failed migration changed legacy row: %q", marker)
	}
}

func TestCatalogReplacePersistsIndependentSnapshot(t *testing.T) {
	path := filepath.Join(t.TempDir(), "ctfshow", "catalog.sqlite3")
	service, err := NewCatalogService(path)
	if err != nil {
		t.Fatal(err)
	}
	defer service.Close()

	snapshot, err := service.Replace(context.Background(), []CatalogProblem{
		{PlatformID: 12, Title: "web1", Category: "Web", Points: 50, SolvedCount: 28, Tags: []string{"sql"}},
		{PlatformID: 13, Title: "misc1", Category: "Misc", Points: 100, SolvedCount: 9},
	})
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.Total != 2 || snapshot.Problems[0].PlatformID != 13 {
		t.Fatalf("unexpected snapshot: %#v", snapshot)
	}
	if snapshot.Problems[1].SourceURL != "https://ctf.show/challenges#12" {
		t.Fatalf("unexpected challenge URL: %q", snapshot.Problems[1].SourceURL)
	}

	replaced, err := service.Replace(context.Background(), []CatalogProblem{
		{PlatformID: 99, Title: "pwn1", Category: "Pwn", Points: 200},
	})
	if err != nil {
		t.Fatal(err)
	}
	if replaced.Total != 1 || replaced.Problems[0].PlatformID != 99 {
		t.Fatalf("old challenges were not pruned: %#v", replaced)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("catalog mode = %o, want 600", info.Mode().Perm())
	}
}

func TestCatalogSQLiteFilesArePrivate(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("POSIX permission bits are not authoritative on Windows")
	}
	path := filepath.Join(t.TempDir(), "ctfshow", "catalog.sqlite3")
	service, err := NewCatalogService(path)
	if err != nil {
		t.Fatal(err)
	}
	defer service.Close()
	for _, candidate := range []string{path, path + "-wal", path + "-shm"} {
		info, err := os.Stat(candidate)
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			t.Fatal(err)
		}
		if info.Mode().Perm() != 0o600 {
			t.Fatalf("catalog file is not private: %s has %o", candidate, info.Mode().Perm())
		}
	}
}

func TestCatalogRejectsInvalidOrDuplicateChallenges(t *testing.T) {
	service, err := NewCatalogService(filepath.Join(t.TempDir(), "catalog.sqlite3"))
	if err != nil {
		t.Fatal(err)
	}
	defer service.Close()
	if _, err := service.Replace(context.Background(), []CatalogProblem{{PlatformID: 0, Title: "bad"}}); err == nil {
		t.Fatal("expected invalid challenge error")
	}
	if _, err := service.Replace(context.Background(), []CatalogProblem{
		{PlatformID: 1, Title: "first"},
		{PlatformID: 1, Title: "second"},
	}); err == nil {
		t.Fatal("expected duplicate challenge error")
	}
}

func openCatalogFixtureDatabase(t *testing.T, path string) *sql.DB {
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

func execCatalogFixtureStatements(t *testing.T, database *sql.DB, statements ...string) {
	t.Helper()
	for _, statement := range statements {
		if _, err := database.Exec(statement); err != nil {
			database.Close()
			t.Fatalf("execute catalog fixture statement: %v", err)
		}
	}
}
