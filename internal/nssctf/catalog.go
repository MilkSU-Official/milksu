package nssctf

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	_ "modernc.org/sqlite"
)

type CatalogSyncResult struct {
	SourceURL string `json:"sourceUrl"`
	Total     int    `json:"total"`
	Pages     int    `json:"pages"`
	SyncedAt  string `json:"syncedAt"`
}

type AbilityDimension struct {
	Key                 string `json:"key"`
	Label               string `json:"label"`
	Score               int    `json:"score"`
	Confidence          int    `json:"confidence"`
	Attempts            int    `json:"attempts"`
	Solved              int    `json:"solved"`
	JudgeVerifiedSolved int    `json:"judgeVerifiedSolved"`
	UserConfirmedSolved int    `json:"userConfirmedSolved"`
}

type TrainingSignal struct {
	ProblemID        int
	Platform         string
	Category         string
	Tags             []string
	Difficulty       float64
	State            string
	Succeeded        bool
	Attempts         int
	Hints            int
	IndependentSteps int
	Verification     string
}

const (
	TrainingStateActive    = "active"
	TrainingStateSucceeded = "succeeded"
	TrainingStateFailed    = "failed"
	TrainingStateCancelled = "cancelled"

	TrainingVerificationPlatformJudge = "platform-judge"
	TrainingVerificationUserConfirmed = "user-confirmed"
	TrainingVerificationUnverified    = "unverified"
)

type TrainingSourceSummary struct {
	Key                 string `json:"key"`
	Label               string `json:"label"`
	Attempts            int    `json:"attempts"`
	Solved              int    `json:"solved"`
	JudgeVerifiedSolved int    `json:"judgeVerifiedSolved"`
	UserConfirmedSolved int    `json:"userConfirmedSolved"`
}

type TrainingAcceptanceTrack struct {
	Key                 string `json:"key"`
	Label               string `json:"label"`
	Status              string `json:"status"`
	Attempts            int    `json:"attempts"`
	JudgeVerifiedSolved int    `json:"judgeVerifiedSolved"`
	UserConfirmedSolved int    `json:"userConfirmedSolved"`
}

type TrainingAcceptance struct {
	RequiredTracks      int                       `json:"requiredTracks"`
	JudgeVerifiedTracks int                       `json:"judgeVerifiedTracks"`
	Ready               bool                      `json:"ready"`
	Tracks              []TrainingAcceptanceTrack `json:"tracks"`
}

const (
	TrainingAcceptanceMissing       = "missing"
	TrainingAcceptanceAttempted     = "attempted"
	TrainingAcceptanceUserConfirmed = "user-confirmed"
	TrainingAcceptanceJudgeVerified = "judge-verified"
)

type Recommendation struct {
	Problem CatalogProblem `json:"problem"`
	Kind    string         `json:"kind"`
	Reason  string         `json:"reason"`
	Score   int            `json:"score"`
}

type TrainingSeries struct {
	Name                string           `json:"name"`
	DerivedFrom         string           `json:"derivedFrom"`
	ProblemCount        int              `json:"problemCount"`
	AttemptedCount      int              `json:"attemptedCount"`
	CompletedCount      int              `json:"completedCount"`
	AttemptedProblemIDs []int            `json:"attemptedProblemIds"`
	CompletedProblemIDs []int            `json:"completedProblemIds"`
	NextProblemID       int              `json:"nextProblemId,omitempty"`
	AverageDifficulty   float64          `json:"averageDifficulty"`
	Categories          []string         `json:"categories"`
	Problems            []CatalogProblem `json:"problems"`
}

type TrainingDashboard struct {
	CatalogTotal             int                     `json:"catalogTotal"`
	LastSyncedAt             string                  `json:"lastSyncedAt"`
	OverallScore             int                     `json:"overallScore"`
	OverallConfidence        int                     `json:"overallConfidence"`
	RealAttemptCount         int                     `json:"realAttemptCount"`
	RealSolvedCount          int                     `json:"realSolvedCount"`
	JudgeVerifiedSolvedCount int                     `json:"judgeVerifiedSolvedCount"`
	UserConfirmedSolvedCount int                     `json:"userConfirmedSolvedCount"`
	Acceptance               TrainingAcceptance      `json:"acceptance"`
	Sources                  []TrainingSourceSummary `json:"sources"`
	Dimensions               []AbilityDimension      `json:"dimensions"`
	Recommendations          []Recommendation        `json:"recommendations"`
	Series                   []TrainingSeries        `json:"series"`
}

type CatalogQuery struct {
	Query    string `json:"query"`
	Category string `json:"category"`
	Page     int    `json:"page"`
	PageSize int    `json:"pageSize"`
}

type CatalogSearchResult struct {
	Problems            []CatalogProblem `json:"problems"`
	Categories          []string         `json:"categories"`
	AttemptedProblemIDs []int            `json:"attemptedProblemIds"`
	CompletedProblemIDs []int            `json:"completedProblemIds"`
	Total               int              `json:"total"`
	Page                int              `json:"page"`
	PageSize            int              `json:"pageSize"`
	PageCount           int              `json:"pageCount"`
}

