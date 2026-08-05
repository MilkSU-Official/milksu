package ctfshow

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/MilkSU-Official/milksu/internal/sqlitemigrate"
)

const (
	maxCatalogProblems = 10_000

	// SupportedCTFshowCatalogDatabaseVersion is the numbered SQLite migration
	// version recorded in schema_migrations for the local CTFshow catalog.
	SupportedCTFshowCatalogDatabaseVersion = 1

	ctfshowCatalogV1MigrationName = "create CTFshow catalog"
)

type CatalogProblem struct {
	PlatformID  int      `json:"platformId"`
	SourceURL   string   `json:"sourceUrl"`
	Title       string   `json:"title"`
	Category    string   `json:"category"`
	Points      int      `json:"points"`
	SolvedCount int      `json:"solvedCount"`
	Tags        []string `json:"tags"`
	SyncedAt    string   `json:"syncedAt"`
}

type CatalogSnapshot struct {
	Total        int              `json:"total"`
	LastSyncedAt string           `json:"lastSyncedAt"`
	Problems     []CatalogProblem `json:"problems"`
}

type CatalogService struct {
	db   *sql.DB
	path string
}

func NewCatalogService(path string) (*CatalogService, error) {
	directory := filepath.Dir(path)
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return nil, fmt.Errorf("create CTFshow catalog directory: %w", err)
	}
	if err := os.Chmod(directory, 0o700); err != nil {
		return nil, fmt.Errorf("secure CTFshow catalog directory: %w", err)
	}
	migrator, err := sqlitemigrate.Open(
		path,
		[]sqlitemigrate.Migration{{
			Version: 1,
			Name:    ctfshowCatalogV1MigrationName,
			Up:      ctfshowCatalogV1Up,
		}},
		sqlitemigrate.WithPragmas([]string{
			"PRAGMA journal_mode = WAL",
		}),
	)
	if err != nil {
		return nil, fmt.Errorf("open CTFshow catalog: %w", err)
	}
	if err := migrator.Migrate(context.Background()); err != nil {
		migrator.Close()
		return nil, fmt.Errorf("migrate CTFshow catalog: %w", err)
	}
	db := migrator.DB()
	service := &CatalogService{db: db, path: path}
	if err := protectCatalogSQLiteFiles(path); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("secure CTFshow catalog: %w", err)
	}
	return service, nil
}

// ctfshowCatalogV1Up creates the current catalog schema and adopts the exact
// pre-migrator shape without rewriting its rows. Unknown same-name tables or
// indexes are rejected inside sqlitemigrate's transaction rather than being
// mislabeled as a successful v1 upgrade.
func ctfshowCatalogV1Up(ctx context.Context, tx *sql.Tx) error {
	for _, statement := range []string{
		`CREATE TABLE IF NOT EXISTS catalog_meta (
			key TEXT PRIMARY KEY,
			value TEXT NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS catalog_problems (
			platform_id INTEGER PRIMARY KEY,
			source_url TEXT NOT NULL,
			title TEXT NOT NULL,
			category TEXT NOT NULL,
			points INTEGER NOT NULL,
			solved_count INTEGER NOT NULL,
			tags_json TEXT NOT NULL,
			synced_at TEXT NOT NULL
		)`,
	} {
		if _, err := tx.ExecContext(ctx, statement); err != nil {
			return fmt.Errorf("create CTFshow catalog schema: %w", err)
		}
	}

	if err := requireCTFshowCatalogColumns(
		ctx,
		tx,
		"catalog_meta",
		[]string{"key", "value"},
	); err != nil {
		return err
	}
	if err := requireCTFshowCatalogColumns(
		ctx,
		tx,
		"catalog_problems",
		[]string{
			"platform_id", "source_url", "title", "category", "points",
			"solved_count", "tags_json", "synced_at",
		},
	); err != nil {
		return err
	}

	if _, err := tx.ExecContext(ctx, `CREATE INDEX IF NOT EXISTS
		catalog_problems_category
		ON catalog_problems(category, platform_id)`); err != nil {
		return fmt.Errorf("create CTFshow catalog index: %w", err)
	}
	if err := requireCTFshowCatalogIndexColumns(
		ctx,
		tx,
		"catalog_problems_category",
		[]string{"category", "platform_id"},
	); err != nil {
		return err
	}
	return nil
}

