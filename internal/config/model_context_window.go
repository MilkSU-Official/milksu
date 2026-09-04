package config

import (
	"encoding/json"
	"strings"
)

const (
	minModelContextWindow = 1024
	maxModelContextWindow = 10_000_000
)

// ResolveModelContextWindow prefers a persisted per-model override, then the
// caller-supplied catalog/preset window. Catalog callers pass the result of
// modelcatalog.resolveModelContextWindow so family presets stay in one place.
func ResolveModelContextWindow(settings AppSettings, provider, model string, catalogWindow int) int {
	if window := modelContextWindowOverride(settings.ModelContextWindows, provider, model); window > 0 {
		return window
	}
	if catalogWindow > 0 {
		return catalogWindow
	}
	return 0
}

func modelContextWindowOverride(
	value map[string]map[string]int,
	provider,
	model string,
) int {
	provider = strings.TrimSpace(provider)
	model = strings.TrimSpace(model)
	if provider == "" || model == "" {
		return 0
	}
	window, exists := value[provider][model]
	if !exists || window <= 0 {
		return 0
	}
	return clampModelContextWindow(window)
}

func normalizeModelContextWindowOverrides(
	value map[string]map[string]int,
	providers map[string]ProviderConfig,
) map[string]map[string]int {
	if len(value) == 0 {
		return nil
	}
	result := make(map[string]map[string]int)
	for rawProvider, models := range value {
		provider := strings.TrimSpace(rawProvider)
		configuredProvider, exists := providers[provider]
		if provider == "" || len(provider) > 64 || (provider != "tokenflux" && (!exists || !configuredProvider.Custom)) {
			continue
		}
		if len(models) > 32 {
			continue
		}
		normalizedModels := make(map[string]int)
		for rawModel, window := range models {
			model := strings.TrimSpace(rawModel)
			if model == "" || len([]rune(model)) > 256 || strings.ContainsAny(model, "\x00\r\n") {
				continue
			}
			if window <= 0 {
				continue
			}
			normalizedModels[model] = clampModelContextWindow(window)
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

func cloneModelContextWindows(value map[string]map[string]int) map[string]map[string]int {
	if value == nil {
		return nil
	}
	copy := make(map[string]map[string]int, len(value))
	for provider, models := range value {
		copyModels := make(map[string]int, len(models))
		for model, window := range models {
			copyModels[model] = window
		}
		copy[provider] = copyModels
	}
	return copy
}

func clampModelContextWindow(value int) int {
	if value < minModelContextWindow {
		return minModelContextWindow
	}
	if value > maxModelContextWindow {
		return maxModelContextWindow
	}
	return value
}

// EncodeModelContextWindows serializes public window overrides for Sidecar.
// The payload is only token counts; it must never include credentials.
func EncodeModelContextWindows(settings AppSettings) string {
	normalized := normalizeModelContextWindowOverrides(settings.ModelContextWindows, settings.Providers)
	if len(normalized) == 0 {
		return ""
	}
	data, err := json.Marshal(normalized)
	if err != nil {
		return ""
	}
	return string(data)
}
