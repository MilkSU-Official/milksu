package appdata

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	_ "modernc.org/sqlite"
)

const (
	threeColumnHistoryCreate = `CREATE TABLE schema_migrations (
		version INTEGER PRIMARY KEY,
		name TEXT NOT NULL,
		applied_at TEXT NOT NULL
	)`
	legacyTwoColumnHistoryCreate = `CREATE TABLE schema_migrations (
		version INTEGER PRIMARY KEY,
		applied_at TEXT NOT NULL
	)`
)

func TestInspectDatabaseCompatibilityCompatibleThreeColumn(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "runtime", "events.sqlite3")
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	seedMigrationHistory(t, path, true, [][2]any{{1, "2024-01-01T00:00:00Z"}})

	results := InspectDatabaseCompatibility(context.Background(), root, []DatabaseDescriptor{
		{LogicalName: "EventStore", RelativePath: "runtime/events.sqlite3", Supported: 1},
	})
	if len(results) != 1 {
		t.Fatalf("result count = %d, want 1: %#v", len(results), results)
	}
	status := results[0]
	if status.State != "compatible" {
		t.Fatalf("state = %q, want compatible: %#v", status.State, status)
	}
	if status.Current == nil || *status.Current != 1 {
		t.Fatalf("current = %v, want 1", status.Current)
	}
	if status.Supported == nil || *status.Supported != 1 {
		t.Fatalf("supported = %v, want 1", status.Supported)
	}
	if status.Error != "" {
		t.Fatalf("error = %q, want empty", status.Error)
	}
}

func TestInspectDatabaseCompatibilityLegacyTwoColumn(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "runtime", "events.sqlite3")
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	seedMigrationHistory(t, path, false, [][2]any{{1, "2024-01-01T00:00:00Z"}})

	results := InspectDatabaseCompatibility(context.Background(), root, []DatabaseDescriptor{
		{LogicalName: "EventStore", RelativePath: "runtime/events.sqlite3", Supported: 1},
	})
	if len(results) != 1 {
		t.Fatalf("result count = %d, want 1: %#v", len(results), results)
	}
	status := results[0]
	if status.State != "compatible" {
		t.Fatalf("state = %q, want compatible: %#v", status.State, status)
	}
	if status.Current == nil || *status.Current != 1 {
		t.Fatalf("current = %v, want 1", status.Current)
	}
	if status.Supported == nil || *status.Supported != 1 {
		t.Fatalf("supported = %v, want 1", status.Supported)
	}
	if status.Error != "" {
		t.Fatalf("error = %q, want empty", status.Error)
	}
}

func TestInspectDatabaseCompatibilityNewer(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "runtime", "events.sqlite3")
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	seedMigrationHistory(t, path, true, [][2]any{
		{1, "2024-01-01T00:00:00Z"},
		{2, "2024-02-01T00:00:00Z"},
	})

	results := InspectDatabaseCompatibility(context.Background(), root, []DatabaseDescriptor{
		{LogicalName: "EventStore", RelativePath: "runtime/events.sqlite3", Supported: 1},
	})
	if len(results) != 1 {
		t.Fatalf("result count = %d, want 1: %#v", len(results), results)
	}
	status := results[0]
	if status.State != "newer" {
		t.Fatalf("state = %q, want newer: %#v", status.State, status)
	}
	if status.Current == nil || *status.Current != 2 {
		t.Fatalf("current = %v, want 2", status.Current)
	}
	if status.Supported == nil || *status.Supported != 1 {
		t.Fatalf("supported = %v, want 1", status.Supported)
	}
	if status.Error != "" {
		t.Fatalf("error = %q, want empty", status.Error)
	}
}

func TestInspectDatabaseCompatibilityMissingNeverCreates(t *testing.T) {
	root := t.TempDir()
	results := InspectDatabaseCompatibility(context.Background(), root, []DatabaseDescriptor{
		{LogicalName: "EventStore", RelativePath: "runtime/events.sqlite3", Supported: 1},
	})
	if len(results) != 1 {
		t.Fatalf("result count = %d, want 1: %#v", len(results), results)
	}
	status := results[0]
	if status.State != "missing" {
		t.Fatalf("state = %q, want missing: %#v", status.State, status)
	}
	if status.Current != nil {
		t.Fatalf("current = %v, want nil for missing", status.Current)
	}
	if status.Supported == nil || *status.Supported != 1 {
		t.Fatalf("supported = %v, want 1 for missing", status.Supported)
	}
	if _, err := os.Lstat(filepath.Join(root, "runtime", "events.sqlite3")); !os.IsNotExist(err) {
		t.Fatalf("database file was created by inspection: %v", err)
	}
	if _, err := os.Lstat(filepath.Join(root, "runtime")); !os.IsNotExist(err) {
		t.Fatalf("parent directory was created by inspection: %v", err)
	}
}