func requireCTFshowCatalogColumns(
	ctx context.Context,
	tx *sql.Tx,
	table string,
	want []string,
) error {
	rows, err := tx.QueryContext(ctx, `PRAGMA table_info(`+table+`)`)
	if err != nil {
		return fmt.Errorf("inspect CTFshow %s columns: %w", table, err)
	}
	defer rows.Close()

	got := make([]string, 0, len(want))
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
			return fmt.Errorf("inspect CTFshow %s columns: %w", table, err)
		}
		got = append(got, name)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("inspect CTFshow %s columns: %w", table, err)
	}
	if strings.Join(got, "\x00") != strings.Join(want, "\x00") {
		return fmt.Errorf(
			"incompatible CTFshow %s columns: got %v, want %v",
			table,
			got,
			want,
		)
	}
	return nil
}

func requireCTFshowCatalogIndexColumns(
	ctx context.Context,
	tx *sql.Tx,
	index string,
	want []string,
) error {
	rows, err := tx.QueryContext(ctx, `PRAGMA index_info(`+index+`)`)
	if err != nil {
		return fmt.Errorf("inspect CTFshow %s index: %w", index, err)
	}
	defer rows.Close()

	got := make([]string, 0, len(want))
	for rows.Next() {
		var (
			position int
			columnID int
			name     string
		)
		if err := rows.Scan(&position, &columnID, &name); err != nil {
			return fmt.Errorf("inspect CTFshow %s index: %w", index, err)
		}
		got = append(got, name)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("inspect CTFshow %s index: %w", index, err)
	}
	if strings.Join(got, "\x00") != strings.Join(want, "\x00") {
		return fmt.Errorf(
			"incompatible CTFshow %s index columns: got %v, want %v",
			index,
			got,
			want,
		)
	}
	return nil
}

func (s *CatalogService) Close() error {
	if err := protectCatalogSQLiteFiles(s.path); err != nil {
		_ = s.db.Close()
		return err
	}
	return s.db.Close()
}

func (s *CatalogService) Replace(ctx context.Context, problems []CatalogProblem) (CatalogSnapshot, error) {
	if len(problems) > maxCatalogProblems {
		return CatalogSnapshot{}, fmt.Errorf("CTFshow catalog exceeds %d problems", maxCatalogProblems)
	}
	syncedAt := time.Now().UTC().Format(time.RFC3339)
	transaction, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return CatalogSnapshot{}, fmt.Errorf("begin CTFshow catalog sync: %w", err)
	}
	defer transaction.Rollback()
	if _, err := transaction.ExecContext(ctx, `DELETE FROM catalog_problems`); err != nil {
		return CatalogSnapshot{}, fmt.Errorf("replace CTFshow catalog: %w", err)
	}
	statement, err := transaction.PrepareContext(ctx, `
		INSERT INTO catalog_problems(
			platform_id, source_url, title, category, points, solved_count, tags_json, synced_at
		) VALUES(?, ?, ?, ?, ?, ?, ?, ?)
	`)
	if err != nil {
		return CatalogSnapshot{}, fmt.Errorf("prepare CTFshow catalog: %w", err)
	}
	defer statement.Close()
	seen := make(map[int]struct{}, len(problems))
	for _, problem := range problems {
		if err := normalizeProblem(&problem); err != nil {
			return CatalogSnapshot{}, err
		}
		if _, exists := seen[problem.PlatformID]; exists {
			return CatalogSnapshot{}, fmt.Errorf("duplicate CTFshow challenge id %d", problem.PlatformID)
		}
		seen[problem.PlatformID] = struct{}{}
		tags, err := json.Marshal(problem.Tags)
		if err != nil {
			return CatalogSnapshot{}, fmt.Errorf("encode CTFshow challenge tags: %w", err)
		}
		if _, err := statement.ExecContext(
			ctx,
			problem.PlatformID,
			problem.SourceURL,
			problem.Title,
			problem.Category,
			problem.Points,
			problem.SolvedCount,
			string(tags),
			syncedAt,
		); err != nil {
			return CatalogSnapshot{}, fmt.Errorf("store CTFshow challenge %d: %w", problem.PlatformID, err)
		}
	}
	if _, err := transaction.ExecContext(ctx, `
		INSERT INTO catalog_meta(key, value) VALUES('last_synced_at', ?)
		ON CONFLICT(key) DO UPDATE SET value = excluded.value
	`, syncedAt); err != nil {
		return CatalogSnapshot{}, fmt.Errorf("store CTFshow catalog metadata: %w", err)
	}
	if err := transaction.Commit(); err != nil {
		return CatalogSnapshot{}, fmt.Errorf("commit CTFshow catalog: %w", err)
	}
	if err := protectCatalogSQLiteFiles(s.path); err != nil {
		return CatalogSnapshot{}, fmt.Errorf("protect CTFshow catalog after sync: %w", err)
	}
	return s.Snapshot(ctx)
}

