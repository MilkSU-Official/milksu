package config

import "testing"

func TestResolveModelThinkingUsesBuiltInPresets(t *testing.T) {
	tests := []struct {
		model        string
		requested    string
		wantLevel    string
		wantContains string
	}{
		{model: "openai/gpt-5.6", requested: "max", wantLevel: "max", wantContains: "xhigh"},
		{model: "anthropic/claude-opus-4.6", requested: "max", wantLevel: "max", wantContains: "high"},
		{model: "anthropic/claude-fable-5", requested: "xhigh", wantLevel: "xhigh", wantContains: "max"},
	}
	for _, test := range tests {
		profile := ResolveModelThinking(AppSettings{}, "tokenflux", test.model, test.requested)
		if !profile.Enabled || profile.Level != test.wantLevel || !containsThinkingLevel(profile.Levels, test.wantContains) {
			t.Fatalf("ResolveModelThinking(%q) = %#v", test.model, profile)
		}
	}
}

func TestResolveModelThinkingRequiresManualOptInForOtherModels(t *testing.T) {
	settings := AppSettings{
		ModelThinking: map[string]map[string]ModelThinkingConfig{
			"tokenflux": {
				"x-ai/grok-4.6": {
					Enabled:      true,
					Levels:       []string{"low", "high"},
					DefaultLevel: "high",
				},
			},
		},
	}
	if profile := ResolveModelThinking(AppSettings{}, "tokenflux", "x-ai/grok-4.6", "high"); profile.Enabled {
		t.Fatalf("unexpected built-in Grok thinking profile: %#v", profile)
	}
	profile := ResolveModelThinking(settings, "tokenflux", "x-ai/grok-4.6", "medium")
	if !profile.Enabled || profile.Level != "high" {
		t.Fatalf("manual Grok thinking profile = %#v", profile)
	}
}

func TestNormalizeModelThinkingDropsUnsupportedLevelsAndCanDisablePreset(t *testing.T) {
	settings := AppSettings{
		Providers: map[string]ProviderConfig{},
		ModelThinking: map[string]map[string]ModelThinkingConfig{
			"tokenflux": {
				"openai/gpt-5.6": {
					Enabled:      true,
					Levels:       []string{"medium", "ultra", "max", "medium"},
					DefaultLevel: "ultra",
				},
				"openai/gpt-5.5": {Enabled: false},
			},
		},
	}
	normalized := withDefaults(settings)
	configured := normalized.ModelThinking["tokenflux"]["openai/gpt-5.6"]
	if got := len(configured.Levels); got != 2 {
		t.Fatalf("normalized levels = %#v", configured.Levels)
	}
	if configured.Levels[0] != "medium" || configured.Levels[1] != "max" || configured.DefaultLevel != "medium" {
		t.Fatalf("normalized config = %#v", configured)
	}
	if profile := ResolveModelThinking(normalized, "tokenflux", "openai/gpt-5.5", "high"); profile.Enabled {
		t.Fatalf("manual disable did not override preset: %#v", profile)
	}
}

func TestNormalizeModelThinkingRemembersConfiguredLevelsWhileDisabled(t *testing.T) {
	configured := normalizeModelThinkingConfig(ModelThinkingConfig{
		Enabled:      false,
		Levels:       []string{"low", "high", "max"},
		DefaultLevel: "high",
	})
	if len(configured.Levels) != 3 || configured.DefaultLevel != "high" {
		t.Fatalf("disabled thinking config lost its choices: %#v", configured)
	}
}