type CatalogServiceOptions struct {
	RequestDelay         time.Duration
	RateLimitRetryDelays []time.Duration
}

type CatalogService struct {
	client       *Client
	db           *sql.DB
	path         string
	requestDelay time.Duration
	retryDelays  []time.Duration
	syncMu       sync.Mutex
}

func NewCatalogService(path string, client *Client) (*CatalogService, error) {
	return newCatalogService(path, client, CatalogServiceOptions{
		RequestDelay:         350 * time.Millisecond,
		RateLimitRetryDelays: []time.Duration{2 * time.Second, 5 * time.Second, 10 * time.Second},
	})
}

func newCatalogService(path string, client *Client, options CatalogServiceOptions) (*CatalogService, error) {
	if client == nil {
		return nil, fmt.Errorf("NSSCTF catalog client is required")
	}
	directory := filepath.Dir(path)
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return nil, fmt.Errorf("create NSSCTF catalog directory: %w", err)
	}
	if err := os.Chmod(directory, 0o700); err != nil {
		return nil, fmt.Errorf("protect NSSCTF catalog directory: %w", err)
	}
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, fmt.Errorf("open NSSCTF catalog: %w", err)
	}
	db.SetMaxOpenConns(1)
	service := &CatalogService{
		client: client, db: db, path: path, requestDelay: options.RequestDelay,
		retryDelays: append([]time.Duration{}, options.RateLimitRetryDelays...),
	}
	if err := service.migrate(); err != nil {
		db.Close()
		return nil, err
	}
	if err := protectCatalogSQLiteFiles(path); err != nil {
		db.Close()
		return nil, fmt.Errorf("protect NSSCTF catalog: %w", err)
	}
	return service, nil
}