func (s *CatalogService) Snapshot(ctx context.Context) (CatalogSnapshot, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT platform_id, source_url, title, category, points, solved_count, tags_json, synced_at
		FROM catalog_problems
		ORDER BY platform_id DESC
	`)
	if err != nil {
		return CatalogSnapshot{}, fmt.Errorf("list CTFshow catalog: %w", err)
	}
	defer rows.Close()
	problems := make([]CatalogProblem, 0)
	for rows.Next() {
		var problem CatalogProblem
		var tagsJSON string
		if err := rows.Scan(
			&problem.PlatformID,
			&problem.SourceURL,
			&problem.Title,
			&problem.Category,
			&problem.Points,
			&problem.SolvedCount,
			&tagsJSON,
			&problem.SyncedAt,
		); err != nil {
			return CatalogSnapshot{}, fmt.Errorf("scan CTFshow catalog: %w", err)
		}
		if err := json.Unmarshal([]byte(tagsJSON), &problem.Tags); err != nil {
			return CatalogSnapshot{}, fmt.Errorf("decode CTFshow challenge tags: %w", err)
		}
		problems = append(problems, problem)
	}
	if err := rows.Err(); err != nil {
		return CatalogSnapshot{}, fmt.Errorf("iterate CTFshow catalog: %w", err)
	}
	var lastSyncedAt string
	err = s.db.QueryRowContext(
		ctx,
		`SELECT value FROM catalog_meta WHERE key = 'last_synced_at'`,
	).Scan(&lastSyncedAt)
	if err != nil && err != sql.ErrNoRows {
		return CatalogSnapshot{}, fmt.Errorf("read CTFshow catalog metadata: %w", err)
	}
	return CatalogSnapshot{
		Total: len(problems), LastSyncedAt: lastSyncedAt, Problems: problems,
	}, nil
}

func normalizeProblem(problem *CatalogProblem) error {
	problem.Title = strings.TrimSpace(problem.Title)
	problem.Category = strings.TrimSpace(problem.Category)
	if problem.PlatformID <= 0 || problem.PlatformID > 100_000_000 ||
		problem.Title == "" || len([]rune(problem.Title)) > 240 ||
		len([]rune(problem.Category)) > 80 ||
		problem.Points < 0 || problem.Points > 1_000_000 ||
		problem.SolvedCount < 0 || problem.SolvedCount > 100_000_000 {
		return fmt.Errorf("invalid CTFshow challenge %d", problem.PlatformID)
	}
	if problem.Category == "" {
		problem.Category = "其他"
	}
	problem.SourceURL = fmt.Sprintf("https://ctf.show/challenges#%d", problem.PlatformID)
	if len(problem.Tags) > 32 {
		problem.Tags = problem.Tags[:32]
	}
	cleanTags := make([]string, 0, len(problem.Tags))
	for _, tag := range problem.Tags {
		tag = strings.TrimSpace(tag)
		if tag != "" && len([]rune(tag)) <= 80 {
			cleanTags = append(cleanTags, tag)
		}
	}
	problem.Tags = cleanTags
	return nil
}

func protectCatalogSQLiteFiles(path string) error {
	for _, candidate := range []string{path, path + "-wal", path + "-shm"} {
		if err := os.Chmod(candidate, 0o600); err != nil && !os.IsNotExist(err) {
			return err
		}
	}
	return nil
}
