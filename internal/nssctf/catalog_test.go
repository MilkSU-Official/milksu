package nssctf

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/MilkSU-Official/milksu/internal/sqlitemigrate"
)

func TestNormalizeCatalogURL(t *testing.T) {
	for _, value := range []string{"", "https://www.nssctf.cn/problem", "https://www.nssctf.cn/problem/"} {
		normalized, err := NormalizeCatalogURL(value)
		if err != nil {
			t.Fatalf("NormalizeCatalogURL(%q): %v", value, err)
		}
		if normalized != "https://www.nssctf.cn/problem" {
			t.Fatalf("unexpected normalized URL %q", normalized)
		}
	}
	for _, value := range []string{
		"http://www.nssctf.cn/problem",
		"https://nssctf.cn/problem",
		"https://www.nssctf.cn/problem?type=1",
		"https://www.nssctf.cn/problem/316",
	} {
		if _, err := NormalizeCatalogURL(value); err == nil {
			t.Fatalf("expected %q to be rejected", value)
		}
	}
}

func TestCatalogSQLiteFilesArePrivate(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("POSIX permission bits are not authoritative on Windows")
	}
	path := filepath.Join(t.TempDir(), "nssctf", "catalog.sqlite3")
	service, err := NewCatalogService(path, NewClient(ClientOptions{}))
	if err != nil {
		t.Fatal(err)
	}
	defer service.Close()
	assertPrivateCatalogFiles(t, path)
}