func (s *CatalogService) migrate() error {
	statements := []string{
		`PRAGMA journal_mode = WAL`,
		`PRAGMA foreign_keys = ON`,
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
			difficulty REAL NOT NULL,
			tags_json TEXT NOT NULL,
			has_writeup INTEGER NOT NULL,
			solved_count INTEGER NOT NULL,
			wrong_answer_count INTEGER NOT NULL,
			no_answer_count INTEGER NOT NULL,
			is_open INTEGER NOT NULL,
			synced_at TEXT NOT NULL,
			sync_run TEXT NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS catalog_problems_category_difficulty
			ON catalog_problems(category, difficulty)`,
	}
	for _, statement := range statements {
		if _, err := s.db.Exec(statement); err != nil {
			return fmt.Errorf("migrate NSSCTF catalog: %w", err)
		}
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

func (s *CatalogService) Sync(ctx context.Context, rawURL string) (CatalogSyncResult, error) {
	sourceURL, err := NormalizeCatalogURL(rawURL)
	if err != nil {
		return CatalogSyncResult{}, err
	}
	s.syncMu.Lock()
	defer s.syncMu.Unlock()

	runID := time.Now().UTC().Format("20060102T150405.000000000Z")
	syncedAt := time.Now().UTC().Format(time.RFC3339)
	totalProblems := 0
	totalPages := 0
	allProblems := make([]CatalogProblem, 0, 4096)
	for _, category := range catalogCategories {
		first, err := s.fetchCatalogPage(ctx, category.Type, category.Label, 1)
		if err != nil {
			return CatalogSyncResult{}, err
		}
		pages := int(math.Ceil(float64(first.Total) / float64(catalogPageSize)))
		if pages == 0 {
			continue
		}
		allProblems = append(allProblems, first.Problems...)
		totalProblems += first.Total
		totalPages += pages
		for page := 2; page <= pages; page++ {
			if err := waitForCatalogRequest(ctx, s.requestDelay); err != nil {
				return CatalogSyncResult{}, err
			}
			value, err := s.fetchCatalogPage(ctx, category.Type, category.Label, page)
			if err != nil {
				return CatalogSyncResult{}, err
			}
			allProblems = append(allProblems, value.Problems...)
		}
		if err := waitForCatalogRequest(ctx, s.requestDelay); err != nil {
			return CatalogSyncResult{}, err
		}
	}
	transaction, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return CatalogSyncResult{}, fmt.Errorf("finalize NSSCTF catalog sync: %w", err)
	}
	if err := s.upsertProblems(ctx, transaction, allProblems, runID, syncedAt); err != nil {
		transaction.Rollback()
		return CatalogSyncResult{}, err
	}
	if _, err := transaction.ExecContext(ctx, `DELETE FROM catalog_problems WHERE sync_run <> ?`, runID); err != nil {
		transaction.Rollback()
		return CatalogSyncResult{}, fmt.Errorf("prune NSSCTF catalog: %w", err)
	}
	for key, value := range map[string]string{
		"source_url":     sourceURL,
		"last_synced_at": syncedAt,
	} {
		if _, err := transaction.ExecContext(ctx, `
			INSERT INTO catalog_meta(key, value) VALUES(?, ?)
			ON CONFLICT(key) DO UPDATE SET value = excluded.value
		`, key, value); err != nil {
			transaction.Rollback()
			return CatalogSyncResult{}, fmt.Errorf("save NSSCTF catalog metadata: %w", err)
		}
	}
	if err := transaction.Commit(); err != nil {
		return CatalogSyncResult{}, fmt.Errorf("commit NSSCTF catalog sync: %w", err)
	}
	if err := protectCatalogSQLiteFiles(s.path); err != nil {
		return CatalogSyncResult{}, fmt.Errorf("protect NSSCTF catalog after sync: %w", err)
	}
	return CatalogSyncResult{
		SourceURL: sourceURL, Total: totalProblems, Pages: totalPages, SyncedAt: syncedAt,
	}, nil
}

func protectCatalogSQLiteFiles(path string) error {
	for _, candidate := range []string{path, path + "-wal", path + "-shm"} {
		if err := os.Chmod(candidate, 0o600); err != nil && !os.IsNotExist(err) {
			return err
		}
	}
	return nil
}

func (s *CatalogService) fetchCatalogPage(
	ctx context.Context,
	categoryType int,
	categoryLabel string,
	page int,
) (CatalogPage, error) {
	for attempt := 0; ; attempt++ {
		value, err := s.client.FetchCatalogPage(ctx, categoryType, categoryLabel, page)
		if err == nil {
			return value, nil
		}
		if !errors.Is(err, ErrCatalogRateLimited) {
			return CatalogPage{}, err
		}
		if attempt >= len(s.retryDelays) {
			return CatalogPage{}, fmt.Errorf("NSSCTF 题库请求被限流，已完成 %d 次退避重试: %w", attempt, err)
		}
		if err := waitForCatalogRequest(ctx, s.retryDelays[attempt]); err != nil {
			return CatalogPage{}, err
		}
	}
}

func waitForCatalogRequest(ctx context.Context, delay time.Duration) error {
	if delay <= 0 {
		return nil
	}
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

func (s *CatalogService) upsertProblems(
	ctx context.Context,
	transaction *sql.Tx,
	problems []CatalogProblem,
	runID string,
	syncedAt string,
) error {
	statement, err := transaction.PrepareContext(ctx, `
		INSERT INTO catalog_problems(
			platform_id, source_url, title, category, points, difficulty, tags_json,
			has_writeup, solved_count, wrong_answer_count, no_answer_count, is_open,
			synced_at, sync_run
		) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(platform_id) DO UPDATE SET
			source_url = excluded.source_url,
			title = excluded.title,
			category = excluded.category,
			points = excluded.points,
			difficulty = excluded.difficulty,
			tags_json = excluded.tags_json,
			has_writeup = excluded.has_writeup,
			solved_count = excluded.solved_count,
			wrong_answer_count = excluded.wrong_answer_count,
			no_answer_count = excluded.no_answer_count,
			is_open = excluded.is_open,
			synced_at = excluded.synced_at,
			sync_run = excluded.sync_run
	`)
	if err != nil {
		return fmt.Errorf("prepare NSSCTF catalog upsert: %w", err)
	}
	defer statement.Close()
	for _, problem := range problems {
		tags, err := json.Marshal(problem.Tags)
		if err != nil {
			return fmt.Errorf("encode NSSCTF problem tags: %w", err)
		}
		if _, err := statement.ExecContext(
			ctx,
			problem.PlatformID, problem.SourceURL, problem.Title, problem.Category,
			problem.Points, problem.Difficulty, string(tags), boolInt(problem.HasWriteup),
			problem.SolvedCount, problem.WrongAnswerCount, problem.NoAnswerCount,
			boolInt(problem.Open), syncedAt, runID,
		); err != nil {
			return fmt.Errorf("upsert NSSCTF problem P%d: %w", problem.PlatformID, err)
		}
	}
	return nil
}

func boolInt(value bool) int {
	if value {
		return 1
	}
	return 0
}

func (s *CatalogService) Dashboard(ctx context.Context, signals []TrainingSignal) (TrainingDashboard, error) {
	problems, err := s.listProblems(ctx)
	if err != nil {
		return TrainingDashboard{}, err
	}
	lastSyncedAt, err := s.meta(ctx, "last_synced_at")
	if err != nil {
		return TrainingDashboard{}, err
	}
	dimensions := buildAbilityDimensions(signals, problems)
	acceptance := buildTrainingAcceptance(dimensions)
	recommendations := buildRecommendations(dimensions, signals, problems, 6)
	series := buildTrainingSeries(problems, signals, 8)
	sources := buildTrainingSourceSummaries(signals)
	realAttemptCount := 0
	realSolvedCount := 0
	judgeVerifiedSolvedCount := 0
	userConfirmedSolvedCount := 0
	for _, source := range sources {
		realAttemptCount += source.Attempts
		realSolvedCount += source.Solved
		judgeVerifiedSolvedCount += source.JudgeVerifiedSolved
		userConfirmedSolvedCount += source.UserConfirmedSolved
	}
	overall := 0
	overallConfidence := 0
	calibratedDimensions := 0
	for _, dimension := range dimensions {
		overallConfidence += dimension.Confidence
		if dimension.Attempts > 0 {
			overall += dimension.Score
			calibratedDimensions++
		}
	}
	if len(dimensions) > 0 {
		overallConfidence /= len(dimensions)
	}
	if calibratedDimensions > 0 {
		overall /= calibratedDimensions
	}
	return TrainingDashboard{
		CatalogTotal: len(problems), LastSyncedAt: lastSyncedAt,
		OverallScore: overall, OverallConfidence: overallConfidence,
		RealAttemptCount: realAttemptCount, RealSolvedCount: realSolvedCount,
		JudgeVerifiedSolvedCount: judgeVerifiedSolvedCount,
		UserConfirmedSolvedCount: userConfirmedSolvedCount,
		Acceptance:               acceptance,
		Sources:                  sources,
		Dimensions:               dimensions, Recommendations: recommendations, Series: series,
	}, nil
}

func buildTrainingAcceptance(dimensions []AbilityDimension) TrainingAcceptance {
	result := TrainingAcceptance{
		RequiredTracks: len(abilityAxes),
		Tracks:         make([]TrainingAcceptanceTrack, 0, len(abilityAxes)),
	}
	byKey := make(map[string]AbilityDimension, len(dimensions))
	for _, dimension := range dimensions {
		byKey[dimension.Key] = dimension
	}
	for _, axis := range abilityAxes {
		dimension := byKey[axis.Key]
		status := TrainingAcceptanceMissing
		switch {
		case dimension.JudgeVerifiedSolved > 0:
			status = TrainingAcceptanceJudgeVerified
			result.JudgeVerifiedTracks++
		case dimension.UserConfirmedSolved > 0:
			status = TrainingAcceptanceUserConfirmed
		case dimension.Attempts > 0:
			status = TrainingAcceptanceAttempted
		}
		result.Tracks = append(result.Tracks, TrainingAcceptanceTrack{
			Key: axis.Key, Label: axis.Label, Status: status,
			Attempts:            dimension.Attempts,
			JudgeVerifiedSolved: dimension.JudgeVerifiedSolved,
			UserConfirmedSolved: dimension.UserConfirmedSolved,
		})
	}
	result.Ready = result.RequiredTracks > 0 &&
		result.JudgeVerifiedTracks == result.RequiredTracks
	return result
}

func (s *CatalogService) Search(ctx context.Context, request CatalogQuery) (CatalogSearchResult, error) {
	query := strings.ToLower(strings.TrimSpace(request.Query))
	category := strings.TrimSpace(request.Category)
	page := request.Page
	if page <= 0 {
		page = 1
	}
	pageSize := request.PageSize
	if pageSize != 10 && pageSize != 20 && pageSize != 40 {
		pageSize = 20
	}

	where := []string{"is_open = 1"}
	args := make([]any, 0, 5)
	if query != "" {
		idQuery := strings.TrimPrefix(query, "p")
		where = append(where, `(
			CAST(platform_id AS TEXT) LIKE ? OR
			lower(title) LIKE ? OR
			lower(tags_json) LIKE ?
		)`)
		args = append(args, "%"+idQuery+"%", "%"+query+"%", "%"+query+"%")
	}
	if category != "" && !strings.EqualFold(category, "all") {
		where = append(where, "category = ?")
		args = append(args, category)
	}
	whereSQL := strings.Join(where, " AND ")
	orderSQL := "platform_id DESC"
	orderArgs := make([]any, 0, 4)
	if query != "" {
		idQuery := strings.TrimPrefix(query, "p")
		orderSQL = `CASE
			WHEN CAST(platform_id AS TEXT) = ? THEN 0
			WHEN lower(title) = ? THEN 1
			WHEN lower(title) LIKE ? THEN 2
			WHEN CAST(platform_id AS TEXT) LIKE ? THEN 3
			ELSE 4
		END, platform_id DESC`
		orderArgs = append(orderArgs, idQuery, query, query+"%", idQuery+"%")
	}

	var total int
	if err := s.db.QueryRowContext(
		ctx,
		"SELECT COUNT(*) FROM catalog_problems WHERE "+whereSQL,
		args...,
	).Scan(&total); err != nil {
		return CatalogSearchResult{}, fmt.Errorf("count NSSCTF catalog search: %w", err)
	}
	pageCount := 0
	if total > 0 {
		pageCount = int(math.Ceil(float64(total) / float64(pageSize)))
		if page > pageCount {
			page = pageCount
		}
	} else {
		page = 1
	}

	searchArgs := append(append(append([]any{}, args...), orderArgs...), pageSize, (page-1)*pageSize)
	rows, err := s.db.QueryContext(ctx, `
		SELECT platform_id, source_url, title, category, points, difficulty, tags_json,
			has_writeup, solved_count, wrong_answer_count, no_answer_count, is_open, synced_at
		FROM catalog_problems
		WHERE `+whereSQL+`
		ORDER BY `+orderSQL+`
		LIMIT ? OFFSET ?
	`, searchArgs...)
	if err != nil {
		return CatalogSearchResult{}, fmt.Errorf("search NSSCTF catalog: %w", err)
	}
	problems := make([]CatalogProblem, 0, pageSize)
	for rows.Next() {
		problem, err := scanCatalogProblem(rows)
		if err != nil {
			rows.Close()
			return CatalogSearchResult{}, err
		}
		problems = append(problems, problem)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return CatalogSearchResult{}, fmt.Errorf("iterate NSSCTF catalog search: %w", err)
	}
	if err := rows.Close(); err != nil {
		return CatalogSearchResult{}, fmt.Errorf("close NSSCTF catalog search: %w", err)
	}

	categoryRows, err := s.db.QueryContext(ctx, `
		SELECT DISTINCT category
		FROM catalog_problems
		WHERE is_open = 1 AND trim(category) <> ''
		ORDER BY category
	`)
	if err != nil {
		return CatalogSearchResult{}, fmt.Errorf("list NSSCTF catalog categories: %w", err)
	}
	defer categoryRows.Close()
	categories := make([]string, 0, len(catalogCategories))
	for categoryRows.Next() {
		var value string
		if err := categoryRows.Scan(&value); err != nil {
			return CatalogSearchResult{}, fmt.Errorf("scan NSSCTF catalog category: %w", err)
		}
		categories = append(categories, value)
	}
	if err := categoryRows.Err(); err != nil {
		return CatalogSearchResult{}, fmt.Errorf("iterate NSSCTF catalog categories: %w", err)
	}

	return CatalogSearchResult{
		Problems: problems, Categories: categories, Total: total,
		AttemptedProblemIDs: []int{}, CompletedProblemIDs: []int{},
		Page: page, PageSize: pageSize, PageCount: pageCount,
	}, nil
}

func (s *CatalogService) meta(ctx context.Context, key string) (string, error) {
	var value string
	err := s.db.QueryRowContext(ctx, `SELECT value FROM catalog_meta WHERE key = ?`, key).Scan(&value)
	if err == sql.ErrNoRows {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("read NSSCTF catalog metadata: %w", err)
	}
	return value, nil
}

func (s *CatalogService) listProblems(ctx context.Context) ([]CatalogProblem, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT platform_id, source_url, title, category, points, difficulty, tags_json,
			has_writeup, solved_count, wrong_answer_count, no_answer_count, is_open, synced_at
		FROM catalog_problems
		WHERE is_open = 1
	`)
	if err != nil {
		return nil, fmt.Errorf("list NSSCTF catalog: %w", err)
	}
	defer rows.Close()
	problems := make([]CatalogProblem, 0)
	for rows.Next() {
		problem, err := scanCatalogProblem(rows)
		if err != nil {
			return nil, err
		}
		problems = append(problems, problem)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate NSSCTF catalog: %w", err)
	}
	return problems, nil
}

