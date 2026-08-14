package modelusage

import (
	"context"
	"database/sql"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/MilkSU-Official/milksu/internal/sqlitemigrate"
)

const (
	// SupportedDatabaseVersion is the numbered migration version recorded for
	// the local Coding Agent usage ledger.
	SupportedDatabaseVersion = 1

	usageV1MigrationName = "create Coding Agent usage ledger"
	maximumTextRunes     = 512
	maximumTokenCount    = int64(1_000_000_000_000)
)

type Kind string

const (
	KindModel Kind = "model"
	KindTool  Kind = "tool"
)

// Record is a credential-free projection of one real Coding Agent model call
// or completed tool call. It deliberately excludes prompts, responses, tool
// arguments, tool output, paths and Provider request headers.
type Record struct {
	ID             string
	ConversationID string
	Kind           Kind
	OccurredAt     time.Time
	Provider       string
	Model          string
	Source         string
	ToolName       string
	InputTokens    int64
	OutputTokens   int64
	CacheRead      int64
	CacheWrite     int64
	Reasoning      int64
	TotalTokens    int64
	CostUSD        float64
	DurationMS     int64
	Success        bool
}

type ModelBreakdown struct {
	Provider     string  `json:"provider"`
	Model        string  `json:"model"`
	Source       string  `json:"source"`
	InputTokens  int64   `json:"inputTokens"`
	OutputTokens int64   `json:"outputTokens"`
	CacheRead    int64   `json:"cacheReadTokens"`
	CacheWrite   int64   `json:"cacheWriteTokens"`
	Reasoning    int64   `json:"reasoningTokens"`
	TotalTokens  int64   `json:"totalTokens"`
	CostUSD      float64 `json:"costUsd"`
	Calls        int     `json:"calls"`
}

type ToolBreakdown struct {
	Name       string `json:"name"`
	Calls      int    `json:"calls"`
	Failures   int    `json:"failures"`
	DurationMS int64  `json:"durationMs"`
}

type Day struct {
	Date         string           `json:"date"`
	InputTokens  int64            `json:"inputTokens"`
	OutputTokens int64            `json:"outputTokens"`
	CacheRead    int64            `json:"cacheReadTokens"`
	CacheWrite   int64            `json:"cacheWriteTokens"`
	Reasoning    int64            `json:"reasoningTokens"`
	TotalTokens  int64            `json:"totalTokens"`
	CostUSD      float64          `json:"costUsd"`
	ModelCalls   int              `json:"modelCalls"`
	ToolCalls    int              `json:"toolCalls"`
	Models       []ModelBreakdown `json:"models"`
	Tools        []ToolBreakdown  `json:"tools"`
	modelIndex   map[string]int
	toolIndex    map[string]int
}

type Snapshot struct {
	From         string `json:"from"`
	To           string `json:"to"`
	ActiveDays   int    `json:"activeDays"`
	ModelCalls   int    `json:"modelCalls"`
	ToolCalls    int    `json:"toolCalls"`
	InputTokens  int64  `json:"inputTokens"`
	OutputTokens int64  `json:"outputTokens"`
	CacheRead    int64  `json:"cacheReadTokens"`
	CacheWrite   int64  `json:"cacheWriteTokens"`
	Reasoning    int64  `json:"reasoningTokens"`
	TotalTokens  int64  `json:"totalTokens"`
	Days         []Day  `json:"days"`
}

type Store struct {
	db   *sql.DB
	path string
}