func TestInspectDatabaseCompatibilityCorruptOrUnreadable(t *testing.T) {
	t.Run("garbage bytes", func(t *testing.T) {
		root := t.TempDir()
		path := filepath.Join(root, "runtime", "events.sqlite3")
		if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte("this is definitely not a sqlite database file"), 0o600); err != nil {
			t.Fatal(err)
		}
		results := InspectDatabaseCompatibility(context.Background(), root, []DatabaseDescriptor{
			{LogicalName: "EventStore", RelativePath: "runtime/events.sqlite3", Supported: 1},
		})
		status := results[0]
		if status.State != "corrupt" {
			t.Fatalf("state = %q, want corrupt: %#v", status.State, status)
		}
		if status.Error == "" {
			t.Fatal("expected a non-empty sanitized error for a garbage file")
		}
		if strings.Contains(status.Error, root) || strings.Contains(status.Error, path) {
			t.Fatalf("error leaked an absolute path: %q", status.Error)
		}
		if status.Current != nil {
			t.Fatalf("current = %v, want nil for corrupt", status.Current)
		}
	})

	t.Run("directory at path", func(t *testing.T) {
		root := t.TempDir()
		path := filepath.Join(root, "events.db")
		if err := os.MkdirAll(path, 0o700); err != nil {
			t.Fatal(err)
		}
		results := InspectDatabaseCompatibility(context.Background(), root, []DatabaseDescriptor{
			{LogicalName: "EventStore", RelativePath: "events.db", Supported: 1},
		})
		status := results[0]
		if status.State != "corrupt" {
			t.Fatalf("state = %q, want corrupt: %#v", status.State, status)
		}
		if status.Error == "" {
			t.Fatal("expected a non-empty sanitized error for a directory")
		}
		if strings.Contains(status.Error, root) {
			t.Fatalf("error leaked an absolute path: %q", status.Error)
		}
	})

	t.Run("symlink never opened", func(t *testing.T) {
		root := t.TempDir()
		target := filepath.Join(root, "target.sqlite3")
		seedMigrationHistory(t, target, true, [][2]any{{1, "2024-01-01T00:00:00Z"}})
		before := fileSHA256(t, target)
		link := filepath.Join(root, "linked.db")
		if err := os.Symlink(target, link); err != nil {
			t.Fatal(err)
		}
		results := InspectDatabaseCompatibility(context.Background(), root, []DatabaseDescriptor{
			{LogicalName: "EventStore", RelativePath: "linked.db", Supported: 1},
		})
		status := results[0]
		if status.State != "corrupt" {
			t.Fatalf("state = %q, want corrupt: %#v", status.State, status)
		}
		if status.Error == "" {
			t.Fatal("expected a non-empty sanitized error for a symlink")
		}
		if status.Current != nil {
			t.Fatalf("current = %v, want nil for corrupt", status.Current)
		}
		if after := fileSHA256(t, target); after != before {
			t.Fatalf("symlink target changed while never opened: %s -> %s", before, after)
		}
	})

	t.Run("invalid root is sanitized", func(t *testing.T) {
		missingRoot := filepath.Join(t.TempDir(), "does-not-exist")
		results := InspectDatabaseCompatibility(context.Background(), missingRoot, []DatabaseDescriptor{
			{LogicalName: "EventStore", RelativePath: "runtime/events.sqlite3", Supported: 1},
		})
		if len(results) != 1 {
			t.Fatalf("result count = %d, want 1: %#v", len(results), results)
		}
		status := results[0]
		if status.State != "corrupt" {
			t.Fatalf("state = %q, want corrupt: %#v", status.State, status)
		}
		if !strings.Contains(status.Error, "<data>") {
			t.Fatalf("error must contain <data> after root replacement: %q", status.Error)
		}
		if strings.Contains(status.Error, missingRoot) {
			t.Fatalf("error leaked the absolute root path: %q", status.Error)
		}
	})
}