type catalogRowScanner interface {
	Scan(dest ...any) error
}

func scanCatalogProblem(scanner catalogRowScanner) (CatalogProblem, error) {
	var problem CatalogProblem
	var tagsJSON string
	var hasWriteup, open int
	if err := scanner.Scan(
		&problem.PlatformID, &problem.SourceURL, &problem.Title, &problem.Category,
		&problem.Points, &problem.Difficulty, &tagsJSON, &hasWriteup,
		&problem.SolvedCount, &problem.WrongAnswerCount, &problem.NoAnswerCount,
		&open, &problem.SyncedAt,
	); err != nil {
		return CatalogProblem{}, fmt.Errorf("scan NSSCTF catalog: %w", err)
	}
	if err := json.Unmarshal([]byte(tagsJSON), &problem.Tags); err != nil {
		return CatalogProblem{}, fmt.Errorf("decode NSSCTF problem tags: %w", err)
	}
	problem.HasWriteup = hasWriteup == 1
	problem.Open = open == 1
	return problem, nil
}

var abilityAxes = []struct {
	Key   string
	Label string
}{
	{Key: "web", Label: "Web"},
	{Key: "pwn", Label: "Pwn"},
	{Key: "reverse", Label: "Reverse"},
	{Key: "crypto", Label: "Crypto"},
	{Key: "forensics", Label: "取证"},
	{Key: "misc", Label: "Misc"},
}

