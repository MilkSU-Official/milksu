package modelusage

import (
	"context"
	"database/sql"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestStoreRecordsIdempotentModelAndToolUsage(t *testing.T) {
	path := filepath.Join(t.TempDir(), "usage", "model-usage.sqlite3")
	store, err := NewStore(path)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	location := time.FixedZone("Asia/Singapore", 8*60*60)
	now := time.Date(2026, time.August, 14, 18, 0, 0, 0, location)
	model := Record{
		ID: "model-call-1", ConversationID: "conversation-1", Kind: KindModel,
		OccurredAt: time.Date(2026, time.August, 14, 9, 15, 0, 0, location),
		Provider:   "tokenflux", Model: "openai/gpt-5.6-sol", Source: "account",
		InputTokens: 1200, OutputTokens: 300, CacheRead: 400,
		Reasoning: 80, CostUSD: 0.25, Success: true,
	}
	if err := store.Record(context.Background(), model); err != nil {
		t.Fatal(err)
	}
	if err := store.Record(context.Background(), model); err != nil {
		t.Fatalf("idempotent model insert: %v", err)
	}
	if err := store.Record(context.Background(), Record{
		ID: "tool-call-1", ConversationID: "conversation-1", Kind: KindTool,
		OccurredAt: model.OccurredAt.Add(time.Minute), ToolName: "exec_command",
		DurationMS: 275, Success: false,
	}); err != nil {
		t.Fatal(err)
	}

	snapshot, err := store.Snapshot(context.Background(), now)
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.ActiveDays != 1 || snapshot.ModelCalls != 1 || snapshot.ToolCalls != 1 {
		t.Fatalf("unexpected counters: %#v", snapshot)
	}
	if snapshot.TotalTokens != 1900 || snapshot.InputTokens != 1200 || snapshot.CacheRead != 400 {
		t.Fatalf("unexpected token totals: %#v", snapshot)
	}
	if len(snapshot.Days) != 1 || snapshot.Days[0].Date != "2026-08-14" {
		t.Fatalf("unexpected days: %#v", snapshot.Days)
	}
	day := snapshot.Days[0]
	if len(day.Models) != 1 || day.Models[0].Calls != 1 || day.Models[0].Source != "account" {
		t.Fatalf("unexpected model breakdown: %#v", day.Models)
	}
	if len(day.Tools) != 1 || day.Tools[0].Name != "exec_command" || day.Tools[0].Failures != 1 {
		t.Fatalf("unexpected tool breakdown: %#v", day.Tools)
	}
}

func TestStoreKeepsDaysInTheCallerLocation(t *testing.T) {
	store, err := NewStore(filepath.Join(t.TempDir(), "model-usage.sqlite3"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	if err := store.Record(context.Background(), Record{
		ID: "utc-boundary", ConversationID: "conversation-1", Kind: KindModel,
		OccurredAt: time.Date(2026, time.August, 13, 17, 30, 0, 0, time.UTC),
		Provider:   "tokenflux", Model: "x-ai/grok-4.6", Source: "personal",
		InputTokens: 10, OutputTokens: 5, Success: true,
	}); err != nil {
		t.Fatal(err)
	}
	location := time.FixedZone("Asia/Singapore", 8*60*60)
	snapshot, err := store.Snapshot(
		context.Background(),
		time.Date(2026, time.August, 14, 12, 0, 0, 0, location),
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(snapshot.Days) != 1 || snapshot.Days[0].Date != "2026-08-14" {
		t.Fatalf("usage day did not follow local time: %#v", snapshot.Days)
	}
}

func TestStoreUsesNumberedMigrationAndRejectsInvalidRecords(t *testing.T) {
	store, err := NewStore(filepath.Join(t.TempDir(), "model-usage.sqlite3"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	var (
		version int
		name    string
	)
	if err := store.db.QueryRow(
		`SELECT version, name FROM schema_migrations`,
	).Scan(&version, &name); err != nil {
		t.Fatal(err)
	}
	if version != SupportedDatabaseVersion || name != usageV1MigrationName {
		t.Fatalf("unexpected migration history: %d %q", version, name)
	}

	err = store.Record(context.Background(), Record{
		ID: "invalid", ConversationID: "conversation-1", Kind: KindModel,
		OccurredAt: time.Now(), InputTokens: -1,
	})
	if err == nil || !strings.Contains(err.Error(), "requires a model") {
		t.Fatalf("invalid record error = %v", err)
	}
}

func TestStoreSchemaContainsNoPromptOrOutputColumns(t *testing.T) {
	store, err := NewStore(filepath.Join(t.TempDir(), "model-usage.sqlite3"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	rows, err := store.db.Query(`PRAGMA table_info(usage_events)`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	columns := make(map[string]struct{})
	for rows.Next() {
		var (
			position     int
			name         string
			columnType   string
			notNull      int
			defaultValue sql.NullString
			primaryKey   int
		)
		if err := rows.Scan(&position, &name, &columnType, &notNull, &defaultValue, &primaryKey); err != nil {
			t.Fatal(err)
		}
		columns[name] = struct{}{}
	}
	for _, forbidden := range []string{"prompt", "response", "content", "arguments", "output", "path"} {
		if _, exists := columns[forbidden]; exists {
			t.Fatalf("usage ledger unexpectedly contains %q column", forbidden)
		}
	}
}
