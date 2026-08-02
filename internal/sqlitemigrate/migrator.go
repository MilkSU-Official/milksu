// Package sqlitemigrate provides a small transactional SQLite schema migrator.
//
// A migrator owns a single SQLite database file. Migrations are defined as a
// contiguous, ascending list of versions starting at 1; each migration runs
// inside the same transaction as its schema_migrations bookkeeping record, so
// a failed migration rolls back all schema and data changes made by that run.
package sqlitemigrate

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"time"

	_ "modernc.org/sqlite"
)

// ErrDatabaseTooNew is returned when the database's recorded schema version is
// newer than the version this application supports.
var ErrDatabaseTooNew = errors.New("database schema is newer than this app supports")

// Migration describes a single schema migration step.
//
// Version must be a positive integer and Name must be non-empty. Versions must
// be unique, strictly ascending, and contiguous starting at 1.
type Migration struct {
	Version int
	Name    string
	Up      func(ctx context.Context, tx *sql.Tx) error
}

// Migrator applies a validated set of migrations to one SQLite database file.
type Migrator struct {
	db         *sql.DB
	migrations []Migration
}

// Open validates the migration definitions, then creates the database file
// with restrictive permissions (mirroring internal/securityruntime/store.go)
// and opens a single SQLite connection.
//
// Validation happens before any filesystem or database access: on error, no
// directory is created and no file is touched.
func Open(path string, migrations []Migration) (*Migrator, error) {
	if err := validateMigrations(migrations); err != nil {
		return nil, err
	}

	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return nil, fmt.Errorf("create database directory: %w", err)
	}
	file, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return nil, fmt.Errorf("create database file: %w", err)
	}
	if err := file.Close(); err != nil {
		return nil, fmt.Errorf("close database file: %w", err)
	}
	if err := os.Chmod(path, 0o600); err != nil {
		return nil, fmt.Errorf("tighten database file permissions: %w", err)
	}

	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, fmt.Errorf("open sqlite database: %w", err)
	}
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)

	return &Migrator{db: db, migrations: migrations}, nil
}

// validateMigrations enforces that versions are exactly 1..N in order, with no
// duplicates, and that every name is non-empty and unique.
func validateMigrations(migrations []Migration) error {
	seenVersions := make(map[int]int, len(migrations))
	seenNames := make(map[string]int, len(migrations))
	for i, migration := range migrations {
		if migration.Version <= 0 {
			return fmt.Errorf("migration %d: version must be a positive integer, got %d", i+1, migration.Version)
		}
		if migration.Name == "" {
			return fmt.Errorf("migration %d: name must not be empty", i+1)
		}
		if migration.Up == nil {
			return fmt.Errorf("migration %d: Up must not be nil", i+1)
		}
		if previous, ok := seenVersions[migration.Version]; ok {
			return fmt.Errorf("duplicate migration version %d at positions %d and %d", migration.Version, previous+1, i+1)
		}
		if previous, ok := seenNames[migration.Name]; ok {
			return fmt.Errorf("duplicate migration name %q at positions %d and %d", migration.Name, previous+1, i+1)
		}
		if migration.Version != i+1 {
			return fmt.Errorf("migration versions must be strictly ascending and contiguous starting at 1: expected version %d, got %d", i+1, migration.Version)
		}
		seenVersions[migration.Version] = i
		seenNames[migration.Name] = i
	}
	return nil
}

