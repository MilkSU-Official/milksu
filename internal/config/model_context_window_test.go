package config

import (
	"strings"
	"testing"
)

func TestResolveModelContextWindowPrefersOverride(t *testing.T) {
	settings := AppSettings{
		ModelContextWindows: map[string]map[string]int{
			"tokenflux": {"x-ai/grok-4.6": 2_000_000},
		},
	}
	if got := ResolveModelContextWindow(settings, "tokenflux", "x-ai/grok-4.6", 256_000); got != 2_000_000 {
		t.Fatalf("override did not win: %d", got)
	}
	if got := ResolveModelContextWindow(AppSettings{}, "tokenflux", "x-ai/grok-4.6", 256_000); got != 256_000 {
		t.Fatalf("catalog window was dropped: %d", got)
	}
	if got := ResolveModelContextWindow(AppSettings{}, "tokenflux", "x-ai/grok-4.6", 0); got != 0 {
		t.Fatalf("omitted catalog window = %d", got)
	}
}

func TestNormalizeModelContextWindowsDropsIllegalAndClamps(t *testing.T) {
	settings := AppSettings{
		Providers: map[string]ProviderConfig{
			"custom-relay-team": {Custom: true, Name: "Team", Models: []string{"vendor/model"}},
		},
		ModelContextWindows: map[string]map[string]int{
			"tokenflux": {
				"x-ai/grok-4.6": 2_000_000,
				"bad":           0,
				"negative":      -12,
			},
			"openai": {
				"gpt-5": 200_000,
			},
			"custom-relay-team": {
				"vendor/model": 50,
				"huge":         20_000_000,
			},
		},
	}
	normalized := withDefaults(settings)
	if got := normalized.ModelContextWindows["tokenflux"]["x-ai/grok-4.6"]; got != 2_000_000 {
		t.Fatalf("kept window = %d", got)
	}
	if _, exists := normalized.ModelContextWindows["tokenflux"]["bad"]; exists {
		t.Fatal("zero window was kept")
	}
	if _, exists := normalized.ModelContextWindows["tokenflux"]["negative"]; exists {
		t.Fatal("negative window was kept")
	}
	if _, exists := normalized.ModelContextWindows["openai"]; exists {
		t.Fatal("retired official provider override was kept")
	}
	if got := normalized.ModelContextWindows["custom-relay-team"]["vendor/model"]; got != 1024 {
		t.Fatalf("low window was not clamped: %d", got)
	}
	if got := normalized.ModelContextWindows["custom-relay-team"]["huge"]; got != 10_000_000 {
		t.Fatalf("high window was not clamped: %d", got)
	}
}

func TestEncodeModelContextWindowsOmitsEmptyAndCredentials(t *testing.T) {
	if got := EncodeModelContextWindows(AppSettings{}); got != "" {
		t.Fatalf("empty settings encoded %q", got)
	}
	settings := AppSettings{
		Providers: map[string]ProviderConfig{
			"tokenflux": {APIKey: "secret", Enabled: true},
		},
		ModelContextWindows: map[string]map[string]int{
			"tokenflux": {"grok-4.6": 200_000},
		},
	}
	encoded := EncodeModelContextWindows(settings)
	if encoded == "" || encoded == "null" {
		t.Fatalf("override was not encoded: %q", encoded)
	}
	if strings.Contains(encoded, "secret") || strings.Contains(encoded, "api_key") {
		t.Fatalf("credential leaked into window payload: %s", encoded)
	}
}
