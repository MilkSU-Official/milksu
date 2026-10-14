package research

import (
	"context"
	"database/sql"
	"encoding/hex"
	"fmt"
	"net/url"
	"path"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/MilkSU-Official/milksu/internal/securityruntime"
	"github.com/MilkSU-Official/milksu/internal/sqlitemigrate"
	"github.com/google/uuid"
)

const (
	SupportedDatabaseVersion = 4
	maxSourceBytes           = 16 * 1024
	researchV1MigrationName  = "create research store"
	researchV2MigrationName  = "track unconfirmed worker stops"
	researchV3MigrationName  = "track research worker launching state"
	researchV4MigrationName  = "record research run trace id"
	researchTimeLayout       = "2006-01-02T15:04:05.000000000Z07:00"
)

var researchRunIDPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_.:-]{0,191}$`)
var researchTraceIDPattern = regexp.MustCompile(`(?i)^trc_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)
var researchTextURLPattern = regexp.MustCompile("(?i)https?://[^\\s<>\"'`]+")
var researchTextQueryPattern = regexp.MustCompile(`(?i)([?&;])([^=&#;\s]+)=([^&#;\s]*)`)
var researchTextURLAuthPattern = regexp.MustCompile(`(?i)(https?://[^/:?#\s]+:)[^@/?#\s]*@`)

type Store struct {
	db        *sql.DB
	artifacts *securityruntime.ArtifactStore
}

func OpenStore(dataDirectory string) (*Store, error) {
	if strings.TrimSpace(dataDirectory) == "" {
		return nil, fmt.Errorf("research data directory is required")
	}
	// 状态根布局（#188）：domain 数据统一在 data/domain/<域>/ 下，research 与 ctf 同列。
	researchDirectory := filepath.Join(dataDirectory, "domain", "research")
	databasePath := filepath.Join(researchDirectory, "research.sqlite3")
	migrator, err := sqlitemigrate.Open(databasePath, []sqlitemigrate.Migration{
		{
			Version: 1,
			Name:    researchV1MigrationName,
			Up:      researchV1Up,
		},
		{
			Version: 2,
			Name:    researchV2MigrationName,
			Up:      researchV2Up,
		},
		{
			Version: 3,
			Name:    researchV3MigrationName,
			Up:      researchV3Up,
		},
		{
			Version: 4,
			Name:    researchV4MigrationName,
			Up:      researchV4Up,
		},
	}, sqlitemigrate.WithPragmas([]string{
		"PRAGMA journal_mode = WAL",
		"PRAGMA synchronous = FULL",
		"PRAGMA foreign_keys = ON",
		"PRAGMA busy_timeout = 5000",
	}))
	if err != nil {
		return nil, fmt.Errorf("open research database: %w", err)
	}
	if err := migrator.Migrate(context.Background()); err != nil {
		_ = migrator.Close()
		return nil, fmt.Errorf("migrate research database: %w", err)
	}
	artifacts, err := securityruntime.NewArtifactStore(filepath.Join(researchDirectory, "artifacts"))
	if err != nil {
		_ = migrator.Close()
		return nil, fmt.Errorf("open research artifact store: %w", err)
	}
	return &Store{db: migrator.DB(), artifacts: artifacts}, nil
}

