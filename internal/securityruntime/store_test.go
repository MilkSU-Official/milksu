package securityruntime

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	_ "modernc.org/sqlite"

	"github.com/MilkSU-Official/milksu/internal/sqlitemigrate"
)

func TestEventStoreIsAppendOnlyAndSequencesConcurrentWrites(t *testing.T) {
	store, err := OpenEventStore(t.TempDir() + "/events.sqlite3")
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	job := testJob("job_sequence")
	if _, err := store.Append(context.Background(), EventDraft{
		JobID: job.ID, Kind: EventJobCreated, Payload: jobCreatedPayload{Job: job},
	}); err != nil {
		t.Fatal(err)
	}

	const writers = 12
	var wait sync.WaitGroup
	errors := make(chan error, writers)
	for range writers {
		wait.Add(1)
		go func() {
			defer wait.Done()
			_, err := store.Append(context.Background(), EventDraft{
				JobID: job.ID, Kind: EventJobRecoveryStarted, Payload: recoveryPayload{},
			})
			errors <- err
		}()
	}
	wait.Wait()
	close(errors)
	for err := range errors {
		if err != nil {
			t.Fatal(err)
		}
	}

	events, err := store.Events(context.Background(), job.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != writers+1 {
		t.Fatalf("expected %d events, got %d", writers+1, len(events))
	}
	for index, event := range events {
		if event.Sequence != int64(index+1) {
			t.Fatalf("sequence[%d] = %d", index, event.Sequence)
		}
	}

	if _, err := store.db.Exec(`UPDATE events SET kind = kind WHERE job_id = ?`, job.ID); err == nil {
		t.Fatal("append-only trigger allowed UPDATE")
	}
	if _, err := store.db.Exec(`DELETE FROM events WHERE job_id = ?`, job.ID); err == nil {
		t.Fatal("append-only trigger allowed DELETE")
	}
}

func TestEventStoreRejectsSucceededOutcomeWithoutPassingEvaluation(t *testing.T) {
	store, err := OpenEventStore(t.TempDir() + "/events.sqlite3")
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	job := testJob("job_invariant")
	if _, err := store.Append(context.Background(), EventDraft{
		JobID: job.ID, Kind: EventJobCreated, Payload: jobCreatedPayload{Job: job},
	}); err != nil {
		t.Fatal(err)
	}
	_, err = store.Append(context.Background(), EventDraft{
		JobID: job.ID,
		Kind:  EventOutcomeDecided,
		Payload: outcomePayload{Outcome: Outcome{
			Status: OutcomeSucceeded, EvaluationID: "evaluation_missing",
		}},
	})
	if err == nil {
		t.Fatal("store accepted model-style self-reported success")
	}
	events, listErr := store.Events(context.Background(), job.ID)
	if listErr != nil {
		t.Fatal(listErr)
	}
	if len(events) != 1 {
		t.Fatalf("invalid event was persisted: %d events", len(events))
	}
}

func TestEventStoreRejectsMismatchedObjectReferences(t *testing.T) {
	store, err := OpenEventStore(t.TempDir() + "/events.sqlite3")
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	job := testJob("job_reference")
	if _, err := store.Append(context.Background(), EventDraft{
		JobID: job.ID, Kind: EventJobCreated, Payload: jobCreatedPayload{Job: job},
	}); err != nil {
		t.Fatal(err)
	}
	attempt := Attempt{
		ID: "attempt_one", JobID: job.ID, Engine: "test", Model: "test", Environment: "test",
		Evaluator: "test@1", Status: AttemptRunning, StartedAt: time.Now().UTC(),
	}
	if _, err := store.Append(context.Background(), EventDraft{
		JobID: job.ID, AttemptID: attempt.ID, Kind: EventAttemptStarted, Payload: attemptPayload{Attempt: attempt},
	}); err != nil {
		t.Fatal(err)
	}
	step := Step{ID: "step_one", AttemptID: attempt.ID, Name: "test", Status: StepRunning, StartedAt: time.Now().UTC()}
	if _, err := store.Append(context.Background(), EventDraft{
		JobID: job.ID, AttemptID: "attempt_other", StepID: step.ID,
		Kind: EventStepStarted, Payload: stepPayload{Step: step},
	}); err == nil {
		t.Fatal("store accepted a step whose event and payload attempts disagree")
	}
	events, err := store.Events(context.Background(), job.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 2 {
		t.Fatalf("invalid reference was persisted: %d events", len(events))
	}
}

func TestOpenEventStoreFreshCreatesThreeColumnHistory(t *testing.T) {
	store, err := OpenEventStore(filepath.Join(t.TempDir(), "events.sqlite3"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	var count int
	if err := store.db.QueryRow(`SELECT count(*) FROM schema_migrations`).Scan(&count); err != nil {
		t.Fatalf("count schema_migrations: %v", err)
	}
	if count != 1 {
		t.Errorf("schema_migrations rows = %d, want 1", count)
	}
	var version int
	var name string
	var appliedAt string
	if err := store.db.QueryRow(`SELECT version, name, applied_at FROM schema_migrations`).Scan(&version, &name, &appliedAt); err != nil {
		t.Fatalf("query schema_migrations: %v", err)
	}
	if version != 1 || name != "create events store" || appliedAt == "" {
		t.Errorf("schema_migrations = (%d, %q, %q), want (1, %q, non-empty applied_at)",
			version, name, appliedAt, "create events store")
	}
	if columns := historyColumns(t, store.db); !columns["name"] {
		t.Errorf("schema_migrations lacks a name column: %v", columns)
	}
}

func TestOpenEventStoreUpgradesLegacyDatabaseWithoutHistory(t *testing.T) {
	path := filepath.Join(t.TempDir(), "events.sqlite3")
	seedLegacyEventStore(t, path)

	store, err := OpenEventStore(path)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	events, err := store.Events(context.Background(), "job_legacy")
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 1 {
		t.Fatalf("legacy events = %d, want 1", len(events))
	}
	if events[0].EventID != "evt_legacy" || events[0].Sequence != 1 {
		t.Errorf("legacy event = %+v", events[0])
	}
	assertAppendOnlyEnforced(t, store, "job_legacy")

	// The migrator must have recorded version 1 with the v1 definition name.
	var version int
	var name string
	if err := store.db.QueryRow(`SELECT version, name FROM schema_migrations`).Scan(&version, &name); err != nil {
		t.Fatalf("query schema_migrations: %v", err)
	}
	if version != 1 || name != "create events store" {
		t.Errorf("schema_migrations = (%d, %q), want (1, %q)", version, name, "create events store")
	}
}

func TestOpenEventStoreUpgradesLegacyTwoColumnHistory(t *testing.T) {
	path := filepath.Join(t.TempDir(), "events.sqlite3")
	seedLegacyTwoColumnEventStore(t, path, 1)

	store, err := OpenEventStore(path)
	if err != nil {
		t.Fatal(err)
	}

	events, err := store.Events(context.Background(), "job_legacy")
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 1 {
		t.Fatalf("legacy events = %d, want 1", len(events))
	}
	assertAppendOnlyEnforced(t, store, "job_legacy")

	// The two-column history table must have been upgraded to three columns
	// with the version-1 name backfilled from the v1 definition.
	if columns := historyColumns(t, store.db); !columns["name"] {
		t.Errorf("schema_migrations was not upgraded to three columns: %v", columns)
	}
	var name string
	if err := store.db.QueryRow(`SELECT name FROM schema_migrations WHERE version = 1`).Scan(&name); err != nil {
		t.Fatalf("query backfilled name: %v", err)
	}
	if name != "create events store" {
		t.Errorf("backfilled name = %q, want %q", name, "create events store")
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}

	// Reopening the upgraded database is idempotent and keeps the event.
	reopened, err := OpenEventStore(path)
	if err != nil {
		t.Fatalf("reopen: %v", err)
	}
	defer reopened.Close()
	events, err = reopened.Events(context.Background(), "job_legacy")
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 1 {
		t.Errorf("reopened legacy events = %d, want 1", len(events))
	}
}

func TestOpenEventStoreRejectsTooNewTwoColumnHistoryWithoutWrites(t *testing.T) {
	path := filepath.Join(t.TempDir(), "events.sqlite3")
	seedTwoColumnHistoryOnly(t, path, 2)
	before := eventStoreFileHash(t, path)

	store, err := OpenEventStore(path)
	if err == nil {
		store.Close()
		t.Fatal("expected ErrDatabaseTooNew, got nil")
	}
	if !errors.Is(err, sqlitemigrate.ErrDatabaseTooNew) {
		t.Errorf("error %v does not wrap sqlitemigrate.ErrDatabaseTooNew", err)
	}

	after := eventStoreFileHash(t, path)
	if before != after {
		t.Errorf("database file changed: hash before %s, after %s", before, after)
	}
	assertNoSidecarFiles(t, path)
}

func TestOpenEventStoreRejectsTooNewThreeColumnHistoryWithoutWrites(t *testing.T) {
	path := filepath.Join(t.TempDir(), "events.sqlite3")
	seedThreeColumnHistoryOnly(t, path, 2)
	before := eventStoreFileHash(t, path)

	store, err := OpenEventStore(path)
	if err == nil {
		store.Close()
		t.Fatal("expected ErrDatabaseTooNew, got nil")
	}
	if !errors.Is(err, sqlitemigrate.ErrDatabaseTooNew) {
		t.Errorf("error %v does not wrap sqlitemigrate.ErrDatabaseTooNew", err)
	}

	after := eventStoreFileHash(t, path)
	if before != after {
		t.Errorf("database file changed: hash before %s, after %s", before, after)
	}
	assertNoSidecarFiles(t, path)
}

func TestOpenEventStoreReopenIsIdempotent(t *testing.T) {
	path := filepath.Join(t.TempDir(), "events.sqlite3")
	store, err := OpenEventStore(path)
	if err != nil {
		t.Fatal(err)
	}
	job := testJob("job_reopen")
	if _, err := store.Append(context.Background(), EventDraft{
		JobID: job.ID, Kind: EventJobCreated, Payload: jobCreatedPayload{Job: job},
	}); err != nil {
		t.Fatal(err)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}

	reopened, err := OpenEventStore(path)
	if err != nil {
		t.Fatalf("reopen: %v", err)
	}
	defer reopened.Close()

	events, err := reopened.Events(context.Background(), job.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 1 {
		t.Fatalf("reopened events = %d, want 1", len(events))
	}
	assertAppendOnlyEnforced(t, reopened, job.ID)
}

// assertAppendOnlyEnforced checks that both append-only triggers still reject
// UPDATE and DELETE on the events table.
func assertAppendOnlyEnforced(t *testing.T, store *EventStore, jobID string) {
	t.Helper()
	if _, err := store.db.Exec(`UPDATE events SET kind = kind WHERE job_id = ?`, jobID); err == nil {
		t.Fatal("append-only trigger allowed UPDATE")
	}
	if _, err := store.db.Exec(`DELETE FROM events WHERE job_id = ?`, jobID); err == nil {
		t.Fatal("append-only trigger allowed DELETE")
	}
}

// historyColumns returns the column names of the schema_migrations table.
func historyColumns(t *testing.T, db *sql.DB) map[string]bool {
	t.Helper()
	rows, err := db.Query(`PRAGMA table_info(schema_migrations)`)
	if err != nil {
		t.Fatalf("PRAGMA table_info: %v", err)
	}
	defer rows.Close()
	columns := make(map[string]bool)
	for rows.Next() {
		var cid int
		var name, columnType string
		var notNull, pk int
		var dflt sql.NullString
		if err := rows.Scan(&cid, &name, &columnType, &notNull, &dflt, &pk); err != nil {
			t.Fatalf("scan schema_migrations column: %v", err)
		}
		columns[name] = true
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate schema_migrations columns: %v", err)
	}
	return columns
}

func TestOpenEventStoreRejectsMalformedHistoryShapeWithoutWrites(t *testing.T) {
	cases := []struct {
		name   string
		create string
	}{
		{
			name: "extra column",
			create: `CREATE TABLE schema_migrations (
				version INTEGER PRIMARY KEY,
				applied_at TEXT NOT NULL,
				extra TEXT NOT NULL
			)`,
		},
		{
			name: "wrong column order",
			create: `CREATE TABLE schema_migrations (
				name TEXT NOT NULL,
				version INTEGER PRIMARY KEY,
				applied_at TEXT NOT NULL
			)`,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "events.sqlite3")
			seedTable(t, path, tc.create)
			before := eventStoreFileHash(t, path)

			store, err := OpenEventStore(path)
			if err == nil {
				store.Close()
				t.Fatal("expected corrupt-history error, got nil")
			}
			if !strings.Contains(err.Error(), "corrupt migration history") {
				t.Errorf("error %q should be a clear corrupt-history error", err)
			}

			// The gate must reject before any PRAGMA/ALTER/write: file bytes
			// unchanged and no -wal/-shm sidecars.
			after := eventStoreFileHash(t, path)
			if before != after {
				t.Errorf("database file changed: hash before %s, after %s", before, after)
			}
			assertNoSidecarFiles(t, path)
		})
	}
}

func TestEventStoreVersionSemanticsAreIndependent(t *testing.T) {
	store, err := OpenEventStore(filepath.Join(t.TempDir(), "events.sqlite3"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	// (a) schema_migrations records the DATABASE MIGRATION version.
	var dbVersion int
	if err := store.db.QueryRow(`SELECT version FROM schema_migrations`).Scan(&dbVersion); err != nil {
		t.Fatalf("query schema_migrations version: %v", err)
	}
	if dbVersion != SupportedEventStoreDatabaseVersion {
		t.Errorf("schema_migrations version = %d, want SupportedEventStoreDatabaseVersion (%d)",
			dbVersion, SupportedEventStoreDatabaseVersion)
	}

	// (b) An appended event carries the EVENT PAYLOAD schema version.
	job := testJob("job_versions")
	event, err := store.Append(context.Background(), EventDraft{
		JobID: job.ID, Kind: EventJobCreated, Payload: jobCreatedPayload{Job: job},
	})
	if err != nil {
		t.Fatal(err)
	}
	if event.SchemaVersion != eventSchemaVersion {
		t.Errorf("event SchemaVersion = %d, want eventSchemaVersion (%d)",
			event.SchemaVersion, eventSchemaVersion)
	}
	var stored int
	if err := store.db.QueryRow(`SELECT schema_version FROM events WHERE event_id = ?`, event.EventID).Scan(&stored); err != nil {
		t.Fatalf("query events.schema_version: %v", err)
	}
	if stored != eventSchemaVersion {
		t.Errorf("events.schema_version = %d, want eventSchemaVersion (%d)", stored, eventSchemaVersion)
	}

	// (c) Both constants are 1 today, but each is referenced independently
	// (the migration record from SupportedEventStoreDatabaseVersion, appended
	// events from eventSchemaVersion).
	if SupportedEventStoreDatabaseVersion != 1 {
		t.Errorf("SupportedEventStoreDatabaseVersion = %d, want 1", SupportedEventStoreDatabaseVersion)
	}
	if eventSchemaVersion != 1 {
		t.Errorf("eventSchemaVersion = %d, want 1", eventSchemaVersion)
	}
}

// seedTable creates a database file containing a table with the given DDL.
func seedTable(t *testing.T, path string, ddl string) {
	t.Helper()
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatalf("seed sql.Open: %v", err)
	}
	defer db.Close()
	if _, err := db.Exec(ddl); err != nil {
		t.Fatalf("seed table: %v", err)
	}
}

// seedLegacyEventStore creates an events table (v1 DDL) with both append-only
// triggers and a single event row, but no schema_migrations table, using raw
// SQL through database/sql. This mirrors what the event store wrote before it
// recorded migration history.
func seedLegacyEventStore(t *testing.T, path string) {
	t.Helper()
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatalf("seed sql.Open: %v", err)
	}
	defer db.Close()
	execLegacyDDL(t, db)
	insertLegacyEvent(t, db)
}

// seedLegacyTwoColumnEventStore creates the events table plus a legacy
// two-column schema_migrations(version, applied_at) table recording the given
// version, and a single event row.
func seedLegacyTwoColumnEventStore(t *testing.T, path string, version int) {
	t.Helper()
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatalf("seed sql.Open: %v", err)
	}
	defer db.Close()
	if _, err := db.Exec(`CREATE TABLE schema_migrations (
		version INTEGER PRIMARY KEY,
		applied_at TEXT NOT NULL
	)`); err != nil {
		t.Fatalf("seed create schema_migrations: %v", err)
	}
	if _, err := db.Exec(`INSERT INTO schema_migrations(version, applied_at) VALUES (?, '2024-01-01T00:00:00Z')`, version); err != nil {
		t.Fatalf("seed insert schema_migrations row: %v", err)
	}
	execLegacyDDL(t, db)
	insertLegacyEvent(t, db)
}

// seedTwoColumnHistoryOnly creates only a legacy two-column schema_migrations
// table recording the given version.
func seedTwoColumnHistoryOnly(t *testing.T, path string, version int) {
	t.Helper()
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatalf("seed sql.Open: %v", err)
	}
	defer db.Close()
	if _, err := db.Exec(`CREATE TABLE schema_migrations (
		version INTEGER PRIMARY KEY,
		applied_at TEXT NOT NULL
	)`); err != nil {
		t.Fatalf("seed create schema_migrations: %v", err)
	}
	if _, err := db.Exec(`INSERT INTO schema_migrations(version, applied_at) VALUES (?, '2024-01-01T00:00:00Z')`, version); err != nil {
		t.Fatalf("seed insert schema_migrations row: %v", err)
	}
}

// seedThreeColumnHistoryOnly creates only a three-column schema_migrations
// table recording the given version.
func seedThreeColumnHistoryOnly(t *testing.T, path string, version int) {
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
	if _, err := db.Exec(`INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, 'future', '2024-01-01T00:00:00Z')`, version); err != nil {
		t.Fatalf("seed insert schema_migrations row: %v", err)
	}
}

// execLegacyDDL creates the v1 events objects without touching
// schema_migrations.
func execLegacyDDL(t *testing.T, db *sql.DB) {
	t.Helper()
	statements := []string{
		`CREATE TABLE IF NOT EXISTS events (
			event_id TEXT PRIMARY KEY,
			job_id TEXT NOT NULL,
			attempt_id TEXT NOT NULL DEFAULT '',
			step_id TEXT NOT NULL DEFAULT '',
			sequence INTEGER NOT NULL,
			kind TEXT NOT NULL,
			occurred_at TEXT NOT NULL,
			payload TEXT NOT NULL CHECK (json_valid(payload)),
			schema_version INTEGER NOT NULL,
			UNIQUE(job_id, sequence)
		)`,
		`CREATE INDEX IF NOT EXISTS events_job_id_sequence ON events(job_id, sequence)`,
		`CREATE TRIGGER IF NOT EXISTS events_append_only_update
			BEFORE UPDATE ON events
			BEGIN SELECT RAISE(ABORT, 'events are append-only'); END`,
		`CREATE TRIGGER IF NOT EXISTS events_append_only_delete
			BEFORE DELETE ON events
			BEGIN SELECT RAISE(ABORT, 'events are append-only'); END`,
	}
	for _, statement := range statements {
		if _, err := db.Exec(statement); err != nil {
			t.Fatalf("seed DDL %q: %v", statement, err)
		}
	}
}

// insertLegacyEvent inserts one event row for job_legacy.
func insertLegacyEvent(t *testing.T, db *sql.DB) {
	t.Helper()
	if _, err := db.Exec(`
		INSERT INTO events(event_id, job_id, attempt_id, step_id, sequence, kind, occurred_at, payload, schema_version)
		VALUES ('evt_legacy', 'job_legacy', '', '', 1, 'job.created', '2024-01-01T00:00:00Z', '{"job_id":"job_legacy"}', 1)
	`); err != nil {
		t.Fatalf("seed legacy event: %v", err)
	}
}

// assertNoSidecarFiles fails if -wal or -shm sidecar files exist for path.
func assertNoSidecarFiles(t *testing.T, path string) {
	t.Helper()
	for _, suffix := range []string{"-wal", "-shm"} {
		if _, err := os.Stat(path + suffix); !os.IsNotExist(err) {
			t.Errorf("sidecar file %s exists after rejected migrate (stat err: %v)", path+suffix, err)
		}
	}
}

// eventStoreFileHash returns the SHA-256 of the database file's contents.
func eventStoreFileHash(t *testing.T, path string) string {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read file %s: %v", path, err)
	}
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

func testJob(id string) Job {
	now := time.Now().UTC()
	return Job{
		ID: id, Title: "M1 contract test", Role: "system.walking-skeleton",
		CollaborationMode: "delegate", Status: JobQueued, CreatedAt: now, UpdatedAt: now,
	}
}
