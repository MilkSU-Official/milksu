package sqlitemigrate

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestMigrateFreshAppliesInOrder(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "db", "app.db")

	migrations := []Migration{
		{Version: 1, Name: "create_users", Up: func(ctx context.Context, tx *sql.Tx) error {
			if _, err := tx.ExecContext(ctx, `CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL)`); err != nil {
				return err
			}
			_, err := tx.ExecContext(ctx, `INSERT INTO users(name) VALUES ('alice')`)
			return err
		}},
		{Version: 2, Name: "create_posts", Up: func(ctx context.Context, tx *sql.Tx) error {
			if _, err := tx.ExecContext(ctx, `CREATE TABLE posts (id INTEGER PRIMARY KEY, title TEXT NOT NULL)`); err != nil {
				return err
			}
			_, err := tx.ExecContext(ctx, `INSERT INTO posts(title) VALUES ('hello world')`)
			return err
		}},
		{Version: 3, Name: "create_comments", Up: func(ctx context.Context, tx *sql.Tx) error {
			if _, err := tx.ExecContext(ctx, `CREATE TABLE comments (id INTEGER PRIMARY KEY, body TEXT NOT NULL)`); err != nil {
				return err
			}
			_, err := tx.ExecContext(ctx, `INSERT INTO comments(body) VALUES ('nice post')`)
			return err
		}},
	}

	migrator, err := Open(path, migrations)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer migrator.Close()

	if err := migrator.Migrate(ctx); err != nil {
		t.Fatalf("Migrate: %v", err)
	}

	// File creation mirrors internal/securityruntime/store.go conventions:
	// 0600 file inside a 0700 directory.
	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat db file: %v", err)
	}
	if perm := info.Mode().Perm(); perm != 0o600 {
		t.Errorf("db file mode = %o, want 600", perm)
	}
	dirInfo, err := os.Stat(filepath.Dir(path))
	if err != nil {
		t.Fatalf("stat db dir: %v", err)
	}
	if perm := dirInfo.Mode().Perm() & 0o700; perm != 0o700 {
		t.Errorf("db dir owner permissions = %o, want 700", perm)
	}

	db := migrator.DB()
	assertRowCount(t, db, "users", 1)
	assertRowCount(t, db, "posts", 1)
	assertRowCount(t, db, "comments", 1)

	rows, err := db.Query(`SELECT version, name, applied_at FROM schema_migrations ORDER BY version`)
	if err != nil {
		t.Fatalf("query schema_migrations: %v", err)
	}
	defer rows.Close()

	var versions []int
	var names []string
	var appliedAt []string
	for rows.Next() {
		var version int
		var name, timestamp string
		if err := rows.Scan(&version, &name, &timestamp); err != nil {
			t.Fatalf("scan schema_migrations row: %v", err)
		}
		versions = append(versions, version)
		names = append(names, name)
		appliedAt = append(appliedAt, timestamp)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate schema_migrations: %v", err)
	}

	if want := []int{1, 2, 3}; !reflect.DeepEqual(versions, want) {
		t.Errorf("recorded versions = %v, want %v", versions, want)
	}
	if want := []string{"create_users", "create_posts", "create_comments"}; !reflect.DeepEqual(names, want) {
		t.Errorf("recorded names = %v, want %v", names, want)
	}
	for i, timestamp := range appliedAt {
		if timestamp == "" {
			t.Errorf("applied_at[%d] is empty", i)
		}
	}
}

func TestMigrateIdempotentReopen(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "app.db")

	var upCalls int
	migrations := []Migration{
		{Version: 1, Name: "v1", Up: func(ctx context.Context, tx *sql.Tx) error {
			upCalls++
			_, err := tx.ExecContext(ctx, `CREATE TABLE t1 (id INTEGER PRIMARY KEY)`)
			return err
		}},
		{Version: 2, Name: "v2", Up: func(ctx context.Context, tx *sql.Tx) error {
			upCalls++
			_, err := tx.ExecContext(ctx, `CREATE TABLE t2 (id INTEGER PRIMARY KEY)`)
			return err
		}},
	}

	first, err := Open(path, migrations)
	if err != nil {
		t.Fatalf("first Open: %v", err)
	}
	if err := first.Migrate(ctx); err != nil {
		t.Fatalf("first Migrate: %v", err)
	}
	if upCalls != 2 {
		t.Fatalf("first run invoked Up %d times, want 2", upCalls)
	}
	if err := first.Close(); err != nil {
		t.Fatalf("first Close: %v", err)
	}

	upCalls = 0
	second, err := Open(path, migrations)
	if err != nil {
		t.Fatalf("second Open: %v", err)
	}
	defer second.Close()

	if err := second.Migrate(ctx); err != nil {
		t.Fatalf("second Migrate: %v", err)
	}
	if upCalls != 0 {
		t.Errorf("second run invoked Up %d times, want 0", upCalls)
	}

	var count int
	if err := second.DB().QueryRow(`SELECT count(*) FROM schema_migrations`).Scan(&count); err != nil {
		t.Fatalf("count schema_migrations rows: %v", err)
	}
	if count != 2 {
		t.Errorf("schema_migrations rows = %d, want 2", count)
	}
}