func researchV1Up(ctx context.Context, tx *sql.Tx) error {
	statements := []string{
		`CREATE TABLE IF NOT EXISTS research_runs (
			id TEXT PRIMARY KEY,
			conversation_id TEXT NOT NULL,
			query TEXT NOT NULL,
			status TEXT NOT NULL CHECK(status IN ('running', 'completed', 'failed', 'cancelled', 'interrupted')),
			phase TEXT NOT NULL CHECK(phase IN (
				'collecting', 'waiting', 'synthesis_pending', 'synthesizing',
				'gap_fill_collecting', 'gap_fill_waiting', 'final_synthesis_pending', 'finalizing'
			)),
			report TEXT NOT NULL DEFAULT '',
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS research_runs_conversation_updated
			ON research_runs(conversation_id, updated_at DESC, id)`,
		`CREATE TABLE IF NOT EXISTS research_tasks (
			id TEXT NOT NULL,
			run_id TEXT NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,
			prompt TEXT NOT NULL,
			status TEXT NOT NULL CHECK(status IN ('running', 'completed', 'failed', 'cancelled', 'interrupted')),
			worker_id TEXT NOT NULL,
			batch INTEGER NOT NULL,
			result TEXT NOT NULL DEFAULT '',
			PRIMARY KEY(run_id, id)
		)`,
		`CREATE INDEX IF NOT EXISTS research_tasks_run_batch
			ON research_tasks(run_id, batch, id)`,
		`CREATE TABLE IF NOT EXISTS research_sources (
			id TEXT PRIMARY KEY,
			run_id TEXT NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,
			url TEXT NOT NULL,
			title TEXT NOT NULL,
			retrieved_at TEXT NOT NULL,
			artifact_ref TEXT NOT NULL CHECK(
				length(artifact_ref) = 64 AND artifact_ref NOT GLOB '*[^0-9a-f]*'
			),
			UNIQUE(run_id, id)
		)`,
		`CREATE INDEX IF NOT EXISTS research_sources_run_retrieved
			ON research_sources(run_id, retrieved_at, id)`,
		`CREATE TABLE IF NOT EXISTS research_citations (
			citation_id INTEGER PRIMARY KEY AUTOINCREMENT,
			run_id TEXT NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,
			claim TEXT NOT NULL,
			source_id TEXT NOT NULL,
			verdict TEXT NOT NULL CHECK(verdict IN ('supported', 'unsupported')),
			reason TEXT NOT NULL DEFAULT '',
			FOREIGN KEY(run_id, source_id) REFERENCES research_sources(run_id, id) ON DELETE CASCADE
		)`,
		`CREATE INDEX IF NOT EXISTS research_citations_run
			ON research_citations(run_id, citation_id)`,
	}
	for _, statement := range statements {
		if _, err := tx.ExecContext(ctx, statement); err != nil {
			return fmt.Errorf("create research schema: %w", err)
		}
	}
	return nil
}

func researchV2Up(ctx context.Context, tx *sql.Tx) error {
	rows, err := tx.QueryContext(ctx, `PRAGMA table_info(research_runs)`)
	if err != nil {
		return fmt.Errorf("inspect research run schema: %w", err)
	}
	defer rows.Close()
	columnExists := false
	for rows.Next() {
		var ordinal, notNull, primaryKey int
		var name, columnType string
		var defaultValue sql.NullString
		if err := rows.Scan(&ordinal, &name, &columnType, &notNull, &defaultValue, &primaryKey); err != nil {
			return fmt.Errorf("inspect research run schema: %w", err)
		}
		if name == "worker_stop_unconfirmed" {
			columnExists = true
		}
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("inspect research run schema: %w", err)
	}
	if err := rows.Close(); err != nil {
		return fmt.Errorf("close research run schema inspection: %w", err)
	}
	if columnExists {
		return nil
	}
	if _, err := tx.ExecContext(ctx, `ALTER TABLE research_runs
		ADD COLUMN worker_stop_unconfirmed INTEGER NOT NULL DEFAULT 0
		CHECK(worker_stop_unconfirmed IN (0, 1))`); err != nil {
		return fmt.Errorf("add research worker stop state: %w", err)
	}
	return nil
}

// researchV3Up widens the research task status check with the "launching"
// state so a registered task is not persisted as running before a concrete
// worker identity exists. SQLite cannot alter a CHECK constraint in place, so
// the table is rebuilt with the same shape and data.
func researchV3Up(ctx context.Context, tx *sql.Tx) error {
	statements := []string{
		`CREATE TABLE research_tasks_v3 (
			id TEXT NOT NULL,
			run_id TEXT NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,
			prompt TEXT NOT NULL,
			status TEXT NOT NULL CHECK(status IN ('launching', 'running', 'completed', 'failed', 'cancelled', 'interrupted')),
			worker_id TEXT NOT NULL,
			batch INTEGER NOT NULL,
			result TEXT NOT NULL DEFAULT '',
			PRIMARY KEY(run_id, id)
		)`,
		`INSERT INTO research_tasks_v3 (id, run_id, prompt, status, worker_id, batch, result)
			SELECT id, run_id, prompt, status, worker_id, batch, result FROM research_tasks`,
		`DROP TABLE research_tasks`,
		`ALTER TABLE research_tasks_v3 RENAME TO research_tasks`,
		`CREATE INDEX IF NOT EXISTS research_tasks_run_batch
			ON research_tasks(run_id, batch, id)`,
	}
	for _, statement := range statements {
		if _, err := tx.ExecContext(ctx, statement); err != nil {
			return fmt.Errorf("track research worker launching state: %w", err)
		}
	}
	return nil
}

