package main

import (
	"path/filepath"
	"testing"
	"time"

	"github.com/MilkSU-Official/milksu/internal/engine"
	"github.com/MilkSU-Official/milksu/internal/modelusage"
)

func TestRecordCodingUsagePersistsModelAndToolEvents(t *testing.T) {
	store, err := modelusage.NewStore(filepath.Join(t.TempDir(), "usage", "model-usage.sqlite3"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	app := &App{modelUsage: store}
	now := time.Now().UTC()

	changed, err := app.recordCodingUsage(engine.Event{
		SessionID: "conversation-1", Type: "usage.recorded",
		Timestamp: now.Format(time.RFC3339Nano),
		Usage: &engine.ModelUsage{
			RecordID: "usage-1", Module: "coding", OccurredAt: now.Format(time.RFC3339Nano),
			Provider: "tokenflux", Model: "x-ai/grok-4.6", Source: "account",
			InputTokens: 250, OutputTokens: 75, CacheRead: 125,
			TotalTokens: 450, Success: true,
		},
	})
	if err != nil || !changed {
		t.Fatalf("record model usage = (%v, %v), want changed", changed, err)
	}
	changed, err = app.recordCodingUsage(engine.Event{
		SessionID: "conversation-1", Type: "tool.completed", Module: "coding",
		Timestamp: now.Add(time.Second).Format(time.RFC3339Nano),
		ToolName:  "exec_command", ToolCallID: "tool-1", DurationMS: 32,
	})
	if err != nil || !changed {
		t.Fatalf("record tool usage = (%v, %v), want changed", changed, err)
	}

	snapshot, err := app.GetCodingUsageSnapshot()
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.ModelCalls != 1 || snapshot.ToolCalls != 1 || snapshot.TotalTokens != 450 {
		t.Fatalf("unexpected Coding usage snapshot: %#v", snapshot)
	}
}

func TestRecordCodingUsageRejectsCTFRoleAndMissingToolIDs(t *testing.T) {
	store, err := modelusage.NewStore(filepath.Join(t.TempDir(), "model-usage.sqlite3"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	app := &App{modelUsage: store}

	for _, event := range []engine.Event{
		{SessionID: "ctf-1", Type: "tool.completed", Module: "ctf", ToolName: "read", ToolCallID: "tool-1"},
		{SessionID: "coding-1", Type: "tool.completed", Module: "coding", ToolName: "read"},
	} {
		changed, err := app.recordCodingUsage(event)
		if err != nil || changed {
			t.Fatalf("unexpected record result for %#v: changed=%v err=%v", event, changed, err)
		}
	}
}