func buildTrainingSourceSummaries(signals []TrainingSignal) []TrainingSourceSummary {
	summaries := make(map[string]TrainingSourceSummary)
	for _, signal := range signals {
		key, label := trainingSourceIdentity(signal.Platform)
		if key == "" {
			continue
		}
		summary := summaries[key]
		summary.Key = key
		summary.Label = label
		summary.Attempts += max(1, signal.Attempts)
		if signal.Succeeded {
			summary.Solved++
			switch signal.Verification {
			case TrainingVerificationPlatformJudge:
				summary.JudgeVerifiedSolved++
			case TrainingVerificationUserConfirmed:
				summary.UserConfirmedSolved++
			}
		}
		summaries[key] = summary
	}
	result := make([]TrainingSourceSummary, 0, len(summaries))
	for _, summary := range summaries {
		result = append(result, summary)
	}
	priority := map[string]int{
		"nssctf":  0,
		"ctfshow": 1,
	}
	sort.Slice(result, func(i, j int) bool {
		left, leftKnown := priority[result[i].Key]
		right, rightKnown := priority[result[j].Key]
		if leftKnown != rightKnown {
			return leftKnown
		}
		if leftKnown && left != right {
			return left < right
		}
		return result[i].Label < result[j].Label
	})
	return result
}