func TestOpenRejectsInvalidDefinitions(t *testing.T) {
	noop := func(ctx context.Context, tx *sql.Tx) error { return nil }
	cases := []struct {
		name        string
		migrations  []Migration
		wantErrPart string
	}{
		{name: "duplicate version", migrations: []Migration{{1, "a", noop}, {1, "b", noop}}, wantErrPart: "duplicate migration version"},
		{name: "gap", migrations: []Migration{{1, "a", noop}, {3, "c", noop}}, wantErrPart: "contiguous"},
		{name: "out of order", migrations: []Migration{{2, "b", noop}, {1, "a", noop}}, wantErrPart: "contiguous"},
		{name: "duplicate name", migrations: []Migration{{1, "same", noop}, {2, "same", noop}}, wantErrPart: "duplicate migration name"},
		{name: "empty name", migrations: []Migration{{1, "", noop}}, wantErrPart: "name must not be empty"},
		{name: "version zero", migrations: []Migration{{0, "a", noop}}, wantErrPart: "positive integer"},
		{name: "nil up", migrations: []Migration{{1, "a", nil}}, wantErrPart: "Up must not be nil"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "db", "app.db")
			migrator, err := Open(path, tc.migrations)
			if err == nil {
				migrator.Close()
				t.Fatal("expected validation error, got nil")
			}
			if !strings.Contains(err.Error(), tc.wantErrPart) {
				t.Errorf("error %q does not contain %q", err, tc.wantErrPart)
			}
			// Validation must happen before any filesystem touch.
			if _, statErr := os.Stat(path); !os.IsNotExist(statErr) {
				t.Errorf("database file must not be created on validation error (stat err: %v)", statErr)
			}
			if _, statErr := os.Stat(filepath.Dir(path)); !os.IsNotExist(statErr) {
				t.Errorf("database directory must not be created on validation error (stat err: %v)", statErr)
			}
		})
	}
}

func TestMigrateRejectsNewerDatabaseWithoutWrites(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "app.db")

	// Pre-create a database whose recorded history is already at version 2.
	seedDB(t, path, []recordedMigration{{version: 2, name: "two", appliedAt: "2024-01-01T00:00:00Z"}})

	beforeHash := fileHash(t, path)
	beforeMaster := masterSnapshot(t, path)

	migrator, err := Open(path, []Migration{{1, "one", func(ctx context.Context, tx *sql.Tx) error { return nil }}})
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer migrator.Close()

	err = migrator.Migrate(ctx)
	if err == nil {
		t.Fatal("expected ErrDatabaseTooNew, got nil")
	}
	if !errors.Is(err, ErrDatabaseTooNew) {
		t.Errorf("error %v does not wrap ErrDatabaseTooNew", err)
	}
	if !strings.Contains(err.Error(), "2") || !strings.Contains(err.Error(), "1") {
		t.Errorf("error %q should mention recorded version 2 and supported version 1", err)
	}

	afterHash := fileHash(t, path)
	if beforeHash != afterHash {
		t.Errorf("database file changed: hash before %s, after %s", beforeHash, afterHash)
	}
	afterMaster := masterSnapshot(t, path)
	if !reflect.DeepEqual(beforeMaster, afterMaster) {
		t.Errorf("sqlite_master changed:\nbefore: %v\nafter:  %v", beforeMaster, afterMaster)
	}
}

func TestMigrateRejectsNameMismatchWithoutWrites(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "app.db")

	seedDB(t, path, []recordedMigration{{version: 1, name: "some-other-name", appliedAt: "2024-01-01T00:00:00Z"}})
	beforeHash := fileHash(t, path)

	migrator, err := Open(path, []Migration{{1, "expected-name", func(ctx context.Context, tx *sql.Tx) error { return nil }}})
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer migrator.Close()

	err = migrator.Migrate(ctx)
	if err == nil {
		t.Fatal("expected name mismatch error, got nil")
	}
	if !strings.Contains(err.Error(), "some-other-name") || !strings.Contains(err.Error(), "expected-name") {
		t.Errorf("error %q should mention recorded name %q and definition name %q",
			err, "some-other-name", "expected-name")
	}

	afterHash := fileHash(t, path)
	if beforeHash != afterHash {
		t.Errorf("database file changed: hash before %s, after %s", beforeHash, afterHash)
	}
}

