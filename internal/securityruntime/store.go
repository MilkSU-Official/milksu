package securityruntime

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"

	"github.com/google/uuid"
	_ "modernc.org/sqlite"
)

const eventSchemaVersion = 1

type EventStore struct {
	db *sql.DB
	mu sync.Mutex
}

func OpenEventStore(path string) (*EventStore, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return nil, fmt.Errorf("create event store directory: %w", err)
	}
	file, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return nil, fmt.Errorf("create event store: %w", err)
	}
	if err := file.Close(); err != nil {
		return nil, fmt.Errorf("close event store file: %w", err)
	}
	if err := os.Chmod(path, 0o600); err != nil {
		return nil, fmt.Errorf("tighten event store permissions: %w", err)
	}

	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, fmt.Errorf("open event store: %w", err)
	}
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	store := &EventStore{db: db}
	if err := store.migrate(context.Background()); err != nil {
		db.Close()
		return nil, err
	}
	return store, nil
}

func (s *EventStore) migrate(ctx context.Context) error {
	statements := []string{
		`PRAGMA journal_mode = WAL`,
		`PRAGMA synchronous = FULL`,
		`PRAGMA foreign_keys = ON`,
		`PRAGMA busy_timeout = 5000`,
		`CREATE TABLE IF NOT EXISTS schema_migrations (
			version INTEGER PRIMARY KEY,
			applied_at TEXT NOT NULL
		)`,
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
		`INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`,
	}
	for _, statement := range statements {
		if _, err := s.db.ExecContext(ctx, statement); err != nil {
			return fmt.Errorf("migrate event store: %w", err)
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