func trainingSourceIdentity(platform string) (string, string) {
	normalized := strings.ToLower(strings.TrimSpace(platform))
	switch {
	case strings.HasPrefix(normalized, "nssctf"):
		return "nssctf", "NSSCTF"
	case strings.HasPrefix(normalized, "ctfshow"):
		return "ctfshow", "CTFshow"
	case strings.HasPrefix(normalized, "hackthebox"), strings.HasPrefix(normalized, "htb"):
		return "hack-the-box", "Hack The Box"
	case strings.HasPrefix(normalized, "tryhackme"), strings.HasPrefix(normalized, "thm"):
		return "tryhackme", "TryHackMe"
	case normalized == "":
		return "", ""
	default:
		return normalized, strings.TrimSpace(platform)
	}
}

func buildAbilityDimensions(signals []TrainingSignal, problems []CatalogProblem) []AbilityDimension {
	difficultyByID := make(map[int]float64, len(problems))
	tagsByID := make(map[int][]string, len(problems))
	for _, problem := range problems {
		difficultyByID[problem.PlatformID] = problem.Difficulty
		tagsByID[problem.PlatformID] = problem.Tags
	}
	type aggregate struct {
		attempts, solved, hints, independent     int
		judgeVerifiedSolved, userConfirmedSolved int
		difficultySamples                        int
		solvedDifficulty, weightedSolved         float64
	}
	values := make(map[string]*aggregate)
	for _, axis := range abilityAxes {
		values[axis.Key] = &aggregate{}
	}
	for _, signal := range signals {
		tags := signal.Tags
		if len(tags) == 0 {
			tags = tagsByID[signal.ProblemID]
		}
		key := dimensionKey(signal.Category, tags)
		value := values[key]
		if value == nil {
			value = values["misc"]
		}
		attempts := max(1, signal.Attempts)
		value.attempts += attempts
		value.hints += signal.Hints
		value.independent += signal.IndependentSteps
		if signal.Succeeded {
			value.solved++
			switch signal.Verification {
			case TrainingVerificationPlatformJudge:
				value.judgeVerifiedSolved++
				value.weightedSolved += 1
			case TrainingVerificationUserConfirmed:
				value.userConfirmedSolved++
				value.weightedSolved += 0.8
			default:
				// Older or imported records without typed Judge provenance can
				// still contribute, but never at platform-receipt strength.
				value.weightedSolved += 0.6
			}
			difficulty := signal.Difficulty
			if difficulty <= 0 {
				difficulty = difficultyByID[signal.ProblemID]
			}
			if difficulty > 0 {
				value.solvedDifficulty += difficulty
				value.difficultySamples++
			}
		}
	}
	result := make([]AbilityDimension, 0, len(abilityAxes))
	for _, axis := range abilityAxes {
		value := values[axis.Key]
		score := 20
		if value.attempts > 0 {
			successRate := value.weightedSolved / float64(value.attempts)
			averageDifficulty := 0.0
			if value.difficultySamples > 0 {
				averageDifficulty = value.solvedDifficulty / float64(value.difficultySamples)
			}
			independence := float64(value.independent+1) /
				float64(value.independent+value.hints+2)
			score = int(math.Round(
				18 +
					math.Min(18, math.Log1p(float64(value.attempts))*7) +
					successRate*30 +
					math.Min(24, averageDifficulty/5*24) +
					independence*10,
			))
			score = min(95, max(8, score))
		}
		result = append(result, AbilityDimension{
			Key: axis.Key, Label: axis.Label, Score: score,
			Confidence: min(100, value.attempts*14),
			Attempts:   value.attempts, Solved: value.solved,
			JudgeVerifiedSolved: value.judgeVerifiedSolved,
			UserConfirmedSolved: value.userConfirmedSolved,
		})
	}
	return result
}

