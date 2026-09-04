package modelcatalog

import (
	"testing"

	"github.com/MilkSU-Official/milksu/internal/config"
)

func TestKnownContextWindow(t *testing.T) {
	cases := []struct {
		id     string
		window int
	}{
		{"x-ai/grok-4.6", 500_000},
		{"grok-4.6", 500_000},
		{"grok-4.5", 500_000},
		{"GPT/gpt-5.6-sol", 1_050_000},
		{"openai/gpt-5.5", 1_050_000},
		{"openai/gpt-5.4", 1_050_000},
		{"openai/gpt-5.4-mini", 400_000},
		{"openai/gpt-5.3-chat-latest", 128_000},
		{"openai/gpt-5.3-codex", 400_000},
		{"openai/gpt-5.2-codex", 400_000},
		{"openai/gpt-5-mini", 400_000},
		{"openai/gpt-4.1-mini", 1_047_576},
		{"openai/gpt-4o-mini", 128_000},
		{"anthropic/claude-sonnet-4.6", 1_000_000},
		{"anthropic/claude-sonnet-5", 1_000_000},
		{"anthropic/claude-opus-4-8", 1_000_000},
		{"anthropic/claude-opus-4-6", 1_000_000},
		{"anthropic/claude-sonnet-4.5", 200_000},
		{"anthropic/claude-haiku-4-5", 200_000},
		{"x-ai/grok-4-fast-reasoning", 1_000_000},
		{"x-ai/grok-build-0.1", 256_000},
		{"unknown-model", 0},
	}
	for _, test := range cases {
		if got := knownContextWindow(test.id); got != test.window {
			t.Fatalf("%s: known window = %d, want %d", test.id, got, test.window)
		}
	}
}

func TestResolveModelContextWindowPrefersCatalogUnlessPlaceholder(t *testing.T) {
	if got := resolveModelContextWindow("grok-4.6", 0); got != 500_000 {
		t.Fatalf("omitted catalog window = %d", got)
	}
	if got := resolveModelContextWindow("grok-4.6", 128_000); got != 500_000 {
		t.Fatalf("128k placeholder = %d", got)
	}
	if got := resolveModelContextWindow("grok-4.6", 256_000); got != 256_000 {
		t.Fatalf("explicit catalog window was replaced: %d", got)
	}
	if got := resolveModelContextWindow("custom-128k", 128_000); got != 128_000 {
		t.Fatalf("unknown 128k model = %d", got)
	}
	if got := resolveModelContextWindow("claude-sonnet-4.5", 128_000); got != 200_000 {
		t.Fatalf("Claude family preset = %d", got)
	}
	if got := resolveModelContextWindow("custom-unknown", 0); got != 0 {
		t.Fatalf("unknown omitted window = %d", got)
	}
}

func TestApplyKnownContextWindowsUsesSettingsOverride(t *testing.T) {
	models := []Model{
		{ID: "x-ai/grok-4.6", Name: "Grok 4.6", ContextWindow: 128_000},
		{ID: "custom-unknown", Name: "Custom", ContextWindow: 0},
	}
	settings := config.AppSettings{
		ModelContextWindows: map[string]map[string]int{
			"tokenflux": {
				"x-ai/grok-4.6":  2_000_000,
				"custom-unknown": 64_000,
			},
		},
	}
	applyKnownContextWindows(models, settings)
	if models[0].ContextWindow != 2_000_000 {
		t.Fatalf("override did not replace family preset: %d", models[0].ContextWindow)
	}
	if models[1].ContextWindow != 64_000 {
		t.Fatalf("override did not fill unknown model: %d", models[1].ContextWindow)
	}

	fresh := []Model{{ID: "x-ai/grok-4.6", Name: "Grok 4.6", ContextWindow: 128_000}}
	applyKnownContextWindows(fresh, config.AppSettings{})
	if fresh[0].ContextWindow != 500_000 {
		t.Fatalf("known window without override = %d", fresh[0].ContextWindow)
	}
}

func TestSnapshotAppliesCurrentContextWindowOverride(t *testing.T) {
	settings := config.DefaultSettings()
	settings.ModelContextWindows = map[string]map[string]int{
		"tokenflux": {"x-ai/grok-4.6": 2_000_000},
	}
	service, err := New(t.TempDir(), func() config.AppSettings { return settings }, Options{})
	if err != nil {
		t.Fatal(err)
	}
	snapshot := service.Snapshot()
	var window int
	for _, model := range snapshot.Models {
		if model.ID == "x-ai/grok-4.6" {
			window = model.ContextWindow
			break
		}
	}
	if window != 2_000_000 {
		t.Fatalf("snapshot window = %d", window)
	}
}

func TestNormalizeModelsFillsKnownWindowWhenCatalogOmitsLength(t *testing.T) {
	models := normalizeModels([]catalogModelRaw{
		{ID: "grok-4.6", Name: "Grok 4.6"},
		{ID: "custom-128k", Name: "Custom", ContextLength: 128_000},
		{ID: "qwen/qwen3-coder-plus", Name: "Qwen", ContextWindow: 1_000_000},
	})
	byID := map[string]int{}
	for _, model := range models {
		byID[model.ID] = model.ContextWindow
	}
	if byID["grok-4.6"] != 500_000 {
		t.Fatalf("grok-4.6 window = %d", byID["grok-4.6"])
	}
	if byID["custom-128k"] != 128_000 {
		t.Fatalf("unknown 128k window = %d", byID["custom-128k"])
	}
	if byID["qwen/qwen3-coder-plus"] != 1_000_000 {
		t.Fatalf("explicit window = %d", byID["qwen/qwen3-coder-plus"])
	}
}