func TestInspectDatabaseCompatibilityRemainingNotOpened(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "ctf", "memory.sqlite3")
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("garbage that must never be opened"), 0o600); err != nil {
		t.Fatal(err)
	}
	before := fileSHA256(t, path)

	results := InspectDatabaseCompatibility(context.Background(), root, []DatabaseDescriptor{
		{LogicalName: "CTF Memory", RelativePath: "ctf/memory.sqlite3", Supported: 0},
	})
	if len(results) != 1 {
		t.Fatalf("result count = %d, want 1: %#v", len(results), results)
	}
	status := results[0]
	if status.State != "remaining" {
		t.Fatalf("state = %q, want remaining: %#v", status.State, status)
	}
	if status.Current != nil || status.Supported != nil {
		t.Fatalf("current/supported = %v/%v, want both nil for remaining", status.Current, status.Supported)
	}
	if status.Error != "" {
		t.Fatalf("error = %q, want empty for remaining", status.Error)
	}
	if after := fileSHA256(t, path); after != before {
		t.Fatalf("remaining database file was touched: %s -> %s", before, after)
	}
}

func TestInspectDatabaseCompatibilityOrderStable(t *testing.T) {
	root := t.TempDir()
	eventsPath := filepath.Join(root, "runtime", "events.sqlite3")
	if err := os.MkdirAll(filepath.Dir(eventsPath), 0o700); err != nil {
		t.Fatal(err)
	}
	seedMigrationHistory(t, eventsPath, true, [][2]any{{1, "2024-01-01T00:00:00Z"}})

	results := InspectDatabaseCompatibility(context.Background(), root, []DatabaseDescriptor{
		{LogicalName: "Remaining", RelativePath: "ctf/memory.sqlite3", Supported: 0},
		{LogicalName: "EventStore", RelativePath: "runtime/events.sqlite3", Supported: 1},
		{LogicalName: "Absent", RelativePath: "absent/db.sqlite3", Supported: 1},
		{LogicalName: "Traversal", RelativePath: "x/../y.db", Supported: 1},
	})
	if len(results) != 4 {
		t.Fatalf("result count = %d, want 4: %#v", len(results), results)
	}
	wantNames := []string{"Remaining", "EventStore", "Absent", "Traversal"}
	wantStates := []string{"remaining", "compatible", "missing", "corrupt"}
	for index := range results {
		if results[index].LogicalName != wantNames[index] {
			t.Fatalf("result %d logicalName = %q, want %q: %#v",
				index, results[index].LogicalName, wantNames[index], results)
		}
		if results[index].State != wantStates[index] {
			t.Fatalf("result %d state = %q, want %q: %#v",
				index, results[index].State, wantStates[index], results)
		}
	}
}

func TestInspectDatabaseCompatibilityReadOnly(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "runtime", "events.sqlite3")
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	seedMigrationHistory(t, path, true, [][2]any{{1, "2024-01-01T00:00:00Z"}})
	before := fileSHA256(t, path)

	results := InspectDatabaseCompatibility(context.Background(), root, []DatabaseDescriptor{
		{LogicalName: "EventStore", RelativePath: "runtime/events.sqlite3", Supported: 1},
	})
	if len(results) != 1 || results[0].State != "compatible" {
		t.Fatalf("unexpected results: %#v", results)
	}
	if after := fileSHA256(t, path); after != before {
		t.Fatalf("database bytes changed during inspection: %s -> %s", before, after)
	}
	for _, sidecar := range []string{
		path + "-wal",
		path + "-shm",
	} {
		if _, err := os.Lstat(sidecar); !os.IsNotExist(err) {
			t.Fatalf("inspection created %s: %v", sidecar, err)
		}
	}
}

