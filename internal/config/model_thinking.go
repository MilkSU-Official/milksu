package config

import "strings"

var modelThinkingLevelOrder = []string{
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
}

type ModelThinkingConfig struct {
	Enabled      bool     `json:"enabled"`
	Levels       []string `json:"levels,omitempty"`
	DefaultLevel string   `json:"default_level,omitempty"`
}

// ModelThinkingProfile is the bounded, provider-agnostic thinking control
// passed to Pi for one selected model. Pi remains responsible for translating
// the canonical level to the concrete provider request.
type ModelThinkingProfile struct {
	Enabled bool     `json:"enabled"`
	Levels  []string `json:"levels,omitempty"`
	Level   string   `json:"level,omitempty"`
}

func ResolveModelThinking(
	settings AppSettings,
	provider,
	model,
	requested string,
) ModelThinkingProfile {
	provider = strings.TrimSpace(provider)
	model = strings.TrimSpace(model)
	configured, overridden := modelThinkingOverride(settings.ModelThinking, provider, model)
	if !overridden {
		configured, _ = builtInModelThinking(model)
	}
	configured = normalizeModelThinkingConfig(configured)
	if !configured.Enabled || len(configured.Levels) == 0 {
		return ModelThinkingProfile{Enabled: false}
	}
	level := strings.ToLower(strings.TrimSpace(requested))
	if !containsThinkingLevel(configured.Levels, level) {
		level = configured.DefaultLevel
	}
	return ModelThinkingProfile{
		Enabled: true,
		Levels:  append([]string(nil), configured.Levels...),
		Level:   level,
	}
}

func normalizeModelThinkingOverrides(
	value map[string]map[string]ModelThinkingConfig,
	providers map[string]ProviderConfig,
) map[string]map[string]ModelThinkingConfig {
	if len(value) == 0 {
		return nil
	}
	result := make(map[string]map[string]ModelThinkingConfig)
	for rawProvider, models := range value {
		provider := strings.TrimSpace(rawProvider)
		configuredProvider, exists := providers[provider]
		if provider == "" || len(provider) > 64 || (provider != "tokenflux" && (!exists || !configuredProvider.Custom)) {
			continue
		}
		if len(models) > 32 {
			continue
		}
		normalizedModels := make(map[string]ModelThinkingConfig)
		for rawModel, configured := range models {
			model := strings.TrimSpace(rawModel)
			if model == "" || len([]rune(model)) > 256 || strings.ContainsAny(model, "\x00\r\n") {
				continue
			}
			normalizedModels[model] = normalizeModelThinkingConfig(configured)
		}
		if len(normalizedModels) > 0 {
			result[provider] = normalizedModels
		}
	}
	if len(result) == 0 {
		return nil
	}
	return result
}

func normalizeModelThinkingConfig(value ModelThinkingConfig) ModelThinkingConfig {
	selected := make(map[string]bool, len(value.Levels))
	for _, raw := range value.Levels {
		level := strings.ToLower(strings.TrimSpace(raw))
		if validModelThinkingLevel(level) {
			selected[level] = true
		}
	}
	levels := make([]string, 0, len(selected))
	for _, level := range modelThinkingLevelOrder {
		if selected[level] {
			levels = append(levels, level)
		}
	}
	defaultLevel := strings.ToLower(strings.TrimSpace(value.DefaultLevel))
	if !value.Enabled {
		if !containsThinkingLevel(levels, defaultLevel) {
			defaultLevel = preferredThinkingDefault(levels)
		}
		return ModelThinkingConfig{
			Enabled:      false,
			Levels:       levels,
			DefaultLevel: defaultLevel,
		}
	}
	if len(levels) == 0 {
		levels = []string{"low", "medium", "high"}
	}
	if !containsThinkingLevel(levels, defaultLevel) {
		defaultLevel = preferredThinkingDefault(levels)
	}
	return ModelThinkingConfig{
		Enabled:      true,
		Levels:       levels,
		DefaultLevel: defaultLevel,
	}
}

func modelThinkingOverride(
	value map[string]map[string]ModelThinkingConfig,
	provider,
	model string,
) (ModelThinkingConfig, bool) {
	models, exists := value[provider]
	if !exists {
		return ModelThinkingConfig{}, false
	}
	configured, exists := models[model]
	return configured, exists
}

func builtInModelThinking(model string) (ModelThinkingConfig, bool) {
	id := canonicalThinkingModelID(model)
	profile := func(levels []string, defaultLevel string) (ModelThinkingConfig, bool) {
		return ModelThinkingConfig{
			Enabled:      true,
			Levels:       levels,
			DefaultLevel: defaultLevel,
		}, true
	}

	if strings.Contains(id, "claude-fable-5") ||
		strings.Contains(id, "claude-opus-5") ||
		strings.Contains(id, "claude-opus-4-8") ||
		strings.Contains(id, "claude-opus-4-7") ||
		strings.Contains(id, "claude-sonnet-5") {
		return profile([]string{"low", "medium", "high", "xhigh", "max"}, "high")
	}
	if strings.Contains(id, "claude-opus-4-6") ||
		strings.Contains(id, "claude-sonnet-4-6") {
		return profile([]string{"low", "medium", "high", "max"}, "high")
	}
	if strings.Contains(id, "claude-opus-") ||
		strings.Contains(id, "claude-sonnet-") ||
		strings.Contains(id, "claude-fable-") {
		return profile([]string{"low", "medium", "high"}, "high")
	}

	if strings.Contains(id, "gpt-5-6") {
		return profile([]string{"off", "low", "medium", "high", "xhigh", "max"}, "medium")
	}
	if strings.Contains(id, "gpt-5-5-pro") ||
		strings.Contains(id, "gpt-5-4-pro") ||
		strings.Contains(id, "gpt-5-2-pro") {
		return profile([]string{"medium", "high", "xhigh"}, "high")
	}
	if strings.Contains(id, "gpt-5-pro") {
		return profile([]string{"high"}, "high")
	}
	if strings.Contains(id, "gpt-5-5") ||
		strings.Contains(id, "gpt-5-4") ||
		strings.Contains(id, "gpt-5-3") ||
		strings.Contains(id, "gpt-5-2") {
		return profile([]string{"off", "low", "medium", "high", "xhigh"}, "medium")
	}
	if strings.Contains(id, "gpt-5-1") {
		return profile([]string{"off", "low", "medium", "high"}, "medium")
	}
	if strings.Contains(id, "gpt-5") && !strings.Contains(id, "chat") {
		return profile([]string{"minimal", "low", "medium", "high"}, "medium")
	}

	base := id
	if separator := strings.LastIndex(base, "/"); separator >= 0 {
		base = base[separator+1:]
	}
	if len(base) >= 2 && base[0] == 'o' && base[1] >= '1' && base[1] <= '9' &&
		(len(base) == 2 || base[2] == '-') {
		return profile([]string{"low", "medium", "high"}, "medium")
	}
	return ModelThinkingConfig{}, false
}

func canonicalThinkingModelID(value string) string {
	return strings.NewReplacer("_", "-", ".", "-").Replace(strings.ToLower(strings.TrimSpace(value)))
}

func validModelThinkingLevel(value string) bool {
	return containsThinkingLevel(modelThinkingLevelOrder, value)
}

func containsThinkingLevel(levels []string, target string) bool {
	for _, level := range levels {
		if level == target {
			return true
		}
	}
	return false
}

func preferredThinkingDefault(levels []string) string {
	for _, candidate := range []string{"medium", "high", "low", "minimal", "off", "xhigh", "max"} {
		if containsThinkingLevel(levels, candidate) {
			return candidate
		}
	}
	return ""
}
