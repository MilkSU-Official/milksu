package engine

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/MilkSU-Official/milksu/internal/config"
)

type loopIntegrationFixture struct {
	Provider           string             `json:"provider"`
	Model              string             `json:"model"`
	CatalogWindow      int                `json:"catalogWindow"`
	OverrideWindow     int                `json:"overrideWindow"`
	BilledPromptTokens int64              `json:"billedPromptTokens"`
	ContextComposition ContextComposition `json:"contextComposition"`
	SubagentTasks      []SubagentTask     `json:"subagentTasks"`
	Forbidden          []string           `json:"forbidden"`
}

func loadLoopIntegrationFixture(t *testing.T) loopIntegrationFixture {
	t.Helper()
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	path := filepath.Join(filepath.Dir(file), "..", "..", "tests", "fixtures", "loop-context-integration", "turn.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	var fixture loopIntegrationFixture
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatalf("decode fixture: %v", err)
	}
	return fixture
}

func TestLoopIntegrationProjectsOneTurnWithoutSecrets(t *testing.T) {
	fixture := loadLoopIntegrationFixture(t)
	window := config.ResolveModelContextWindow(config.AppSettings{
		ModelContextWindows: map[string]map[string]int{
			fixture.Provider: {fixture.Model: fixture.OverrideWindow},
		},
	}, fixture.Provider, fixture.Model, fixture.CatalogWindow)
	if window != fixture.OverrideWindow {
		t.Fatalf("override window: got %d want %d", window, fixture.OverrideWindow)
	}

	composition := normalizeBridgeEvent(bridgeEvent{
		Type:               "context_composition",
		ID:                 "session-1",
		ContextComposition: &fixture.ContextComposition,
	})
	if composition.Type != "context.composition" ||
		composition.ContextComposition == nil ||
		composition.ContextComposition.EstimatedTokens != fixture.BilledPromptTokens ||
		composition.Usage != nil {
		t.Fatalf("unexpected composition event: %#v", composition)
	}

	roster := normalizeBridgeEvent(bridgeEvent{
		Type:          "subagent_tasks",
		ID:            "session-1",
		SubagentTasks: fixture.SubagentTasks,
	})
	if roster.Type != "runtime.subagent_tasks" ||
		len(roster.SubagentTasks) != 1 ||
		roster.SubagentTasks[0].ToolCallID != "call-1" ||
		roster.SubagentTasks[0].Yield == nil ||
		len(roster.SubagentTasks[0].Yield.Files) != 1 ||
		roster.SubagentTasks[0].Yield.Files[0] != "a.ts" {
		t.Fatalf("unexpected roster event: %#v", roster)
	}

	payload, err := json.Marshal(struct {
		Composition Event
		Roster      Event
	}{composition, roster})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	text := string(payload)
	for _, needle := range fixture.Forbidden {
		if needle != "" && strings.Contains(text, needle) {
			t.Fatalf("payload contained %q", needle)
		}
	}
}