// Migrate brings the database up to the target version (len(migrations)).
//
// The migration history is inspected read-only first; any inconsistency (a
// database newer than the definitions, a non-positive, missing, or out-of-range
// recorded version, or a recorded name that differs from the definition)
// rejects the run without modifying the database. Pending migrations are then
// applied in ascending order inside a single transaction together with the
// schema_migrations table creation and its bookkeeping records, so any failure
// rolls everything back.
func (m *Migrator) Migrate(ctx context.Context) error {
	target := len(m.migrations)

	recorded, err := m.readRecordedMigrations(ctx)
	if err != nil {
		return err
	}

	maxApplied := 0
	for version := range recorded {
		if version > maxApplied {
			maxApplied = version
		}
	}

	// Read-only gate: reject before any write to the database.
	if maxApplied > target {
		return fmt.Errorf("schema_migrations records version %d, but this app supports up to version %d: %w",
			maxApplied, target, ErrDatabaseTooNew)
	}
	for version := range recorded {
		if version <= 0 {
			return fmt.Errorf("corrupt migration history: schema_migrations records version %d, but versions must be positive (recorded versions: %v)",
				version, recordedVersionKeys(recorded))
		}
	}
	for version := 1; version <= maxApplied; version++ {
		if _, ok := recorded[version]; !ok {
			return fmt.Errorf("corrupt migration history: schema_migrations is missing version %d (recorded versions: %v)",
				version, recordedVersionKeys(recorded))
		}
	}
	if len(recorded) != maxApplied {
		return fmt.Errorf("corrupt migration history: schema_migrations records %d versions, but exactly versions 1..%d are expected (recorded versions: %v)",
			len(recorded), maxApplied, recordedVersionKeys(recorded))
	}
	for version, recordedName := range recorded {
		if definitionName := m.migrations[version-1].Name; recordedName != definitionName {
			return fmt.Errorf("migration name mismatch: schema_migrations records version %d as %q, but the definition is %q",
				version, recordedName, definitionName)
		}
	}

	tx, err := m.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin migration transaction: %w", err)
	}
	defer tx.Rollback()

	// Create the history table inside the same transaction as the pending
	// migrations, so a failed run leaves the database completely untouched.
	if _, err := tx.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (
		version INTEGER PRIMARY KEY,
		name TEXT NOT NULL,
		applied_at TEXT NOT NULL
	)`); err != nil {
		return fmt.Errorf("create schema_migrations table: %w", err)
	}

	for version := maxApplied + 1; version <= target; version++ {
		migration := m.migrations[version-1]
		if err := migration.Up(ctx, tx); err != nil {
			return fmt.Errorf("apply migration %d (%s): %w", version, migration.Name, err)
		}
		appliedAt := time.Now().UTC().Format(time.RFC3339Nano)
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)`,
			version, migration.Name, appliedAt); err != nil {
			return fmt.Errorf("record migration %d (%s): %w", version, migration.Name, err)
		}
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit migration transaction: %w", err)
	}
	return nil
}

// readRecordedMigrations reads the recorded (version, name) pairs from an
// existing schema_migrations table. It returns nil (no recorded versions) when
// the table does not exist. It is strictly read-only.
func (m *Migrator) readRecordedMigrations(ctx context.Context) (map[int]string, error) {
	var tableCount int
	if err := m.db.QueryRowContext(ctx,
		`SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'`,
	).Scan(&tableCount); err != nil {
		return nil, fmt.Errorf("check for schema_migrations table: %w", err)
	}
	if tableCount == 0 {
		return nil, nil
	}

	rows, err := m.db.QueryContext(ctx, `SELECT version, name FROM schema_migrations ORDER BY version`)
	if err != nil {
		return nil, fmt.Errorf("read schema_migrations: %w", err)
	}
	defer rows.Close()

	recorded := make(map[int]string)
	for rows.Next() {
		var version int
		var name string
		if err := rows.Scan(&version, &name); err != nil {
			return nil, fmt.Errorf("scan schema_migrations row: %w", err)
		}
		if _, duplicate := recorded[version]; duplicate {
			return nil, fmt.Errorf("corrupt migration history: duplicate version %d in schema_migrations", version)
		}
		recorded[version] = name
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate schema_migrations: %w", err)
	}
	return recorded, nil
}

// DB returns the underlying database handle.
func (m *Migrator) DB() *sql.DB {
	return m.db
}

// Close closes the underlying database handle.
func (m *Migrator) Close() error {
	if m == nil || m.db == nil {
		return nil
	}
	return m.db.Close()
}

// recordedVersionKeys returns the sorted keys of the recorded version map, for
// use in error messages.
func recordedVersionKeys(recorded map[int]string) []int {
	keys := make([]int, 0, len(recorded))
	for version := range recorded {
		keys = append(keys, version)
	}
	sort.Ints(keys)
	return keys
}
