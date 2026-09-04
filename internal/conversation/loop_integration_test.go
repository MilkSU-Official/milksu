package conversation

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestLoopIntegrationPersistsFlatCompositionCategories(t *testing.T) {
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	raw, err := os.ReadFile(filepath.Join(
		filepath.Dir(file),
		"..",
		"..",
		"tests",
		"fixtures",
		"loop-context-integration",
		"turn.json",
	))
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	var fixture struct {
		BilledPromptTokens int64              `json:"billedPromptTokens"`
		StoredUsage        StoredContextUsage `json:"storedUsage"`
	}
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatalf("decode fixture: %v", err)
	}

	store := &Store{directory: t.TempDir()}
	if err := store.Save(StoredConversation{
		ID:               "loop-turn-1",
		Title:            "Loop integration",
		CreatedAt:        1,
		LastContextUsage: &fixture.StoredUsage,
		Messages:         []StoredMessage{},
	}); err != nil {
		t.Fatalf("save conversation: %v", err)
	}
	got, err := store.Get("loop-turn-1")
	if err != nil {
		t.Fatalf("get conversation: %v", err)
	}
	if got.LastContextUsage == nil ||
		got.LastContextUsage.EstimatedTokens != fixture.BilledPromptTokens ||
		len(got.LastContextUsage.Categories) != 5 ||
		got.LastContextUsage.Categories[0].ID != "system" {
		t.Fatalf("stored usage did not round-trip: %#v", got.LastContextUsage)
	}
}