func TestCatalogDatabaseUsesNumberedMigration(t *testing.T) {
	path := filepath.Join(t.TempDir(), "nssctf", "catalog.sqlite3")
	service, err := NewCatalogService(path, NewClient(ClientOptions{}))
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
		t.Fatalf("query NSSCTF catalog migration history: %v", err)
	}
	if version != SupportedNSSCTFCatalogDatabaseVersion ||
		name != nssctfCatalogV1MigrationName ||
		strings.TrimSpace(appliedAt) == "" {
		t.Fatalf(
			"migration history = (%d, %q, %q), want (%d, %q, non-empty)",
			version,
			name,
			appliedAt,
			SupportedNSSCTFCatalogDatabaseVersion,
			nssctfCatalogV1MigrationName,
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
		`CREATE INDEX catalog_problems_category_difficulty
			ON catalog_problems(category, difficulty)`,
		`INSERT INTO catalog_meta(key, value)
			VALUES ('last_synced_at', '2026-07-31T12:34:56Z')`,
		`INSERT INTO catalog_problems (
			platform_id, source_url, title, category, points, difficulty,
			tags_json, has_writeup, solved_count, wrong_answer_count,
			no_answer_count, is_open, synced_at, sync_run
		) VALUES (
			3879, 'https://www.nssctf.cn/problem/3879', 'legacy fixture',
			'Web', 100, 2.5, '["legacy","web"]', 1, 42, 3, 1, 1,
			'2026-07-31T12:34:56Z', 'legacy-run'
		)`,
	)
	if err := database.Close(); err != nil {
		t.Fatal(err)
	}

	service, err := NewCatalogService(path, NewClient(ClientOptions{}))
	if err != nil {
		t.Fatalf("upgrade pre-migrator NSSCTF catalog: %v", err)
	}
	var (
		title      string
		category   string
		tagsJSON   string
		lastSynced string
	)
	if err := service.db.QueryRow(
		`SELECT title, category, tags_json FROM catalog_problems WHERE platform_id = 3879`,
	).Scan(&title, &category, &tagsJSON); err != nil {
		t.Fatalf("query preserved NSSCTF catalog row: %v", err)
	}
	if err := service.db.QueryRow(
		`SELECT value FROM catalog_meta WHERE key = 'last_synced_at'`,
	).Scan(&lastSynced); err != nil {
		t.Fatalf("query preserved NSSCTF catalog metadata: %v", err)
	}
	if title != "legacy fixture" ||
		category != "Web" ||
		tagsJSON != `["legacy","web"]` ||
		lastSynced != "2026-07-31T12:34:56Z" {
		t.Fatalf(
			"pre-migrator catalog data changed: title=%q category=%q tags=%q lastSynced=%q",
			title,
			category,
			tagsJSON,
			lastSynced,
		)
	}
	if err := service.Close(); err != nil {
		t.Fatal(err)
	}

	reopened, err := NewCatalogService(path, NewClient(ClientOptions{}))
	if err != nil {
		t.Fatalf("reopen migrated NSSCTF catalog: %v", err)
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
			VALUES (1, 'create NSSCTF catalog', '2026-07-31T12:34:56Z')`,
		`INSERT INTO schema_migrations(version, name, applied_at)
			VALUES (2, 'future NSSCTF catalog schema', '2026-08-01T12:34:56Z')`,
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

	service, err := NewCatalogService(path, NewClient(ClientOptions{}))
	if service != nil {
		service.Close()
		t.Fatal("future NSSCTF catalog unexpectedly returned a service")
	}
	if !errors.Is(err, sqlitemigrate.ErrDatabaseTooNew) {
		t.Fatalf("future NSSCTF catalog error = %v, want ErrDatabaseTooNew", err)
	}
	after, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(before, after) {
		t.Fatal("future NSSCTF catalog rejection modified database bytes")
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

	service, err := NewCatalogService(path, NewClient(ClientOptions{}))
	if service != nil {
		service.Close()
		t.Fatal("incompatible NSSCTF catalog unexpectedly returned a service")
	}
	if err == nil || !strings.Contains(err.Error(), "incompatible NSSCTF catalog_problems columns") {
		t.Fatalf("incompatible NSSCTF catalog error = %v, want schema-shape migration failure", err)
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

func TestCatalogSyncAndDashboard(t *testing.T) {
	requests := 0
	server := httptest.NewTLSServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		requests++
		if request.Method != http.MethodPost {
			t.Fatalf("unexpected method %s", request.Method)
		}
		var filters struct {
			Type int `json:"type"`
		}
		if err := json.NewDecoder(request.Body).Decode(&filters); err != nil {
			t.Fatalf("decode filters: %v", err)
		}
		if filters.Type < 1 || filters.Type > 10 {
			t.Fatalf("unexpected category type %d", filters.Type)
		}
		writer.Header().Set("Content-Type", "application/json")
		fmt.Fprintf(writer, `{
			"code": 200,
			"data": {
				"problems": [{
					"id": %d,
					"title": "Training %d",
					"tag": ["tag-%d"],
					"wp": true,
					"point": 100,
					"info": {"solved": %d, "wrong": 20, "no": 2},
					"level": %.1f,
					"open": true
				}],
				"total": 1
			}
		}`, 100+filters.Type, filters.Type, filters.Type, 1000-filters.Type, 1.8+float64(filters.Type)/10)
	}))
	defer server.Close()

	client := NewClient(ClientOptions{
		BaseURL:    server.URL,
		HTTPClient: server.Client(),
	})
	service, err := newCatalogService(
		filepath.Join(t.TempDir(), "catalog.sqlite3"),
		client,
		CatalogServiceOptions{},
	)
	if err != nil {
		t.Fatalf("new catalog service: %v", err)
	}
	defer service.Close()

	synced, err := service.Sync(context.Background(), "https://www.nssctf.cn/problem")
	if err != nil {
		t.Fatalf("sync catalog: %v", err)
	}
	if synced.Total != 10 || synced.Pages != 10 || requests != 10 {
		t.Fatalf("unexpected sync result %+v with %d requests", synced, requests)
	}

	coldDashboard, err := service.Dashboard(context.Background(), nil)
	if err != nil {
		t.Fatalf("build cold dashboard: %v", err)
	}
	if coldDashboard.OverallScore != 0 || coldDashboard.OverallConfidence != 0 {
		t.Fatalf("untrained profile must remain uncalibrated: %+v", coldDashboard)
	}
	if coldDashboard.Acceptance.RequiredTracks != 6 ||
		coldDashboard.Acceptance.JudgeVerifiedTracks != 0 ||
		coldDashboard.Acceptance.Ready ||
		len(coldDashboard.Acceptance.Tracks) != 6 {
		t.Fatalf("cold-start acceptance matrix is dishonest: %+v", coldDashboard.Acceptance)
	}
	for _, recommendation := range coldDashboard.Recommendations {
		if recommendation.Kind != "校准" || recommendation.Reason == "" {
			t.Fatalf("cold-start recommendation must explain calibration: %+v", recommendation)
		}
	}

	dashboard, err := service.Dashboard(context.Background(), []TrainingSignal{{
		ProblemID: 101, Platform: "nssctf-web", Category: "Web", Succeeded: true,
		Attempts: 1, IndependentSteps: 2,
		Verification: TrainingVerificationPlatformJudge,
	}})
	if err != nil {
		t.Fatalf("build dashboard: %v", err)
	}
	if dashboard.CatalogTotal != 10 || len(dashboard.Dimensions) != 6 {
		t.Fatalf("unexpected dashboard %+v", dashboard)
	}
	if dashboard.Dimensions[0].Key != "web" || dashboard.Dimensions[0].Score <= dashboard.Dimensions[1].Score {
		t.Fatalf("expected solved Web signal to raise Web ability: %+v", dashboard.Dimensions)
	}
	if dashboard.OverallScore != dashboard.Dimensions[0].Score || dashboard.OverallConfidence <= 0 {
		t.Fatalf("overall ability must use calibrated axes and report confidence: %+v", dashboard)
	}
	if dashboard.RealAttemptCount != 1 ||
		dashboard.RealSolvedCount != 1 ||
		dashboard.JudgeVerifiedSolvedCount != 1 ||
		dashboard.UserConfirmedSolvedCount != 0 ||
		len(dashboard.Sources) != 1 ||
		dashboard.Sources[0].Key != "nssctf" ||
		dashboard.Sources[0].Attempts != 1 ||
		dashboard.Sources[0].Solved != 1 ||
		dashboard.Sources[0].JudgeVerifiedSolved != 1 {
		t.Fatalf("dashboard must expose real training provenance: %+v", dashboard)
	}
	if dashboard.Acceptance.JudgeVerifiedTracks != 1 ||
		dashboard.Acceptance.Ready ||
		dashboard.Acceptance.Tracks[0].Status != TrainingAcceptanceJudgeVerified {
		t.Fatalf("single Web solve overstated multi-type acceptance: %+v", dashboard.Acceptance)
	}
	if len(dashboard.Recommendations) == 0 {
		t.Fatal("expected catalog recommendations")
	}
	for _, recommendation := range dashboard.Recommendations {
		if recommendation.Problem.PlatformID == 101 {
			t.Fatal("attempted problem was recommended again")
		}
		if recommendation.Reason == "" {
			t.Fatal("recommendation reason must be explainable")
		}
	}
	foundCalibration := false
	for _, recommendation := range dashboard.Recommendations {
		if recommendation.Kind == "校准" {
			foundCalibration = true
		}
	}
	if !foundCalibration {
		t.Fatal("uncalibrated dimensions must be explained as calibration recommendations")
	}

	page, err := service.Search(context.Background(), CatalogQuery{Page: 2, PageSize: 3})
	if err != nil {
		t.Fatalf("page catalog: %v", err)
	}
	if page.Total != 10 || page.Page != 1 || page.PageSize != 20 || page.PageCount != 1 ||
		len(page.Problems) != 10 {
		t.Fatalf("unsupported page size was not normalized: %+v", page)
	}
	page, err = service.Search(context.Background(), CatalogQuery{Page: 2, PageSize: 10})
	if err != nil {
		t.Fatalf("page catalog with supported size: %v", err)
	}
	if page.Total != 10 || page.Page != 1 || page.PageSize != 10 || page.PageCount != 1 ||
		len(page.Problems) != 10 || len(page.Categories) != 10 {
		t.Fatalf("unexpected catalog page: %+v", page)
	}
	if _, err := service.db.ExecContext(context.Background(), `
		INSERT INTO catalog_problems (
			platform_id, source_url, title, category, points, difficulty, tags_json,
			has_writeup, solved_count, wrong_answer_count, no_answer_count, is_open, synced_at, sync_run
		)
		SELECT 1101, 'https://www.nssctf.cn/problem/1101', 'Training 1101', category,
			points, difficulty, tags_json, has_writeup, solved_count, wrong_answer_count,
			no_answer_count, is_open, synced_at, sync_run
		FROM catalog_problems WHERE platform_id = 101
	`); err != nil {
		t.Fatalf("insert overlapping ID search fixture: %v", err)
	}
	filtered, err := service.Search(context.Background(), CatalogQuery{
		Query: "P101", Category: "Web", Page: 1, PageSize: 20,
	})
	if err != nil {
		t.Fatalf("filter catalog: %v", err)
	}
	if filtered.Total != 2 || len(filtered.Problems) != 2 ||
		filtered.Problems[0].PlatformID != 101 ||
		filtered.Problems[1].PlatformID != 1101 ||
		filtered.Problems[0].Category != "Web" {
		t.Fatalf("catalog search did not rank exact ID before partial matches: %+v", filtered)
	}
	empty, err := service.Search(context.Background(), CatalogQuery{
		Query: "not-present", Page: 99, PageSize: 20,
	})
	if err != nil {
		t.Fatalf("search empty catalog result: %v", err)
	}
	if empty.Total != 0 || empty.Page != 1 || empty.PageCount != 0 || len(empty.Problems) != 0 {
		t.Fatalf("empty catalog search returned an invalid page contract: %+v", empty)
	}
}

func TestTrainingAcceptanceRequiresJudgeEvidenceAcrossEveryTrack(t *testing.T) {
	partial := buildTrainingAcceptance([]AbilityDimension{
		{Key: "web", Label: "Web", Attempts: 1, JudgeVerifiedSolved: 1},
		{Key: "pwn", Label: "Pwn", Attempts: 1, UserConfirmedSolved: 1},
		{Key: "reverse", Label: "Reverse", Attempts: 1},
	})
	if partial.Ready ||
		partial.RequiredTracks != 6 ||
		partial.JudgeVerifiedTracks != 1 ||
		partial.Tracks[0].Status != TrainingAcceptanceJudgeVerified ||
		partial.Tracks[1].Status != TrainingAcceptanceUserConfirmed ||
		partial.Tracks[2].Status != TrainingAcceptanceAttempted ||
		partial.Tracks[3].Status != TrainingAcceptanceMissing {
		t.Fatalf("partial evidence produced an invalid acceptance matrix: %+v", partial)
	}

	verified := make([]AbilityDimension, 0, len(abilityAxes))
	for _, axis := range abilityAxes {
		verified = append(verified, AbilityDimension{
			Key: axis.Key, Label: axis.Label,
			Attempts: 1, Solved: 1, JudgeVerifiedSolved: 1,
		})
	}
	complete := buildTrainingAcceptance(verified)
	if !complete.Ready ||
		complete.RequiredTracks != 6 ||
		complete.JudgeVerifiedTracks != 6 {
		t.Fatalf("complete Judge evidence did not satisfy acceptance: %+v", complete)
	}
	for _, track := range complete.Tracks {
		if track.Status != TrainingAcceptanceJudgeVerified {
			t.Fatalf("complete acceptance retained an unverified track: %+v", complete)
		}
	}
}

func assertPrivateCatalogFiles(t *testing.T, path string) {
	t.Helper()
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

func TestTrainingSeriesUsesExplainableTitlePrefixGroups(t *testing.T) {
	problems := []CatalogProblem{
		{PlatformID: 1, Title: "[Spring CTF 2026] warmup", Category: "Web", Difficulty: 1.2},
		{PlatformID: 2, Title: "[Spring CTF 2026] crypto", Category: "Crypto", Difficulty: 2.4},
		{PlatformID: 3, Title: "[Spring CTF 2026] pwn", Category: "Pwn", Difficulty: 3.3},
		{PlatformID: 4, Title: "[Other CTF] one", Category: "Misc", Difficulty: 1.0},
		{PlatformID: 5, Title: "No prefix", Category: "Misc", Difficulty: 1.0},
	}
	series := buildTrainingSeries(problems, []TrainingSignal{{
		ProblemID: 1, Succeeded: true,
	}, {
		ProblemID: 2, Succeeded: false,
	}}, 8)
	if len(series) != 1 {
		t.Fatalf("expected one three-problem title series, got %#v", series)
	}
	if series[0].Name != "Spring CTF 2026" ||
		series[0].DerivedFrom != "title-prefix" ||
		series[0].ProblemCount != 3 ||
		series[0].AttemptedCount != 2 ||
		series[0].CompletedCount != 1 ||
		len(series[0].AttemptedProblemIDs) != 2 ||
		len(series[0].CompletedProblemIDs) != 1 ||
		series[0].NextProblemID != 2 ||
		len(series[0].Categories) != 3 ||
		series[0].Problems[0].PlatformID != 1 {
		t.Fatalf("unexpected title series: %#v", series[0])
	}
	if titleSeriesName("【新生赛】题目") != "新生赛" ||
		titleSeriesName("ordinary title") != "" {
		t.Fatal("title prefix extraction is not conservative")
	}
}

func TestCrossPlatformAbilityUsesTagsWithoutPollutingCatalogProgress(t *testing.T) {
	problems := []CatalogProblem{
		{PlatformID: 1, Title: "[Spring CTF] web", Category: "Web", Difficulty: 4},
		{PlatformID: 2, Title: "[Spring CTF] pwn", Category: "Pwn", Difficulty: 2},
		{PlatformID: 3, Title: "[Spring CTF] crypto", Category: "Crypto", Difficulty: 2},
	}
	signals := []TrainingSignal{
		{
			ProblemID: 1, Platform: "nssctf-web", Category: "Web",
			Succeeded: true, Attempts: 1,
			Verification: TrainingVerificationPlatformJudge,
		},
		{
			Platform: "ctfshow-web", Category: "Misc", Tags: []string{"pcap", "流量分析"},
			Succeeded: true, Attempts: 1, IndependentSteps: 2,
			Verification: TrainingVerificationUserConfirmed,
		},
	}
	dimensions := buildAbilityDimensions(signals, problems)
	if dimensions[0].Score <= 20 {
		t.Fatalf("known NSSCTF solve did not raise Web ability: %#v", dimensions)
	}
	var forensics AbilityDimension
	for _, dimension := range dimensions {
		if dimension.Key == "forensics" {
			forensics = dimension
		}
	}
	if forensics.Attempts != 1 || forensics.Solved != 1 || forensics.Score <= 20 {
		t.Fatalf("cross-platform tags did not classify the real solve: %#v", dimensions)
	}
	if dimensions[0].JudgeVerifiedSolved != 1 ||
		forensics.UserConfirmedSolved != 1 ||
		forensics.JudgeVerifiedSolved != 0 {
		t.Fatalf("ability dimensions lost Judge provenance: %#v", dimensions)
	}
	sources := buildTrainingSourceSummaries(signals)
	if len(sources) != 2 ||
		sources[0].Key != "nssctf" ||
		sources[0].Attempts != 1 ||
		sources[0].Solved != 1 ||
		sources[0].JudgeVerifiedSolved != 1 ||
		sources[1].Key != "ctfshow" ||
		sources[1].Attempts != 1 ||
		sources[1].Solved != 1 ||
		sources[1].UserConfirmedSolved != 1 {
		t.Fatalf("cross-platform provenance was not summarized: %#v", sources)
	}
	series := buildTrainingSeries(problems, signals, 8)
	if len(series) != 1 ||
		series[0].AttemptedCount != 1 ||
		series[0].CompletedCount != 1 {
		t.Fatalf("cross-platform signal polluted NSSCTF series progress: %#v", series)
	}
}

func TestJudgeVerifiedSolveScoresHigherThanUserConfirmedSolve(t *testing.T) {
	problems := []CatalogProblem{{
		PlatformID: 1,
		Category:   "Web",
		Difficulty: 3,
	}}
	verified := buildAbilityDimensions([]TrainingSignal{{
		ProblemID:    1,
		Platform:     "nssctf-web",
		Category:     "Web",
		Succeeded:    true,
		Attempts:     1,
		Verification: TrainingVerificationPlatformJudge,
	}}, problems)[0]
	confirmed := buildAbilityDimensions([]TrainingSignal{{
		ProblemID:    1,
		Platform:     "nssctf-web",
		Category:     "Web",
		Succeeded:    true,
		Attempts:     1,
		Verification: TrainingVerificationUserConfirmed,
	}}, problems)[0]
	if verified.Score <= confirmed.Score ||
		verified.JudgeVerifiedSolved != 1 ||
		confirmed.UserConfirmedSolved != 1 {
		t.Fatalf("Judge provenance did not affect ability confidence: verified=%#v confirmed=%#v", verified, confirmed)
	}
}

func TestRecommendationsSeparateActiveSolvedAndReviewableProblems(t *testing.T) {
	problems := []CatalogProblem{
		{PlatformID: 1, Title: "active", Category: "Web", Difficulty: 2, SolvedCount: 300},
		{PlatformID: 2, Title: "solved", Category: "Pwn", Difficulty: 2, SolvedCount: 300},
		{PlatformID: 3, Title: "failed", Category: "Crypto", Difficulty: 2, SolvedCount: 300},
		{PlatformID: 4, Title: "fresh web", Category: "Web", Difficulty: 2, SolvedCount: 300},
		{PlatformID: 5, Title: "fresh pwn", Category: "Pwn", Difficulty: 2, SolvedCount: 300},
		{PlatformID: 6, Title: "fresh reverse", Category: "Reverse", Difficulty: 2, SolvedCount: 300},
	}
	signals := []TrainingSignal{
		{ProblemID: 1, Category: "Web", State: TrainingStateActive, Attempts: 1},
		{
			ProblemID: 2, Category: "Pwn", State: TrainingStateSucceeded,
			Succeeded: true, Attempts: 1,
		},
		{
			ProblemID: 3, Category: "Crypto", State: TrainingStateFailed,
			Attempts: 1, Hints: 2, IndependentSteps: 1,
		},
	}
	dimensions := buildAbilityDimensions(signals, problems)
	recommendations := buildRecommendations(dimensions, signals, problems, 6)
	if len(recommendations) != 4 {
		t.Fatalf("unexpected recommendation count: %#v", recommendations)
	}
	reviewCount := 0
	for _, recommendation := range recommendations {
		switch recommendation.Problem.PlatformID {
		case 1:
			t.Fatal("active problem was recommended again")
		case 2:
			t.Fatal("solved problem was recommended again")
		case 3:
			reviewCount++
			if recommendation.Kind != "复盘" ||
				!strings.Contains(recommendation.Reason, "使用 2 条提示") ||
				!strings.Contains(recommendation.Reason, "完成 1 个独立步骤") {
				t.Fatalf("review recommendation lost its learning evidence: %#v", recommendation)
			}
		}
	}
	if reviewCount != 1 {
		t.Fatalf("expected exactly one review recommendation, got %#v", recommendations)
	}
	if recommendations[2].Problem.PlatformID != 3 {
		t.Fatalf("review must follow two fresh choices: %#v", recommendations)
	}
}

func TestRecommendationsCapReviewCandidatesAtOne(t *testing.T) {
	problems := []CatalogProblem{
		{PlatformID: 1, Title: "failed web", Category: "Web", Difficulty: 2},
		{PlatformID: 2, Title: "failed pwn", Category: "Pwn", Difficulty: 2},
		{PlatformID: 3, Title: "fresh", Category: "Misc", Difficulty: 2},
	}
	signals := []TrainingSignal{
		{ProblemID: 1, Category: "Web", State: TrainingStateFailed, Attempts: 1},
		{ProblemID: 2, Category: "Pwn", State: TrainingStateFailed, Attempts: 1},
	}
	recommendations := buildRecommendations(
		buildAbilityDimensions(signals, problems),
		signals,
		problems,
		6,
	)
	reviewCount := 0
	for _, recommendation := range recommendations {
		if recommendation.Kind == "复盘" {
			reviewCount++
		}
	}
	if reviewCount != 1 {
		t.Fatalf("training feed must contain at most one review: %#v", recommendations)
	}
}

func TestTrainingSourceSummariesMergeAdaptersAndIgnoreLocalSignals(t *testing.T) {
	sources := buildTrainingSourceSummaries([]TrainingSignal{
		{Platform: "nssctf-web", Attempts: 1, Succeeded: true},
		{Platform: "nssctf-agent-arena", Attempts: 2},
		{Platform: "ctfshow-web", Attempts: 1},
		{Platform: "", Attempts: 99, Succeeded: true},
	})
	if len(sources) != 2 {
		t.Fatalf("unexpected training sources: %#v", sources)
	}
	if sources[0] != (TrainingSourceSummary{
		Key: "nssctf", Label: "NSSCTF", Attempts: 3, Solved: 1,
	}) {
		t.Fatalf("NSSCTF adapters were not merged: %#v", sources[0])
	}
	if sources[1] != (TrainingSourceSummary{
		Key: "ctfshow", Label: "CTFshow", Attempts: 1, Solved: 0,
	}) {
		t.Fatalf("unexpected CTFshow summary: %#v", sources[1])
	}
}

func TestUnknownCrossPlatformDifficultyDoesNotDiluteKnownSolveDifficulty(t *testing.T) {
	problems := []CatalogProblem{{
		PlatformID: 1, Category: "Web", Difficulty: 5,
	}}
	knownOnly := buildAbilityDimensions([]TrainingSignal{{
		ProblemID: 1, Category: "Web", Succeeded: true, Attempts: 1,
	}}, problems)[0]
	withUnknown := buildAbilityDimensions([]TrainingSignal{
		{ProblemID: 1, Category: "Web", Succeeded: true, Attempts: 1},
		{Platform: "hackthebox", Category: "Web", Succeeded: true, Attempts: 1},
	}, problems)[0]
	if withUnknown.Score < knownOnly.Score {
		t.Fatalf(
			"unknown external difficulty diluted a known hard solve: known=%#v mixed=%#v",
			knownOnly,
			withUnknown,
		)
	}
}

func TestTrainingSeriesPlacesUnknownDifficultyAfterKnownProblems(t *testing.T) {
	problems := []CatalogProblem{
		{PlatformID: 1, Title: "[Order CTF] unknown", Category: "Misc", Difficulty: 0},
		{PlatformID: 2, Title: "[Order CTF] warmup", Category: "Web", Difficulty: 2},
		{PlatformID: 3, Title: "[Order CTF] challenge", Category: "Pwn", Difficulty: 3},
	}
	series := buildTrainingSeries(problems, nil, 8)
	if len(series) != 1 ||
		series[0].Problems[0].PlatformID != 2 ||
		series[0].Problems[2].PlatformID != 1 ||
		series[0].NextProblemID != 2 ||
		series[0].AverageDifficulty != 2.5 {
		t.Fatalf("unknown difficulty distorted training order: %#v", series)
	}
}

func TestTrainingSeriesReturnsCompleteProblemDirectory(t *testing.T) {
	problems := make([]CatalogProblem, 0, 65)
	for problemID := 1; problemID <= 65; problemID++ {
		problems = append(problems, CatalogProblem{
			PlatformID: problemID,
			Title:      fmt.Sprintf("[Complete CTF] Problem %02d", problemID),
			Category:   "Misc",
			Difficulty: float64(problemID),
		})
	}
	series := buildTrainingSeries(problems, nil, 8)
	if len(series) != 1 || series[0].ProblemCount != 65 || len(series[0].Problems) != 65 {
		t.Fatalf("series directory was truncated: %#v", series)
	}
}

func TestCatalogSyncRetriesRateLimitAndPreservesLastCompleteSnapshot(t *testing.T) {
	requests := 0
	server := httptest.NewTLSServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		requests++
		writer.Header().Set("Content-Type", "application/json")
		if requests == 1 {
			fmt.Fprint(writer, `{"code":429,"message":"rate limited"}`)
			return
		}
		var filters struct {
			Type int `json:"type"`
		}
		if err := json.NewDecoder(request.Body).Decode(&filters); err != nil {
			t.Fatalf("decode filters: %v", err)
		}
		fmt.Fprintf(writer, `{
			"code": 200,
			"data": {
				"problems": [{
					"id": %d,
					"title": "[Retry CTF] Training %d",
					"tag": ["retry"],
					"wp": false,
					"point": 100,
					"info": {"solved": 10, "wrong": 1, "no": 2},
					"level": 2.0,
					"open": true
				}],
				"total": 1
			}
		}`, 200+filters.Type, filters.Type)
	}))
	defer server.Close()

	service, err := newCatalogService(
		filepath.Join(t.TempDir(), "catalog.sqlite3"),
		NewClient(ClientOptions{BaseURL: server.URL, HTTPClient: server.Client()}),
		CatalogServiceOptions{
			RequestDelay:         0,
			RateLimitRetryDelays: []time.Duration{0},
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	defer service.Close()

	first, err := service.Sync(context.Background(), "https://www.nssctf.cn/problem")
	if err != nil {
		t.Fatalf("rate-limited sync did not retry: %v", err)
	}
	if first.Total != 10 || requests != 11 {
		t.Fatalf("unexpected retried sync: result=%+v requests=%d", first, requests)
	}
	before, err := service.Dashboard(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	if before.CatalogTotal != 10 || before.LastSyncedAt == "" {
		t.Fatalf("complete snapshot was not committed: %+v", before)
	}

	blocked := httptest.NewTLSServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		fmt.Fprint(writer, `{"code":429,"message":"still rate limited"}`)
	}))
	defer blocked.Close()
	service.client = NewClient(ClientOptions{BaseURL: blocked.URL, HTTPClient: blocked.Client()})
	service.retryDelays = nil
	if _, err := service.Sync(context.Background(), "https://www.nssctf.cn/problem"); err == nil {
		t.Fatal("expected exhausted rate limit to fail")
	}
	after, err := service.Dashboard(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	if after.CatalogTotal != before.CatalogTotal || after.LastSyncedAt != before.LastSyncedAt {
		t.Fatalf("failed sync replaced last complete snapshot: before=%+v after=%+v", before, after)
	}
}