// researchV4Up 给 research_runs 加上 trace_id。旧行保持空字符串。
func researchV4Up(ctx context.Context, tx *sql.Tx) error {
	rows, err := tx.QueryContext(ctx, `PRAGMA table_info(research_runs)`)
	if err != nil {
		return fmt.Errorf("inspect research run schema: %w", err)
	}
	defer rows.Close()
	columnExists := false
	for rows.Next() {
		var ordinal, notNull, primaryKey int
		var name, columnType string
		var defaultValue sql.NullString
		if err := rows.Scan(&ordinal, &name, &columnType, &notNull, &defaultValue, &primaryKey); err != nil {
			return fmt.Errorf("inspect research run schema: %w", err)
		}
		if name == "trace_id" {
			columnExists = true
		}
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("inspect research run schema: %w", err)
	}
	if err := rows.Close(); err != nil {
		return fmt.Errorf("close research run schema inspection: %w", err)
	}
	if columnExists {
		return nil
	}
	if _, err := tx.ExecContext(ctx, `ALTER TABLE research_runs
		ADD COLUMN trace_id TEXT NOT NULL DEFAULT ''`); err != nil {
		return fmt.Errorf("add research run trace id: %w", err)
	}
	return nil
}

func (s *Store) Close() error {
	if s == nil || s.db == nil {
		return nil
	}
	return s.db.Close()
}

func (s *Store) DeleteConversation(ctx context.Context, conversationID string) error {
	conversationID = strings.TrimSpace(conversationID)
	if conversationID == "" {
		return fmt.Errorf("conversation id is required")
	}
	rows, err := s.db.QueryContext(ctx, `SELECT id FROM research_runs WHERE conversation_id = ?`, conversationID)
	if err != nil {
		return fmt.Errorf("list research runs for deletion: %w", err)
	}
	var runIDs []string
	for rows.Next() {
		var runID string
		if err := rows.Scan(&runID); err != nil {
			rows.Close()
			return fmt.Errorf("read research run for deletion: %w", err)
		}
		runIDs = append(runIDs, runID)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return fmt.Errorf("read research runs for deletion: %w", err)
	}
	if err := rows.Close(); err != nil {
		return fmt.Errorf("close research run list: %w", err)
	}
	for _, runID := range runIDs {
		if err := s.artifacts.RemoveJob(ctx, runID); err != nil {
			return fmt.Errorf("remove research run artifacts: %w", err)
		}
	}
	if _, err := s.db.ExecContext(ctx, `DELETE FROM research_runs WHERE conversation_id = ?`, conversationID); err != nil {
		return fmt.Errorf("delete research runs: %w", err)
	}
	return nil
}

