package modelcatalog

import "testing"

func TestKnownContextWindow(t *testing.T) {
	cases := []struct {
		id     string
		window int
	}{
		{"x-ai/grok-4.6", 500_000},
		{"grok-4.6", 500_000},
		{"grok-4.5", 500_000},
		{"GPT/gpt-5.6-sol", 1_050_000},
		{"openai/gpt-5.2-codex", 400_000},
		{"anthropic/claude-sonnet-4.6", 1_000_000},
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
	if got := resolveModelContextWindow("custom-unknown", 0); got != 0 {
		t.Fatalf("unknown omitted window = %d", got)
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