func TestMigrateRejectsCorruptRecordedHistoryWithoutWrites(t *testing.T) {
	ctx := context.Background()
	noop := func(ctx context.Context, tx *sql.Tx) error { return nil }

	cases := []struct {
		name        string
		recorded    []recordedMigration
		migrations  []Migration
		wantErrPart string
		wantTooNew  bool
	}{
		{
			name:     "version zero",
			recorded: []recordedMigration{{version: 0, name: "zero", appliedAt: "2024-01-01T00:00:00Z"}},
			migrations: []Migration{
				{1, "one", noop},
			},
			wantErrPart: "positive",
		},
		{
			name: "gap",
			recorded: []recordedMigration{
				{version: 1, name: "one", appliedAt: "2024-01-01T00:00:00Z"},
				{version: 3, name: "three", appliedAt: "2024-01-01T00:00:00Z"},
			},
			migrations: []Migration{
				{1, "one", noop},
				{2, "two", noop},
				{3, "three", noop},
			},
			wantErrPart: "missing version 2",
		},
		{
			name:     "too new",
			recorded: []recordedMigration{{version: 2, name: "two", appliedAt: "2024-01-01T00:00:00Z"}},
			migrations: []Migration{
				{1, "one", noop},
			},
			wantTooNew: true,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "app.db")
			seedDB(t, path, tc.recorded)
			beforeHash := fileHash(t, path)

			migrator, err := Open(path, tc.migrations)
			if err != nil {
				t.Fatalf("Open: %v", err)
			}
			defer migrator.Close()

			err = migrator.Migrate(ctx)
			if err == nil {
				t.Fatal("expected error, got nil")
			}
			if tc.wantTooNew {
				if !errors.Is(err, ErrDatabaseTooNew) {
					t.Errorf("error %v does not wrap ErrDatabaseTooNew", err)
				}
			} else if !strings.Contains(err.Error(), tc.wantErrPart) {
				t.Errorf("error %q does not contain %q", err, tc.wantErrPart)
			}

			// The gate must reject without writing: file bytes unchanged.
			afterHash := fileHash(t, path)
			if beforeHash != afterHash {
				t.Errorf("database file changed: hash before %s, after %s", beforeHash, afterHash)
			}
		})
	}
}

func TestMigrateRollsBackTransactionOnFailure(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "app.db")

	v1 := Migration{Version: 1, Name: "v1_users", Up: func(ctx context.Context, tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL)`); err != nil {
			return err
		}
		_, err := tx.ExecContext(ctx, `INSERT INTO users(name) VALUES ('alice')`)
		return err
	}}
	v2 := Migration{Version: 2, Name: "v2_posts", Up: func(ctx context.Context, tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `CREATE TABLE posts (id INTEGER PRIMARY KEY, title TEXT NOT NULL)`); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO posts(title) VALUES ('hello')`); err != nil {
			return err
		}
		return errors.New("injected failure in v2")
	}}

	// Apply v1 first so its effects are durable before the failing run.
	first, err := Open(path, []Migration{v1})
	if err != nil {
		t.Fatalf("first Open: %v", err)
	}
	if err := first.Migrate(ctx); err != nil {
		t.Fatalf("first Migrate: %v", err)
	}
	if err := first.Close(); err != nil {
		t.Fatalf("first Close: %v", err)
	}

	second, err := Open(path, []Migration{v1, v2})
	if err != nil {
		t.Fatalf("second Open: %v", err)
	}
	err = second.Migrate(ctx)
	if err == nil {
		t.Fatal("expected v2 failure, got nil")
	}
	if !strings.Contains(err.Error(), "injected failure in v2") {
		t.Errorf("error %q should wrap the injected v2 failure", err)
	}
	if err := second.Close(); err != nil {
		t.Fatalf("second Close: %v", err)
	}

	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatalf("inspect sql.Open: %v", err)
	}
	defer db.Close()

	// v1's effects persist.
	assertRowCount(t, db, "users", 1)

	// v2's table and data do not exist.
	assertTableAbsent(t, db, "posts")

	// schema_migrations records only version 1.
	rows, err := db.Query(`SELECT version, name FROM schema_migrations ORDER BY version`)
	if err != nil {
		t.Fatalf("query schema_migrations: %v", err)
	}
	defer rows.Close()
	var versions []int
	var names []string
	for rows.Next() {
		var version int
		var name string
		if err := rows.Scan(&version, &name); err != nil {
			t.Fatalf("scan schema_migrations row: %v", err)
		}
		versions = append(versions, version)
		names = append(names, name)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate schema_migrations: %v", err)
	}
	if want := []int{1}; !reflect.DeepEqual(versions, want) {
		t.Errorf("recorded versions = %v, want %v", versions, want)
	}
	if want := []string{"v1_users"}; !reflect.DeepEqual(names, want) {
		t.Errorf("recorded names = %v, want %v", names, want)
	}

	var v2Count int
	if err := db.QueryRow(`SELECT count(*) FROM schema_migrations WHERE version = 2`).Scan(&v2Count); err != nil {
		t.Fatalf("count version 2 rows: %v", err)
	}
	if v2Count != 0 {
		t.Errorf("schema_migrations has %d rows for version 2, want 0", v2Count)
	}
}