func TestInspectDatabaseCompatibilitySkipsCredentials(t *testing.T) {
	root := t.TempDir()
	credentialsPath := filepath.Join(root, "credentials.db")
	credentialsPayload := []byte("credential-payload-must-not-be-touched")
	if err := os.WriteFile(credentialsPath, credentialsPayload, 0o600); err != nil {
		t.Fatal(err)
	}
	fixedTime := time.Date(2024, 1, 2, 3, 4, 5, 0, time.UTC)
	if err := os.Chtimes(credentialsPath, fixedTime, fixedTime); err != nil {
		t.Fatal(err)
	}
	before := fileSHA256(t, credentialsPath)

	eventsPath := filepath.Join(root, "runtime", "events.sqlite3")
	if err := os.MkdirAll(filepath.Dir(eventsPath), 0o700); err != nil {
		t.Fatal(err)
	}
	seedMigrationHistory(t, eventsPath, true, [][2]any{{1, "2024-01-01T00:00:00Z"}})

	results := InspectDatabaseCompatibility(context.Background(), root, []DatabaseDescriptor{
		{LogicalName: "Credentials", RelativePath: "credentials.db", Supported: 1},
		{LogicalName: "EventStore", RelativePath: "runtime/events.sqlite3", Supported: 1},
	})
	for _, status := range results {
		if strings.Contains(strings.ToLower(status.RelativePath), "credentials") {
			t.Fatalf("credentials descriptor leaked into results: %#v", status)
		}
	}
	if len(results) != 1 || results[0].LogicalName != "EventStore" {
		t.Fatalf("unexpected results: %#v", results)
	}
	if after := fileSHA256(t, credentialsPath); after != before {
		t.Fatalf("credentials.db content changed: %s -> %s", before, after)
	}
	info, err := os.Stat(credentialsPath)
	if err != nil {
		t.Fatal(err)
	}
	if !info.ModTime().Equal(fixedTime) {
		t.Fatalf("credentials.db mtime changed: %v, want %v", info.ModTime(), fixedTime)
	}
}

func TestInspectDatabaseCompatibilityUnsafePaths(t *testing.T) {
	root := t.TempDir()
	bPath := filepath.Join(root, "b.db")
	if err := os.WriteFile(bPath, []byte("garbage target that must not be opened"), 0o600); err != nil {
		t.Fatal(err)
	}
	before := fileSHA256(t, bPath)

	results := InspectDatabaseCompatibility(context.Background(), root, []DatabaseDescriptor{
		{LogicalName: "Absolute", RelativePath: "/absolute/path/db.sqlite3", Supported: 1},
		{LogicalName: "Traversal", RelativePath: "a/../b.db", Supported: 1},
		{LogicalName: "Empty", RelativePath: "", Supported: 1},
	})
	if len(results) != 3 {
		t.Fatalf("result count = %d, want 3: %#v", len(results), results)
	}
	for _, status := range results {
		if status.State != "corrupt" {
			t.Fatalf("state = %q, want corrupt: %#v", status.State, status)
		}
		if status.Error != "unsafe database path" {
			t.Fatalf("error = %q, want %q: %#v", status.Error, "unsafe database path", status)
		}
		if status.Current != nil {
			t.Fatalf("current = %v, want nil for corrupt: %#v", status.Current, status)
		}
	}
	if after := fileSHA256(t, bPath); after != before {
		t.Fatalf("traversal target was opened: %s -> %s", before, after)
	}
	if _, err := os.Lstat(filepath.Join(root, "a")); !os.IsNotExist(err) {
		t.Fatalf("traversal directory was created: %v", err)
	}
}

