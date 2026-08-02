package securityruntime

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"sort"
	"sync"
	"time"

	"github.com/MilkSU-Official/milksu/internal/sqlitemigrate"
	"github.com/google/uuid"
)

// eventSchemaVersion is the EVENT PAYLOAD schema version, recorded in the
// events.schema_version column and exposed as Event.SchemaVersion. It is
// intentionally independent of SupportedEventStoreDatabaseVersion: it
// describes the shape of event payloads, not the database migration level
// recorded in schema_migrations.
const eventSchemaVersion = 1

// SupportedEventStoreDatabaseVersion is the DATABASE MIGRATION version this
// build supports, recorded in schema_migrations (migration version 1 in
// internal/sqlitemigrate terms). It is intentionally independent of
// eventSchemaVersion.
const SupportedEventStoreDatabaseVersion = 1

type EventStore struct {
	db *sql.DB
	mu sync.Mutex
}

// OpenEventStore opens (creating if necessary) the event store database at
// path and migrates it to the supported schema. The database file is created
// with 0600 permissions inside a 0700 directory, a single connection is used,
// and the connection PRAGMAs run on every open.
func OpenEventStore(path string) (*EventStore, error) {
	migrator, err := sqlitemigrate.Open(path, []sqlitemigrate.Migration{
		{Version: 1, Name: "create events store", Up: v1Up},
	}, sqlitemigrate.WithPragmas([]string{
		"PRAGMA journal_mode = WAL",
		"PRAGMA synchronous = FULL",
		"PRAGMA foreign_keys = ON",
		"PRAGMA busy_timeout = 5000",
	}))
	if err != nil {
		return nil, fmt.Errorf("open event store: %w", err)
	}
	if err := migrator.Migrate(context.Background()); err != nil {
		migrator.Close()
		return nil, fmt.Errorf("migrate event store: %w", err)
	}
	return &EventStore{db: migrator.DB()}, nil
}

// v1Up creates the events table, its job/sequence index, and the append-only
// triggers. It is idempotent (IF NOT EXISTS) so a legacy database that already
// has these objects is upgraded in place.
func v1Up(ctx context.Context, tx *sql.Tx) error {
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
		if _, err := tx.ExecContext(ctx, statement); err != nil {
			return err
		}
	}
	return nil
}

func (s *EventStore) Append(ctx context.Context, draft EventDraft) (Event, error) {
	if err := validateIdentifier("job id", draft.JobID); err != nil {
		return Event{}, err
	}
	if draft.AttemptID != "" {
		if err := validateIdentifier("attempt id", draft.AttemptID); err != nil {
			return Event{}, err
		}
	}
	if draft.StepID != "" {
		if err := validateIdentifier("step id", draft.StepID); err != nil {
			return Event{}, err
		}
	}
	if draft.Kind == "" {
		return Event{}, fmt.Errorf("event kind is required")
	}
	payload, err := json.Marshal(draft.Payload)
	if err != nil {
		return Event{}, fmt.Errorf("encode event payload: %w", err)
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Event{}, fmt.Errorf("begin event append: %w", err)
	}
	defer tx.Rollback()

	var sequence int64
	if err := tx.QueryRowContext(ctx, `SELECT COALESCE(MAX(sequence), 0) + 1 FROM events WHERE job_id = ?`, draft.JobID).Scan(&sequence); err != nil {
		return Event{}, fmt.Errorf("allocate event sequence: %w", err)
	}
	event := Event{
		SchemaVersion: eventSchemaVersion,
		EventID:       newID("evt"),
		JobID:         draft.JobID,
		AttemptID:     draft.AttemptID,
		StepID:        draft.StepID,
		Sequence:      sequence,
		Kind:          draft.Kind,
		OccurredAt:    time.Now().UTC(),
		Payload:       payload,
	}
	existing, err := queryEvents(ctx, tx, draft.JobID)
	if err != nil {
		return Event{}, err
	}
	if _, err := Project(append(existing, event)); err != nil {
		return Event{}, fmt.Errorf("invalid event transition: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO events(event_id, job_id, attempt_id, step_id, sequence, kind, occurred_at, payload, schema_version)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, event.EventID, event.JobID, event.AttemptID, event.StepID, event.Sequence, event.Kind,
		event.OccurredAt.Format(time.RFC3339Nano), string(event.Payload), event.SchemaVersion); err != nil {
		return Event{}, fmt.Errorf("append event: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return Event{}, fmt.Errorf("commit event: %w", err)
	}
	return event, nil
}

func (s *EventStore) Events(ctx context.Context, jobID string) ([]Event, error) {
	if err := validateIdentifier("job id", jobID); err != nil {
		return nil, err
	}
	return queryEvents(ctx, s.db, jobID)
}

type eventQueryer interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}

func queryEvents(ctx context.Context, queryer eventQueryer, jobID string) ([]Event, error) {
	rows, err := queryer.QueryContext(ctx, `
		SELECT event_id, job_id, attempt_id, step_id, sequence, kind, occurred_at, payload, schema_version
		FROM events WHERE job_id = ? ORDER BY sequence
	`, jobID)
	if err != nil {
		return nil, fmt.Errorf("query job events: %w", err)
	}
	defer rows.Close()

	values := make([]Event, 0)
	for rows.Next() {
		var event Event
		var occurredAt string
		var kind string
		var payload string
		if err := rows.Scan(&event.EventID, &event.JobID, &event.AttemptID, &event.StepID,
			&event.Sequence, &kind, &occurredAt, &payload, &event.SchemaVersion); err != nil {
			return nil, fmt.Errorf("scan job event: %w", err)
		}
		parsed, err := time.Parse(time.RFC3339Nano, occurredAt)
		if err != nil {
			return nil, fmt.Errorf("parse event time: %w", err)
		}
		event.Kind = EventKind(kind)
		event.OccurredAt = parsed
		event.Payload = json.RawMessage(payload)
		values = append(values, event)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate job events: %w", err)
	}
	return values, nil
}

func (s *EventStore) Projection(ctx context.Context, jobID string) (JobProjection, error) {
	events, err := s.Events(ctx, jobID)
	if err != nil {
		return JobProjection{}, err
	}
	if len(events) == 0 {
		return JobProjection{}, os.ErrNotExist
	}
	return Project(events)
}

func (s *EventStore) Projections(ctx context.Context) ([]JobProjection, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT DISTINCT job_id FROM events`)
	if err != nil {
		return nil, fmt.Errorf("query job ids: %w", err)
	}
	jobIDs := make([]string, 0)
	for rows.Next() {
		var jobID string
		if err := rows.Scan(&jobID); err != nil {
			rows.Close()
			return nil, fmt.Errorf("scan job id: %w", err)
		}
		jobIDs = append(jobIDs, jobID)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, fmt.Errorf("iterate job ids: %w", err)
	}
	if err := rows.Close(); err != nil {
		return nil, fmt.Errorf("close job id rows: %w", err)
	}

	values := make([]JobProjection, 0, len(jobIDs))
	for _, jobID := range jobIDs {
		projection, err := s.Projection(ctx, jobID)
		if err != nil {
			return nil, err
		}
		values = append(values, projection)
	}
	sort.Slice(values, func(i, j int) bool {
		return values[i].Job.UpdatedAt.After(values[j].Job.UpdatedAt)
	})
	return values, nil
}

func (s *EventStore) Close() error {
	if s == nil || s.db == nil {
		return nil
	}
	return s.db.Close()
}

func newID(prefix string) string {
	return prefix + "_" + uuid.NewString()
}