func buildRecommendations(
	dimensions []AbilityDimension,
	signals []TrainingSignal,
	problems []CatalogProblem,
	limit int,
) []Recommendation {
	if len(problems) == 0 || limit <= 0 {
		return []Recommendation{}
	}
	ability := make(map[string]int, len(dimensions))
	confidence := make(map[string]int, len(dimensions))
	for _, dimension := range dimensions {
		ability[dimension.Key] = dimension.Score
		confidence[dimension.Key] = dimension.Confidence
	}
	type attemptState struct {
		active, succeeded, failed, attempted bool
		attempts, hints, independent         int
	}
	attempted := make(map[int]attemptState, len(signals))
	for _, signal := range signals {
		if signal.ProblemID <= 0 {
			continue
		}
		value := attempted[signal.ProblemID]
		value.attempted = true
		value.attempts += max(1, signal.Attempts)
		value.hints += max(0, signal.Hints)
		value.independent += max(0, signal.IndependentSteps)
		switch signal.State {
		case TrainingStateActive:
			value.active = true
		case TrainingStateFailed:
			value.failed = true
		case TrainingStateSucceeded:
			value.succeeded = true
		}
		value.succeeded = value.succeeded || signal.Succeeded
		attempted[signal.ProblemID] = value
	}
	type candidate struct {
		problem           CatalogProblem
		key, kind, reason string
		score             float64
		review            bool
	}
	newCandidates := make([]candidate, 0, len(problems))
	reviewCandidates := make([]candidate, 0, len(problems))
	for _, problem := range problems {
		progress, wasAttempted := attempted[problem.PlatformID]
		reviewable := wasAttempted &&
			progress.failed &&
			!progress.active &&
			!progress.succeeded
		if wasAttempted && !reviewable {
			continue
		}
		key := dimensionKey(problem.Category, problem.Tags)
		skill := ability[key]
		targetDifficulty := 1.8 + float64(skill)/100*2.4
		difficultyFit := 1 - math.Min(1, math.Abs(problem.Difficulty-targetDifficulty)/2.2)
		weakness := float64(100-skill) / 100
		popularity := math.Min(1, math.Log1p(float64(problem.SolvedCount))/10)
		reliability := 0.5
		totalAnswers := problem.SolvedCount + problem.WrongAnswerCount
		if totalAnswers > 0 {
			reliability = float64(problem.SolvedCount) / float64(totalAnswers)
		}
		score := difficultyFit*0.46 + weakness*0.28 + popularity*0.16 + reliability*0.1
		kind := "巩固"
		if confidence[key] == 0 {
			kind = "校准"
		} else if skill <= 35 {
			kind = "补短板"
		} else if problem.Difficulty > targetDifficulty+0.45 {
			kind = "进阶"
		}
		label := key
		for _, dimension := range dimensions {
			if dimension.Key == key {
				label = dimension.Label
				break
			}
		}
		reason := fmt.Sprintf(
			"%s 当前能力 %d；题目难度 %.1f 接近建议区间 %.1f–%.1f，已有 %d 人解出。",
			label, skill, problem.Difficulty,
			math.Max(1, targetDifficulty-0.4), math.Min(5, targetDifficulty+0.4),
			problem.SolvedCount,
		)
		if confidence[key] == 0 {
			reason = fmt.Sprintf(
				"%s 尚未校准；这道 %.1f 难度的题适合建立第一条真实训练记录，已有 %d 人解出。",
				label, problem.Difficulty, problem.SolvedCount,
			)
		}
		value := candidate{
			problem: problem, key: key, kind: kind, reason: reason, score: score,
		}
		if reviewable {
			hintDependency := float64(progress.hints) /
				float64(progress.hints+progress.independent+1)
			reviewScore := 0.48 +
				weakness*0.18 +
				hintDependency*0.18 +
				difficultyFit*0.1 +
				math.Min(0.06, float64(progress.attempts-1)*0.03)
			reason = fmt.Sprintf(
				"上次未通过；使用 %d 条提示、完成 %d 个独立步骤。先复盘 %s 的卡点，再进入新题。",
				progress.hints, progress.independent, label,
			)
			if progress.hints == 0 && progress.independent == 0 {
				reason = fmt.Sprintf(
					"上次未通过且还没有留下有效步骤；从 %s 题面拆解和第一个可证伪假设重新开始。",
					label,
				)
			}
			value.kind = "复盘"
			value.reason = reason
			value.score = reviewScore
			value.review = true
			reviewCandidates = append(reviewCandidates, value)
			continue
		}
		newCandidates = append(newCandidates, value)
	}
	sortCandidates := func(values []candidate) {
		sort.Slice(values, func(i, j int) bool {
			if values[i].score == values[j].score {
				return values[i].problem.PlatformID < values[j].problem.PlatformID
			}
			return values[i].score > values[j].score
		})
	}
	sortCandidates(newCandidates)
	sortCandidates(reviewCandidates)

	// A review is useful, but it must not turn the training feed into a loop of
	// old failures. Keep at most one and place it after two fresh choices.
	candidates := newCandidates
	if len(reviewCandidates) > 0 {
		insertAt := min(2, len(candidates))
		candidates = append(candidates, candidate{})
		copy(candidates[insertAt+1:], candidates[insertAt:])
		candidates[insertAt] = reviewCandidates[0]
	}
	result := make([]Recommendation, 0, limit)
	perDimension := make(map[string]int)
	reviewCount := 0
	for _, value := range candidates {
		if value.review {
			if reviewCount >= 1 {
				continue
			}
		} else if perDimension[value.key] >= 2 {
			continue
		}
		result = append(result, Recommendation{
			Problem: value.problem, Kind: value.kind, Reason: value.reason,
			Score: int(math.Round(value.score * 100)),
		})
		if value.review {
			reviewCount++
		} else {
			perDimension[value.key]++
		}
		if len(result) == limit {
			break
		}
	}
	return result
}