func TestMigrateRollsBackWhenFirstMigrationFails(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "app.db")

	migrations := []Migration{{Version: 1, Name: "v1_doomed", Up: func(ctx context.Context, tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `CREATE TABLE doomed (id INTEGER PRIMARY KEY, payload TEXT NOT NULL)`); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO doomed(payload) VALUES ('x')`); err != nil {
			return err
		}
		return errors.New("injected failure in v1")
	}}}

	migrator, err := Open(path, migrations)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	err = migrator.Migrate(ctx)
	if err == nil {
		t.Fatal("expected v1 failure, got nil")
	}
	if err := migrator.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}

	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatalf("inspect sql.Open: %v", err)
	}
	defer db.Close()

	// Nothing may survive: the schema_migrations table is created inside the
	// same transaction as the migration, so a failed first migration leaves
	// no schema_migrations table and no business tables at all.
	tables, err := listTables(db)
	if err != nil {
		t.Fatalf("list tables: %v", err)
	}
	if len(tables) != 0 {
		t.Errorf("tables %v survived rollback, want none", tables)
	}
	assertTableAbsent(t, db, "schema_migrations")
}

// recordedMigration is a row used to seed a schema_migrations table by hand.
type recordedMigration struct {
	version   int
	name      string
	appliedAt string
}

// seedDB creates a database file whose schema_migrations table contains the
// given rows, using raw SQL through database/sql.
func seedDB(t *testing.T, path string, recorded []recordedMigration) {
	t.Helper()
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatalf("seed sql.Open: %v", err)
	}
	defer db.Close()
	if _, err := db.Exec(`CREATE TABLE schema_migrations (
		version INTEGER PRIMARY KEY,
		name TEXT NOT NULL,
		applied_at TEXT NOT NULL
	)`); err != nil {
		t.Fatalf("seed create schema_migrations: %v", err)
	}
	for _, row := range recorded {
		if _, err := db.Exec(`INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)`,
			row.version, row.name, row.appliedAt); err != nil {
			t.Fatalf("seed insert version %d: %v", row.version, err)
		}
	}
}

// fileHash returns the SHA-256 of the database file's contents.
func fileHash(t *testing.T, path string) string {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read file %s: %v", path, err)
	}
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

// masterSnapshot returns the sqlite_master contents as stable strings.
func masterSnapshot(t *testing.T, path string) []string {
	t.Helper()
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatalf("snapshot sql.Open: %v", err)
	}
	defer db.Close()
	rows, err := db.Query(`SELECT type, name, sql FROM sqlite_master ORDER BY type, name`)
	if err != nil {
		t.Fatalf("snapshot query: %v", err)
	}
	defer rows.Close()
	var snapshot []string
	for rows.Next() {
		var typ, name string
		var sqlText sql.NullString
		if err := rows.Scan(&typ, &name, &sqlText); err != nil {
			t.Fatalf("snapshot scan: %v", err)
		}
		snapshot = append(snapshot, fmt.Sprintf("%s|%s|%s", typ, name, sqlText.String))
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("snapshot iterate: %v", err)
	}
	return snapshot
}

// listTables returns the names of all tables in the database.
func listTables(db *sql.DB) ([]string, error) {
	rows, err := db.Query(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var names []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, err
		}
		names = append(names, name)
	}
	return names, rows.Err()
}

func assertRowCount(t *testing.T, db *sql.DB, table string, want int) {
	t.Helper()
	var got int
	if err := db.QueryRow(fmt.Sprintf(`SELECT count(*) FROM %s`, table)).Scan(&got); err != nil {
		t.Fatalf("count rows in %s: %v", table, err)
	}
	if got != want {
		t.Errorf("rows in %s = %d, want %d", table, got, want)
	}
}

func assertTableAbsent(t *testing.T, db *sql.DB, table string) {
	t.Helper()
	var got int
	if err := db.QueryRow(`SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = ?`, table).Scan(&got); err != nil {
		t.Fatalf("check table %s: %v", table, err)
	}
	if got != 0 {
		t.Errorf("table %s still exists after rollback", table)
	}
}