func NewStore(path string) (*Store, error) {
	directory := filepath.Dir(path)
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return nil, fmt.Errorf("create Coding Agent usage directory: %w", err)
	}
	if err := os.Chmod(directory, 0o700); err != nil {
		return nil, fmt.Errorf("secure Coding Agent usage directory: %w", err)
	}
	migrator, err := sqlitemigrate.Open(
		path,
		[]sqlitemigrate.Migration{{
			Version: 1,
			Name:    usageV1MigrationName,
			Up:      usageV1Up,
		}},
		sqlitemigrate.WithPragmas([]string{"PRAGMA journal_mode = WAL"}),
	)
	if err != nil {
		return nil, fmt.Errorf("open Coding Agent usage ledger: %w", err)
	}
	if err := migrator.Migrate(context.Background()); err != nil {
		_ = migrator.Close()
		return nil, fmt.Errorf("migrate Coding Agent usage ledger: %w", err)
	}
	service := &Store{db: migrator.DB(), path: path}
	if err := protectSQLiteFiles(path); err != nil {
		_ = service.db.Close()
		return nil, fmt.Errorf("secure Coding Agent usage ledger: %w", err)
	}
	return service, nil
}

func usageV1Up(ctx context.Context, tx *sql.Tx) error {
	statements := []string{
		`CREATE TABLE IF NOT EXISTS usage_events (
			id TEXT PRIMARY KEY,
			conversation_id TEXT NOT NULL,
			kind TEXT NOT NULL CHECK(kind IN ('model', 'tool')),
			occurred_at_ms INTEGER NOT NULL,
			provider TEXT NOT NULL,
			model TEXT NOT NULL,
			source TEXT NOT NULL,
			tool_name TEXT NOT NULL,
			input_tokens INTEGER NOT NULL,
			output_tokens INTEGER NOT NULL,
			cache_read_tokens INTEGER NOT NULL,
			cache_write_tokens INTEGER NOT NULL,
			reasoning_tokens INTEGER NOT NULL,
			total_tokens INTEGER NOT NULL,
			cost_usd REAL NOT NULL,
			duration_ms INTEGER NOT NULL,
			success INTEGER NOT NULL CHECK(success IN (0, 1))
		)`,
		`CREATE INDEX IF NOT EXISTS usage_events_occurred_at
			ON usage_events(occurred_at_ms, kind)`,
		`CREATE INDEX IF NOT EXISTS usage_events_model
			ON usage_events(model, source, occurred_at_ms)`,
		`CREATE INDEX IF NOT EXISTS usage_events_tool
			ON usage_events(tool_name, occurred_at_ms)`,
	}
	for _, statement := range statements {
		if _, err := tx.ExecContext(ctx, statement); err != nil {
			return fmt.Errorf("create Coding Agent usage schema: %w", err)
		}
	}
	return nil
}