func buildTrainingSeries(
	problems []CatalogProblem,
	signals []TrainingSignal,
	limit int,
) []TrainingSeries {
	if limit <= 0 {
		return []TrainingSeries{}
	}
	attempted := make(map[int]struct{}, len(signals))
	completed := make(map[int]struct{}, len(signals))
	for _, signal := range signals {
		if signal.ProblemID > 0 {
			attempted[signal.ProblemID] = struct{}{}
			if signal.Succeeded {
				completed[signal.ProblemID] = struct{}{}
			}
		}
	}
	groups := make(map[string][]CatalogProblem)
	for _, problem := range problems {
		name := titleSeriesName(problem.Title)
		if name == "" {
			continue
		}
		groups[name] = append(groups[name], problem)
	}
	result := make([]TrainingSeries, 0, len(groups))
	for name, values := range groups {
		if len(values) < 3 {
			continue
		}
		sort.Slice(values, func(i, j int) bool {
			leftKnown := values[i].Difficulty > 0
			rightKnown := values[j].Difficulty > 0
			if leftKnown != rightKnown {
				return leftKnown
			}
			if values[i].Difficulty == values[j].Difficulty {
				return values[i].PlatformID < values[j].PlatformID
			}
			return values[i].Difficulty < values[j].Difficulty
		})
		categorySet := make(map[string]struct{})
		difficultyTotal := 0.0
		knownDifficultyCount := 0
		attemptedIDs := make([]int, 0)
		completedIDs := make([]int, 0)
		nextProblemID := 0
		for _, problem := range values {
			categorySet[problem.Category] = struct{}{}
			if problem.Difficulty > 0 {
				difficultyTotal += problem.Difficulty
				knownDifficultyCount++
			}
			if _, exists := attempted[problem.PlatformID]; exists {
				attemptedIDs = append(attemptedIDs, problem.PlatformID)
			}
			if _, exists := completed[problem.PlatformID]; exists {
				completedIDs = append(completedIDs, problem.PlatformID)
			} else if nextProblemID == 0 {
				nextProblemID = problem.PlatformID
			}
		}
		categories := make([]string, 0, len(categorySet))
		for category := range categorySet {
			categories = append(categories, category)
		}
		sort.Strings(categories)
		averageDifficulty := 0.0
		if knownDifficultyCount > 0 {
			averageDifficulty = math.Round(difficultyTotal/float64(knownDifficultyCount)*10) / 10
		}
		result = append(result, TrainingSeries{
			Name: name, DerivedFrom: "title-prefix",
			ProblemCount: len(values), AttemptedCount: len(attemptedIDs), CompletedCount: len(completedIDs),
			AttemptedProblemIDs: attemptedIDs, CompletedProblemIDs: completedIDs, NextProblemID: nextProblemID,
			AverageDifficulty: averageDifficulty,
			Categories:        categories, Problems: append([]CatalogProblem{}, values...),
		})
	}
	sort.Slice(result, func(i, j int) bool {
		leftActive := result[i].AttemptedCount > 0
		rightActive := result[j].AttemptedCount > 0
		if leftActive != rightActive {
			return leftActive
		}
		if result[i].ProblemCount != result[j].ProblemCount {
			return result[i].ProblemCount > result[j].ProblemCount
		}
		return result[i].Name < result[j].Name
	})
	if len(result) > limit {
		result = result[:limit]
	}
	return result
}

func titleSeriesName(title string) string {
	title = strings.TrimSpace(title)
	pairs := [][2]string{{"[", "]"}, {"【", "】"}}
	for _, pair := range pairs {
		if !strings.HasPrefix(title, pair[0]) {
			continue
		}
		end := strings.Index(title, pair[1])
		if end <= len(pair[0]) {
			return ""
		}
		name := strings.TrimSpace(title[len(pair[0]):end])
		length := len([]rune(name))
		if length < 3 || length > 80 {
			return ""
		}
		return name
	}
	return ""
}

func dimensionKey(category string, tags []string) string {
	category = strings.ToLower(strings.TrimSpace(category))
	joinedTags := strings.ToLower(strings.Join(tags, " "))
	if category == "misc" && containsAny(joinedTags,
		"取证", "流量", "日志", "隐写", "压缩包", "内存", "pcap", "forensic",
	) {
		return "forensics"
	}
	switch category {
	case "web":
		return "web"
	case "pwn":
		return "pwn"
	case "reverse", "mobile":
		return "reverse"
	case "crypto":
		return "crypto"
	case "forensics":
		return "forensics"
	default:
		return "misc"
	}
}

func containsAny(value string, fragments ...string) bool {
	for _, fragment := range fragments {
		if strings.Contains(value, fragment) {
			return true
		}
	}
	return false
}