func (s *Store) CreateRun(ctx context.Context, run Run) error {
	run, err := normalizeRun(run, true)
	if err != nil {
		return err
	}
	_, err = s.db.ExecContext(ctx, `INSERT INTO research_runs (
		id, conversation_id, query, status, phase, report, created_at, updated_at, trace_id
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		run.ID,
		run.ConversationID,
		run.Query,
		run.Status,
		run.Phase,
		run.Report,
		formatResearchTime(run.CreatedAt),
		formatResearchTime(run.UpdatedAt),
		run.TraceID,
	)
	if err != nil {
		return fmt.Errorf("create research run: %w", err)
	}
	return nil
}

func (s *Store) GetRun(ctx context.Context, runID string) (Run, error) {
	run, err := scanRun(s.db.QueryRowContext(ctx,
		`SELECT `+researchRunColumns+` FROM research_runs WHERE id = ?`, strings.TrimSpace(runID),
	))
	if err != nil {
		return Run{}, fmt.Errorf("get research run: %w", err)
	}
	return run, nil
}

func (s *Store) FindActiveRun(ctx context.Context, conversationID string) (Run, error) {
	conversationID = strings.TrimSpace(conversationID)
	if conversationID == "" {
		return Run{}, fmt.Errorf("research conversation id is required")
	}
	run, err := scanRun(s.db.QueryRowContext(ctx,
		`SELECT `+researchRunColumns+`
		 FROM research_runs
		 WHERE conversation_id = ? AND status = ?
		 ORDER BY updated_at DESC, created_at DESC, id
		 LIMIT 1`, conversationID, RunRunning,
	))
	if err != nil {
		return Run{}, fmt.Errorf("find active research run: %w", err)
	}
	return run, nil
}

func (s *Store) FindUnconfirmedWorkerStop(ctx context.Context, conversationID string) (Run, error) {
	conversationID = strings.TrimSpace(conversationID)
	if conversationID == "" {
		return Run{}, fmt.Errorf("research conversation id is required")
	}
	run, err := scanRun(s.db.QueryRowContext(ctx,
		`SELECT `+researchRunColumns+`
		 FROM research_runs
		 WHERE conversation_id = ? AND status = ? AND worker_stop_unconfirmed = 1
		 ORDER BY updated_at DESC, created_at DESC, id
		 LIMIT 1`, conversationID, RunCancelled,
	))
	if err != nil {
		return Run{}, fmt.Errorf("find unconfirmed research worker stop: %w", err)
	}
	return run, nil
}

func (s *Store) ListRuns(ctx context.Context, conversationID string, limit int) ([]Run, error) {
	conversationID = strings.TrimSpace(conversationID)
	if conversationID == "" {
		return nil, fmt.Errorf("research conversation id is required")
	}
	if limit <= 0 {
		return []Run{}, nil
	}
	rows, err := s.db.QueryContext(ctx,
		`SELECT `+researchRunColumns+`
		 FROM research_runs
		 WHERE conversation_id = ?
		 ORDER BY updated_at DESC, created_at DESC, id
		 LIMIT ?`, conversationID, limit,
	)
	if err != nil {
		return nil, fmt.Errorf("list research runs: %w", err)
	}
	defer rows.Close()
	runs := make([]Run, 0)
	for rows.Next() {
		run, err := scanRun(rows)
		if err != nil {
			return nil, fmt.Errorf("scan research run: %w", err)
		}
		runs = append(runs, run)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate research runs: %w", err)
	}
	return runs, nil
}

func (s *Store) UpdateRun(ctx context.Context, run Run) error {
	run, err := normalizeRun(run, false)
	if err != nil {
		return err
	}
	result, err := s.db.ExecContext(ctx, `UPDATE research_runs
		SET conversation_id = ?, query = ?, status = ?, phase = ?, report = ?, updated_at = ?
		WHERE id = ?`,
		run.ConversationID,
		run.Query,
		run.Status,
		run.Phase,
		run.Report,
		formatResearchTime(run.UpdatedAt),
		run.ID,
	)
	if err != nil {
		return fmt.Errorf("update research run: %w", err)
	}
	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("check updated research run: %w", err)
	}
	if rowsAffected == 0 {
		return fmt.Errorf("update research run: %w", sql.ErrNoRows)
	}
	return nil
}

func (s *Store) SetWorkerStopUnconfirmed(
	ctx context.Context,
	conversationID,
	runID string,
	unconfirmed bool,
) error {
	result, err := s.db.ExecContext(ctx, `UPDATE research_runs
		SET worker_stop_unconfirmed = ?
		WHERE id = ? AND conversation_id = ? AND status = ?`,
		unconfirmed,
		strings.TrimSpace(runID),
		strings.TrimSpace(conversationID),
		RunCancelled,
	)
	if err != nil {
		return fmt.Errorf("update research worker stop state: %w", err)
	}
	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("check research worker stop state: %w", err)
	}
	if rowsAffected == 0 {
		return fmt.Errorf("update research worker stop state: %w", sql.ErrNoRows)
	}
	return nil
}

func (s *Store) UpsertTask(ctx context.Context, task Task) error {
	task, err := normalizeTask(task)
	if err != nil {
		return err
	}
	return upsertTask(ctx, s.db, task)
}

func (s *Store) UpsertTasksAndRun(ctx context.Context, tasks []Task, run Run) error {
	run, err := normalizeRun(run, false)
	if err != nil {
		return err
	}
	for index := range tasks {
		tasks[index], err = normalizeTask(tasks[index])
		if err != nil {
			return err
		}
		if tasks[index].RunID != run.ID {
			return fmt.Errorf("research task belongs to a different run")
		}
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin research worker update transaction: %w", err)
	}
	defer tx.Rollback()
	for _, task := range tasks {
		if err := upsertTask(ctx, tx, task); err != nil {
			return err
		}
	}
	result, err := tx.ExecContext(ctx, `UPDATE research_runs
		SET conversation_id = ?, query = ?, status = ?, phase = ?, report = ?, updated_at = ?
		WHERE id = ?`,
		run.ConversationID,
		run.Query,
		run.Status,
		run.Phase,
		run.Report,
		formatResearchTime(run.UpdatedAt),
		run.ID,
	)
	if err != nil {
		return fmt.Errorf("update research run with worker batch: %w", err)
	}
	if rows, err := result.RowsAffected(); err != nil {
		return fmt.Errorf("check research worker batch run: %w", err)
	} else if rows == 0 {
		return fmt.Errorf("update research worker batch run: %w", sql.ErrNoRows)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit research worker update: %w", err)
	}
	return nil
}

type researchTaskExecer interface {
	ExecContext(context.Context, string, ...any) (sql.Result, error)
}

func normalizeTask(task Task) (Task, error) {
	task.ID = strings.TrimSpace(task.ID)
	task.RunID = strings.TrimSpace(task.RunID)
	task.Prompt = sanitizeResearchText(task.Prompt)
	task.Result = sanitizeResearchText(task.Result)
	if task.ID == "" || task.RunID == "" {
		return Task{}, fmt.Errorf("research task id and run id are required")
	}
	if !validTaskStatus(task.Status) {
		return Task{}, fmt.Errorf("unsupported research task status %q", task.Status)
	}
	return task, nil
}

func upsertTask(ctx context.Context, executor researchTaskExecer, task Task) error {
	_, err := executor.ExecContext(ctx, `INSERT INTO research_tasks (
		id, run_id, prompt, status, worker_id, batch, result
	) VALUES (?, ?, ?, ?, ?, ?, ?)
	ON CONFLICT(run_id, id) DO UPDATE SET
		prompt = excluded.prompt,
		status = excluded.status,
		worker_id = excluded.worker_id,
		batch = excluded.batch,
		result = excluded.result`,
		task.ID, task.RunID, task.Prompt, task.Status, task.WorkerID, task.Batch, task.Result,
	)
	if err != nil {
		return fmt.Errorf("upsert research task: %w", err)
	}
	return nil
}

func (s *Store) ListTasks(ctx context.Context, runID string) ([]Task, error) {
	runID = strings.TrimSpace(runID)
	if runID == "" {
		return nil, fmt.Errorf("research run id is required")
	}
	rows, err := s.db.QueryContext(ctx, `SELECT id, run_id, prompt, status, worker_id, batch, result
		FROM research_tasks WHERE run_id = ? ORDER BY batch, id`, runID)
	if err != nil {
		return nil, fmt.Errorf("list research tasks: %w", err)
	}
	defer rows.Close()
	tasks := make([]Task, 0)
	for rows.Next() {
		var task Task
		if err := rows.Scan(
			&task.ID,
			&task.RunID,
			&task.Prompt,
			&task.Status,
			&task.WorkerID,
			&task.Batch,
			&task.Result,
		); err != nil {
			return nil, fmt.Errorf("scan research task: %w", err)
		}
		tasks = append(tasks, task)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate research tasks: %w", err)
	}
	return tasks, nil
}

func (s *Store) AddSource(
	ctx context.Context,
	runID, url, title string,
	retrievedAt time.Time,
	data []byte,
) (Source, error) {
	runID = strings.TrimSpace(runID)
	title = strings.TrimSpace(sanitizeResearchText(title))
	data = []byte(sanitizeResearchText(string(data)))
	if !researchRunIDPattern.MatchString(runID) {
		return Source{}, fmt.Errorf("invalid research run id")
	}
	if len(data) == 0 || len(data) > maxSourceBytes {
		return Source{}, fmt.Errorf("research source content must be between 1 and %d bytes", maxSourceBytes)
	}
	safeURL, err := sanitizeSourceURL(url)
	if err != nil {
		return Source{}, err
	}
	if retrievedAt.IsZero() {
		retrievedAt = time.Now().UTC()
	} else {
		retrievedAt = retrievedAt.UTC()
	}
	sourceID := "source_" + uuid.NewString()

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Source{}, fmt.Errorf("begin research source transaction: %w", err)
	}
	defer tx.Rollback()
	var exists int
	if err := tx.QueryRowContext(ctx,
		`SELECT 1 FROM research_runs WHERE id = ?`, runID,
	).Scan(&exists); err != nil {
		return Source{}, fmt.Errorf("check research source run: %w", err)
	}
	artifact, _, err := s.artifacts.Admit(ctx, runID, "research-source:"+sourceID, "text/plain", data)
	if err != nil {
		return Source{}, fmt.Errorf("store research source artifact: %w", err)
	}
	source := Source{
		ID:          sourceID,
		RunID:       runID,
		URL:         safeURL,
		Title:       strings.TrimSpace(title),
		RetrievedAt: retrievedAt,
		ArtifactRef: artifact.SHA256,
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO research_sources (
		id, run_id, url, title, retrieved_at, artifact_ref
	) VALUES (?, ?, ?, ?, ?, ?)`,
		source.ID,
		source.RunID,
		source.URL,
		source.Title,
		formatResearchTime(source.RetrievedAt),
		source.ArtifactRef,
	)
	if err != nil {
		return Source{}, fmt.Errorf("record research source: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return Source{}, fmt.Errorf("commit research source: %w", err)
	}
	return source, nil
}

func (s *Store) ListSources(ctx context.Context, runID string) ([]Source, error) {
	runID = strings.TrimSpace(runID)
	if runID == "" {
		return nil, fmt.Errorf("research run id is required")
	}
	rows, err := s.db.QueryContext(ctx, `SELECT id, run_id, url, title, retrieved_at, artifact_ref
		FROM research_sources WHERE run_id = ? ORDER BY retrieved_at, id`, runID)
	if err != nil {
		return nil, fmt.Errorf("list research sources: %w", err)
	}
	defer rows.Close()
	sources := make([]Source, 0)
	for rows.Next() {
		source, err := scanSource(rows)
		if err != nil {
			return nil, fmt.Errorf("scan research source: %w", err)
		}
		sources = append(sources, source)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate research sources: %w", err)
	}
	return sources, nil
}

func (s *Store) ReadSource(ctx context.Context, sourceID string) (Source, []byte, error) {
	source, err := scanSource(s.db.QueryRowContext(ctx,
		`SELECT id, run_id, url, title, retrieved_at, artifact_ref
		 FROM research_sources WHERE id = ?`, strings.TrimSpace(sourceID),
	))
	if err != nil {
		return Source{}, nil, fmt.Errorf("read research source metadata: %w", err)
	}
	if digest, err := hex.DecodeString(source.ArtifactRef); err != nil || len(digest) != 32 {
		return Source{}, nil, fmt.Errorf("read research source: invalid artifact digest")
	}
	artifact := securityruntime.Artifact{
		ID:           source.ID,
		JobID:        source.RunID,
		SHA256:       source.ArtifactRef,
		MediaType:    "text/plain",
		RelativePath: path.Join(source.RunID, source.ArtifactRef),
	}
	data, err := s.artifacts.Read(ctx, artifact)
	if err != nil {
		return Source{}, nil, fmt.Errorf("read research source artifact: %w", err)
	}
	return source, data, nil
}

func (s *Store) AddCitation(ctx context.Context, citation Citation) error {
	validated, err := NewCitation(
		citation.RunID,
		citation.Claim,
		citation.SourceID,
		citation.Verdict,
		citation.Reason,
	)
	if err != nil {
		return fmt.Errorf("validate research citation: %w", err)
	}
	_, err = s.db.ExecContext(ctx, `INSERT INTO research_citations (
		run_id, claim, source_id, verdict, reason
	) VALUES (?, ?, ?, ?, ?)`,
		validated.RunID, validated.Claim, validated.SourceID, validated.Verdict, validated.Reason,
	)
	if err != nil {
		return fmt.Errorf("add research citation: %w", err)
	}
	return nil
}

func (s *Store) ListCitations(ctx context.Context, runID string) ([]Citation, error) {
	runID = strings.TrimSpace(runID)
	if runID == "" {
		return nil, fmt.Errorf("research run id is required")
	}
	rows, err := s.db.QueryContext(ctx, `SELECT run_id, claim, source_id, verdict, reason
		FROM research_citations WHERE run_id = ? ORDER BY citation_id`, runID)
	if err != nil {
		return nil, fmt.Errorf("list research citations: %w", err)
	}
	defer rows.Close()
	citations := make([]Citation, 0)
	for rows.Next() {
		var citation Citation
		if err := rows.Scan(
			&citation.RunID,
			&citation.Claim,
			&citation.SourceID,
			&citation.Verdict,
			&citation.Reason,
		); err != nil {
			return nil, fmt.Errorf("scan research citation: %w", err)
		}
		citations = append(citations, citation)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate research citations: %w", err)
	}
	return citations, nil
}

func (s *Store) InterruptRunning(ctx context.Context) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin research interruption transaction: %w", err)
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `UPDATE research_tasks
		SET status = ?
		WHERE status IN (?, ?) AND run_id IN (
			SELECT id FROM research_runs WHERE status = ?
		)`, TaskInterrupted, TaskRunning, TaskLaunching, RunRunning); err != nil {
		return fmt.Errorf("interrupt running research tasks: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `UPDATE research_runs
		SET status = ?, updated_at = ?
		WHERE status = ?`, RunInterrupted, formatResearchTime(time.Now()), RunRunning); err != nil {
		return fmt.Errorf("interrupt running research runs: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit research interruption: %w", err)
	}
	return nil
}

func (s *Store) CancelRun(ctx context.Context, run Run) error {
	run, err := normalizeRun(run, false)
	if err != nil {
		return err
	}
	if run.Status != RunCancelled {
		return fmt.Errorf("research run cancellation status is required")
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin research cancellation transaction: %w", err)
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `UPDATE research_tasks SET status = ?
		WHERE run_id = ? AND status IN (?, ?, ?)`, TaskCancelled, run.ID, TaskRunning, TaskLaunching, TaskInterrupted); err != nil {
		return fmt.Errorf("cancel research tasks: %w", err)
	}
	result, err := tx.ExecContext(ctx, `UPDATE research_runs
		SET conversation_id = ?, query = ?, status = ?, phase = ?, report = ?, updated_at = ?
		WHERE id = ? AND status IN (?, ?)`,
		run.ConversationID,
		run.Query,
		run.Status,
		run.Phase,
		run.Report,
		formatResearchTime(run.UpdatedAt),
		run.ID,
		RunRunning,
		RunInterrupted,
	)
	if err != nil {
		return fmt.Errorf("cancel research run: %w", err)
	}
	if rows, err := result.RowsAffected(); err != nil {
		return fmt.Errorf("check cancelled research run: %w", err)
	} else if rows == 0 {
		return fmt.Errorf("cancel research run: %w", sql.ErrNoRows)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit research cancellation: %w", err)
	}
	return nil
}

func (s *Store) InterruptRun(ctx context.Context, run Run) error {
	run, err := normalizeRun(run, false)
	if err != nil {
		return err
	}
	if run.Status != RunInterrupted {
		return fmt.Errorf("research run interruption status is required")
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin research interruption transaction: %w", err)
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `UPDATE research_tasks SET status = ?
		WHERE run_id = ? AND status IN (?, ?)`, TaskInterrupted, run.ID, TaskRunning, TaskLaunching); err != nil {
		return fmt.Errorf("interrupt research tasks: %w", err)
	}
	result, err := tx.ExecContext(ctx, `UPDATE research_runs
		SET conversation_id = ?, query = ?, status = ?, phase = ?, report = ?, updated_at = ?
		WHERE id = ? AND status = ?`,
		run.ConversationID,
		run.Query,
		run.Status,
		run.Phase,
		run.Report,
		formatResearchTime(run.UpdatedAt),
		run.ID,
		RunRunning,
	)
	if err != nil {
		return fmt.Errorf("interrupt research run: %w", err)
	}
	if rows, err := result.RowsAffected(); err != nil {
		return fmt.Errorf("check interrupted research run: %w", err)
	} else if rows == 0 {
		return fmt.Errorf("interrupt research run: %w", sql.ErrNoRows)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit research interruption: %w", err)
	}
	return nil
}

const researchRunColumns = `id, conversation_id, query, status, phase, report, created_at, updated_at, worker_stop_unconfirmed, trace_id`

type researchRowScanner interface {
	Scan(dest ...any) error
}

func scanRun(row researchRowScanner) (Run, error) {
	var run Run
	var createdAt, updatedAt string
	var workerStopUnconfirmed int
	if err := row.Scan(
		&run.ID,
		&run.ConversationID,
		&run.Query,
		&run.Status,
		&run.Phase,
		&run.Report,
		&createdAt,
		&updatedAt,
		&workerStopUnconfirmed,
		&run.TraceID,
	); err != nil {
		return Run{}, err
	}
	run.WorkerStopUnconfirmed = workerStopUnconfirmed != 0
	run.TraceID = normalizeResearchTraceID(run.TraceID)
	var err error
	if run.CreatedAt, err = parseResearchTime(createdAt); err != nil {
		return Run{}, fmt.Errorf("parse research run creation time: %w", err)
	}
	if run.UpdatedAt, err = parseResearchTime(updatedAt); err != nil {
		return Run{}, fmt.Errorf("parse research run update time: %w", err)
	}
	return run, nil
}

func scanSource(row researchRowScanner) (Source, error) {
	var source Source
	var retrievedAt string
	if err := row.Scan(
		&source.ID,
		&source.RunID,
		&source.URL,
		&source.Title,
		&retrievedAt,
		&source.ArtifactRef,
	); err != nil {
		return Source{}, err
	}
	var err error
	if source.RetrievedAt, err = parseResearchTime(retrievedAt); err != nil {
		return Source{}, fmt.Errorf("parse research source retrieval time: %w", err)
	}
	return source, nil
}

func normalizeRun(run Run, creating bool) (Run, error) {
	run.ID = strings.TrimSpace(run.ID)
	run.ConversationID = strings.TrimSpace(run.ConversationID)
	run.Query = strings.TrimSpace(sanitizeResearchText(run.Query))
	run.Status = strings.TrimSpace(run.Status)
	run.Phase = strings.TrimSpace(run.Phase)
	run.Report = sanitizeResearchText(run.Report)
	run.TraceID = normalizeResearchTraceID(run.TraceID)
	if !researchRunIDPattern.MatchString(run.ID) {
		return Run{}, fmt.Errorf("invalid research run id")
	}
	if run.ConversationID == "" || run.Query == "" {
		return Run{}, fmt.Errorf("research conversation id and query are required")
	}
	if !validRunStatus(run.Status) {
		return Run{}, fmt.Errorf("unsupported research run status %q", run.Status)
	}
	if !validRunPhase(run.Phase) {
		return Run{}, fmt.Errorf("unsupported research run phase %q", run.Phase)
	}
	if creating && run.CreatedAt.IsZero() {
		run.CreatedAt = time.Now().UTC()
	}
	if run.UpdatedAt.IsZero() {
		if creating {
			run.UpdatedAt = run.CreatedAt
		} else {
			run.UpdatedAt = time.Now().UTC()
		}
	}
	if !run.CreatedAt.IsZero() {
		run.CreatedAt = run.CreatedAt.UTC()
	}
	run.UpdatedAt = run.UpdatedAt.UTC()
	return run, nil
}

func validRunStatus(status string) bool {
	switch status {
	case RunRunning, RunCompleted, RunFailed, RunCancelled, RunInterrupted:
		return true
	default:
		return false
	}
}

func validTaskStatus(status string) bool {
	switch status {
	case TaskLaunching, TaskRunning, TaskCompleted, TaskFailed, TaskCancelled, TaskInterrupted:
		return true
	default:
		return false
	}
}

func validRunPhase(phase string) bool {
	switch phase {
	case PhaseCollecting,
		PhaseWaiting,
		PhaseSynthesisPending,
		PhaseSynthesizing,
		PhaseGapFillCollecting,
		PhaseGapFillWaiting,
		PhaseFinalSynthesisPending,
		PhaseFinalizing:
		return true
	default:
		return false
	}
}

func normalizeResearchTraceID(value string) string {
	value = strings.TrimSpace(value)
	if researchTraceIDPattern.MatchString(value) {
		return value
	}
	return ""
}

func newResearchTraceID() string {
	return "trc_" + uuid.NewString()
}

func formatResearchTime(value time.Time) string {
	return value.UTC().Format(researchTimeLayout)
}

func parseResearchTime(value string) (time.Time, error) {
	return time.Parse(time.RFC3339Nano, value)
}

func sanitizeSourceURL(value string) (string, error) {
	parsed, err := url.Parse(strings.TrimSpace(value))
	if err != nil {
		return "", fmt.Errorf("invalid research source URL: %w", err)
	}
	parsed.Scheme = strings.ToLower(parsed.Scheme)
	if (parsed.Scheme != "http" && parsed.Scheme != "https") ||
		parsed.Opaque != "" || parsed.Host == "" || parsed.Hostname() == "" {
		return "", fmt.Errorf("research source URL must be absolute HTTP(S)")
	}
	parsed.User = nil
	parsed.Fragment = ""
	parsed.RawFragment = ""
	query, err := url.ParseQuery(parsed.RawQuery)
	if err != nil {
		return "", fmt.Errorf("invalid research source URL query: %w", err)
	}
	for key := range query {
		if sensitiveSourceQueryKey(key) {
			query.Del(key)
		}
	}
	parsed.RawQuery = query.Encode()
	if parsed.RawQuery == "" {
		parsed.ForceQuery = false
	}
	return parsed.String(), nil
}

func sensitiveSourceQueryKey(key string) bool {
	normalized := strings.NewReplacer("-", "", "_", "", ".", "").Replace(strings.ToLower(key))
	for _, sensitive := range []string{
		"apikey", "token", "secret", "password", "passwd", "auth", "credential", "signature", "accesskeyid",
	} {
		if strings.Contains(normalized, sensitive) {
			return true
		}
	}
	return normalized == "key" || strings.HasSuffix(normalized, "key") || normalized == "sig"
}

func sanitizeResearchText(value string) string {
	return researchTextURLPattern.ReplaceAllStringFunc(value, func(candidate string) string {
		end := len(candidate)
		for end > 0 && strings.ContainsRune(".,;:!?)]}", rune(candidate[end-1])) {
			end--
		}
		urlText, suffix := candidate[:end], candidate[end:]
		if urlText == "" {
			return candidate
		}
		if sanitized, err := sanitizeSourceURL(urlText); err == nil {
			return sanitized + suffix
		}
		return researchTextURLAuthPattern.ReplaceAllString(
			researchTextQueryPattern.ReplaceAllStringFunc(urlText, func(parameter string) string {
				match := researchTextQueryPattern.FindStringSubmatch(parameter)
				if len(match) != 4 {
					return parameter
				}
				key, err := url.QueryUnescape(match[2])
				if err != nil || !sensitiveSourceQueryKey(key) {
					return parameter
				}
				return match[1] + match[2] + "=[REDACTED]"
			}), "$1[REDACTED]@",
		) + suffix
	})
}