func TestInspectDatabaseCompatibilityHistoryShapes(t *testing.T) {
	cases := []struct {
		name        string
		create      string
		inserts     []string
		wantState   string
		wantCurrent int // -1 means Current must be nil
	}{
		{
			name:        "missing schema_migrations table",
			create:      `CREATE TABLE notes (id INTEGER PRIMARY KEY)`,
			wantState:   "corrupt",
			wantCurrent: -1,
		},
		{
			name: "extra column",
			create: `CREATE TABLE schema_migrations (
				version INTEGER PRIMARY KEY,
				name TEXT NOT NULL,
				applied_at TEXT NOT NULL,
				extra TEXT NOT NULL
			)`,
			inserts: []string{
				`INSERT INTO schema_migrations(version, name, applied_at, extra) VALUES (1, 'v', 't', 'e')`,
			},
			wantState:   "corrupt",
			wantCurrent: -1,
		},
		{
			name: "wrong column order",
			create: `CREATE TABLE schema_migrations (
				name TEXT NOT NULL,
				version INTEGER PRIMARY KEY,
				applied_at TEXT NOT NULL
			)`,
			inserts: []string{
				`INSERT INTO schema_migrations(version, name, applied_at) VALUES (1, 'v', 't')`,
			},
			wantState:   "corrupt",
			wantCurrent: -1,
		},
		{
			name:        "zero version",
			create:      threeColumnHistoryCreate,
			inserts:     []string{`INSERT INTO schema_migrations(version, name, applied_at) VALUES (0, 'v', 't')`},
			wantState:   "corrupt",
			wantCurrent: -1,
		},
		{
			name:        "negative version",
			create:      threeColumnHistoryCreate,
			inserts:     []string{`INSERT INTO schema_migrations(version, name, applied_at) VALUES (-1, 'v', 't')`},
			wantState:   "corrupt",
			wantCurrent: -1,
		},
		{
			name:   "gap",
			create: threeColumnHistoryCreate,
			inserts: []string{
				`INSERT INTO schema_migrations(version, name, applied_at) VALUES (1, 'v', 't')`,
				`INSERT INTO schema_migrations(version, name, applied_at) VALUES (3, 'v', 't')`,
			},
			wantState:   "corrupt",
			wantCurrent: -1,
		},
		{
			name: "duplicate",
			create: `CREATE TABLE schema_migrations (
				version INTEGER NOT NULL,
				name TEXT NOT NULL,
				applied_at TEXT NOT NULL
			)`,
			inserts: []string{
				`INSERT INTO schema_migrations(version, name, applied_at) VALUES (1, 'v', 't')`,
				`INSERT INTO schema_migrations(version, name, applied_at) VALUES (1, 'v', 't')`,
			},
			wantState:   "corrupt",
			wantCurrent: -1,
		},
		{
			name:        "empty history",
			create:      threeColumnHistoryCreate,
			wantState:   "compatible",
			wantCurrent: 0,
		},
	}

	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			root := t.TempDir()
			path := filepath.Join(root, "runtime", "events.sqlite3")
			if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
				t.Fatal(err)
			}
			database, err := sql.Open("sqlite", path)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := database.Exec(test.create); err != nil {
				database.Close()
				t.Fatalf("seed create: %v", err)
			}
			for _, insert := range test.inserts {
				if _, err := database.Exec(insert); err != nil {
					database.Close()
					t.Fatalf("seed insert: %v", err)
				}
			}
			if err := database.Close(); err != nil {
				t.Fatal(err)
			}

			results := InspectDatabaseCompatibility(context.Background(), root, []DatabaseDescriptor{
				{LogicalName: "EventStore", RelativePath: "runtime/events.sqlite3", Supported: 1},
			})
			if len(results) != 1 {
				t.Fatalf("result count = %d, want 1: %#v", len(results), results)
			}
			status := results[0]
			if status.State != test.wantState {
				t.Fatalf("state = %q, want %q: %#v", status.State, test.wantState, status)
			}
			if test.wantCurrent < 0 {
				if status.Current != nil {
					t.Fatalf("current = %v, want nil for corrupt", status.Current)
				}
				if status.Error == "" {
					t.Fatal("expected a non-empty sanitized error")
				}
				if strings.Contains(status.Error, root) {
					t.Fatalf("error leaked the absolute root path: %q", status.Error)
				}
			} else {
				if status.Current == nil || *status.Current != test.wantCurrent {
					t.Fatalf("current = %v, want %d", status.Current, test.wantCurrent)
				}
				if status.Error != "" {
					t.Fatalf("error = %q, want empty", status.Error)
				}
			}
		})
	}
}

func seedMigrationHistory(t *testing.T, path string, threeColumn bool, rows [][2]any) {
	t.Helper()
	database, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	create := legacyTwoColumnHistoryCreate
	if threeColumn {
		create = threeColumnHistoryCreate
	}
	if _, err := database.Exec(create); err != nil {
		t.Fatal(err)
	}
	for _, row := range rows {
		if threeColumn {
			if _, err := database.Exec(
				`INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, '', ?)`,
				row[0], row[1],
			); err != nil {
				t.Fatal(err)
			}
			continue
		}
		if _, err := database.Exec(
			`INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)`,
			row[0], row[1],
		); err != nil {
			t.Fatal(err)
		}
	}
}

func fileSHA256(t *testing.T, path string) string {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(data)
	return hex.EncodeToString(digest[:])
}