func (s *Store) Record(ctx context.Context, record Record) error {
	normalized, err := normalizeRecord(record)
	if err != nil {
		return err
	}
	success := 0
	if normalized.Success {
		success = 1
	}
	_, err = s.db.ExecContext(ctx, `INSERT OR IGNORE INTO usage_events (
		id, conversation_id, kind, occurred_at_ms, provider, model, source,
		tool_name, input_tokens, output_tokens, cache_read_tokens,
		cache_write_tokens, reasoning_tokens, total_tokens, cost_usd,
		duration_ms, success
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		normalized.ID,
		normalized.ConversationID,
		normalized.Kind,
		normalized.OccurredAt.UTC().UnixMilli(),
		normalized.Provider,
		normalized.Model,
		normalized.Source,
		normalized.ToolName,
		normalized.InputTokens,
		normalized.OutputTokens,
		normalized.CacheRead,
		normalized.CacheWrite,
		normalized.Reasoning,
		normalized.TotalTokens,
		normalized.CostUSD,
		normalized.DurationMS,
		success,
	)
	if err != nil {
		return fmt.Errorf("record Coding Agent usage: %w", err)
	}
	return nil
}

func normalizeRecord(record Record) (Record, error) {
	record.ID = strings.TrimSpace(record.ID)
	record.ConversationID = strings.TrimSpace(record.ConversationID)
	record.Provider = trimBounded(record.Provider)
	record.Model = trimBounded(record.Model)
	record.Source = strings.ToLower(trimBounded(record.Source))
	record.ToolName = trimBounded(record.ToolName)
	if record.ID == "" || len([]rune(record.ID)) > maximumTextRunes {
		return Record{}, fmt.Errorf("usage record id is required and must be bounded")
	}
	if record.ConversationID == "" || len([]rune(record.ConversationID)) > 128 {
		return Record{}, fmt.Errorf("usage conversation id is required and must be bounded")
	}
	if record.OccurredAt.IsZero() {
		return Record{}, fmt.Errorf("usage occurrence time is required")
	}
	switch record.Kind {
	case KindModel:
		if record.Model == "" {
			return Record{}, fmt.Errorf("model usage record requires a model")
		}
		record.ToolName = ""
	case KindTool:
		if record.ToolName == "" {
			return Record{}, fmt.Errorf("tool usage record requires a tool name")
		}
		record.Provider = ""
		record.Model = ""
		record.Source = ""
		record.InputTokens = 0
		record.OutputTokens = 0
		record.CacheRead = 0
		record.CacheWrite = 0
		record.Reasoning = 0
		record.TotalTokens = 0
		record.CostUSD = 0
	default:
		return Record{}, fmt.Errorf("unsupported usage record kind %q", record.Kind)
	}
	for label, value := range map[string]int64{
		"input tokens": record.InputTokens, "output tokens": record.OutputTokens,
		"cache read tokens": record.CacheRead, "cache write tokens": record.CacheWrite,
		"reasoning tokens": record.Reasoning, "total tokens": record.TotalTokens,
		"duration": record.DurationMS,
	} {
		if value < 0 || value > maximumTokenCount {
			return Record{}, fmt.Errorf("usage %s is outside the supported range", label)
		}
	}
	if math.IsNaN(record.CostUSD) || math.IsInf(record.CostUSD, 0) || record.CostUSD < 0 || record.CostUSD > 1_000_000 {
		return Record{}, fmt.Errorf("usage cost is outside the supported range")
	}
	if record.Kind == KindModel && record.TotalTokens == 0 {
		record.TotalTokens = record.InputTokens + record.OutputTokens + record.CacheRead + record.CacheWrite
		if record.TotalTokens > maximumTokenCount {
			return Record{}, fmt.Errorf("usage total tokens are outside the supported range")
		}
	}
	return record, nil
}

func trimBounded(value string) string {
	runes := []rune(strings.TrimSpace(value))
	if len(runes) > maximumTextRunes {
		runes = runes[:maximumTextRunes]
	}
	return string(runes)
}

func (s *Store) Snapshot(ctx context.Context, now time.Time) (Snapshot, error) {
	if now.IsZero() {
		now = time.Now()
	}
	location := now.Location()
	if location == nil {
		location = time.Local
	}
	tomorrow := time.Date(now.Year(), now.Month(), now.Day()+1, 0, 0, 0, 0, location)
	from := tomorrow.AddDate(0, 0, -365)
	rows, err := s.db.QueryContext(ctx, `SELECT
		kind, occurred_at_ms, provider, model, source, tool_name,
		input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
		reasoning_tokens, total_tokens, cost_usd, duration_ms, success
		FROM usage_events
		WHERE occurred_at_ms >= ? AND occurred_at_ms < ?
		ORDER BY occurred_at_ms ASC, id ASC`, from.UTC().UnixMilli(), tomorrow.UTC().UnixMilli())
	if err != nil {
		return Snapshot{}, fmt.Errorf("query Coding Agent usage: %w", err)
	}
	defer rows.Close()

	snapshot := Snapshot{
		From: from.Format("2006-01-02"),
		To:   tomorrow.AddDate(0, 0, -1).Format("2006-01-02"),
		Days: make([]Day, 0),
	}
	dayIndex := make(map[string]int)
	for rows.Next() {
		var (
			kind         Kind
			occurredAtMS int64
			provider     string
			model        string
			source       string
			toolName     string
			inputTokens  int64
			outputTokens int64
			cacheRead    int64
			cacheWrite   int64
			reasoning    int64
			totalTokens  int64
			costUSD      float64
			durationMS   int64
			success      int
		)
		if err := rows.Scan(
			&kind,
			&occurredAtMS,
			&provider,
			&model,
			&source,
			&toolName,
			&inputTokens,
			&outputTokens,
			&cacheRead,
			&cacheWrite,
			&reasoning,
			&totalTokens,
			&costUSD,
			&durationMS,
			&success,
		); err != nil {
			return Snapshot{}, fmt.Errorf("scan Coding Agent usage: %w", err)
		}
		date := time.UnixMilli(occurredAtMS).In(location).Format("2006-01-02")
		index, exists := dayIndex[date]
		if !exists {
			index = len(snapshot.Days)
			dayIndex[date] = index
			snapshot.Days = append(snapshot.Days, Day{
				Date:       date,
				Models:     make([]ModelBreakdown, 0),
				Tools:      make([]ToolBreakdown, 0),
				modelIndex: make(map[string]int),
				toolIndex:  make(map[string]int),
			})
		}
		day := &snapshot.Days[index]
		switch kind {
		case KindModel:
			day.InputTokens += inputTokens
			day.OutputTokens += outputTokens
			day.CacheRead += cacheRead
			day.CacheWrite += cacheWrite
			day.Reasoning += reasoning
			day.TotalTokens += totalTokens
			day.CostUSD += costUSD
			day.ModelCalls++
			snapshot.InputTokens += inputTokens
			snapshot.OutputTokens += outputTokens
			snapshot.CacheRead += cacheRead
			snapshot.CacheWrite += cacheWrite
			snapshot.Reasoning += reasoning
			snapshot.TotalTokens += totalTokens
			snapshot.ModelCalls++
			key := provider + "\x00" + model + "\x00" + source
			modelPosition, found := day.modelIndex[key]
			if !found {
				modelPosition = len(day.Models)
				day.modelIndex[key] = modelPosition
				day.Models = append(day.Models, ModelBreakdown{
					Provider: provider,
					Model:    model,
					Source:   source,
				})
			}
			breakdown := &day.Models[modelPosition]
			breakdown.InputTokens += inputTokens
			breakdown.OutputTokens += outputTokens
			breakdown.CacheRead += cacheRead
			breakdown.CacheWrite += cacheWrite
			breakdown.Reasoning += reasoning
			breakdown.TotalTokens += totalTokens
			breakdown.CostUSD += costUSD
			breakdown.Calls++
		case KindTool:
			day.ToolCalls++
			snapshot.ToolCalls++
			toolPosition, found := day.toolIndex[toolName]
			if !found {
				toolPosition = len(day.Tools)
				day.toolIndex[toolName] = toolPosition
				day.Tools = append(day.Tools, ToolBreakdown{Name: toolName})
			}
			breakdown := &day.Tools[toolPosition]
			breakdown.Calls++
			breakdown.DurationMS += durationMS
			if success == 0 {
				breakdown.Failures++
			}
		}
	}
	if err := rows.Err(); err != nil {
		return Snapshot{}, fmt.Errorf("iterate Coding Agent usage: %w", err)
	}
	for index := range snapshot.Days {
		day := &snapshot.Days[index]
		sort.Slice(day.Models, func(left, right int) bool {
			if day.Models[left].TotalTokens == day.Models[right].TotalTokens {
				return day.Models[left].Model < day.Models[right].Model
			}
			return day.Models[left].TotalTokens > day.Models[right].TotalTokens
		})
		sort.Slice(day.Tools, func(left, right int) bool {
			if day.Tools[left].Calls == day.Tools[right].Calls {
				return day.Tools[left].Name < day.Tools[right].Name
			}
			return day.Tools[left].Calls > day.Tools[right].Calls
		})
		day.modelIndex = nil
		day.toolIndex = nil
	}
	snapshot.ActiveDays = len(snapshot.Days)
	return snapshot, nil
}

func (s *Store) Close() error {
	if s == nil || s.db == nil {
		return nil
	}
	return s.db.Close()
}

func protectSQLiteFiles(path string) error {
	for _, candidate := range []string{path, path + "-wal", path + "-shm"} {
		if err := os.Chmod(candidate, 0o600); err != nil && !os.IsNotExist(err) {
			return err
		}
	}
	return nil
}
