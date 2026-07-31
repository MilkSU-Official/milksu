package engine

import (
	"fmt"
	"os"
	"strings"

	"github.com/MilkSU-Official/milksu/internal/config"
)

const (
	ModelModeAuto   = "auto"
	ModelModeManual = "manual"
)

// ResolveTaskModel returns a private settings copy with the model selected for
// one Agent task. Explicit manual choices fail closed. Automatic routing uses
// the deep model for review/strategy roles and the fast model for iterative
// execution, falling back only when an automatic route has no usable
// credential.
func ResolveTaskModel(
	settings config.AppSettings,
	role,
	mode,
	provider,
	model string,
) (config.AppSettings, error) {
	mode = strings.TrimSpace(mode)
	if mode == "" {
		mode = strings.TrimSpace(settings.ModelRouting.DefaultMode)
	}
	if mode == ModelModeManual {
		if strings.TrimSpace(provider) == "" && strings.TrimSpace(model) == "" {
			provider = settings.ActiveProvider
			model = settings.ActiveModel
		}
		if strings.TrimSpace(provider) == "" || strings.TrimSpace(model) == "" {
			return settings, fmt.Errorf("manual model selection requires provider and model")
		}
		settings.ActiveProvider = strings.TrimSpace(provider)
		settings.ActiveModel = strings.TrimSpace(model)
		return settings, nil
	}

	selected := settings.ModelRouting.Fast
	if usesDeepModel(role) {
		selected = settings.ModelRouting.Deep
	}
	candidates := []config.ModelSelection{
		selected,
		settings.ModelRouting.Fast,
		{Provider: settings.ActiveProvider, Model: settings.ActiveModel},
	}
	for _, candidate := range candidates {
		if strings.TrimSpace(candidate.Provider) == "" || strings.TrimSpace(candidate.Model) == "" {
			continue
		}
		if automaticModelAvailable(settings, candidate.Provider) {
			settings.ActiveProvider = strings.TrimSpace(candidate.Provider)
			settings.ActiveModel = strings.TrimSpace(candidate.Model)
			return settings, nil
		}
	}

	// Preserve the selected route so validateModelAccess can return the normal,
	// actionable missing-credential error instead of hiding configuration
	// problems behind a generic routing failure.
	settings.ActiveProvider = strings.TrimSpace(selected.Provider)
	settings.ActiveModel = strings.TrimSpace(selected.Model)
	return settings, nil
}

func usesDeepModel(role string) bool {
	switch strings.TrimSpace(role) {
	case "strategist", "cve-research", "deep-review":
		return true
	default:
		return false
	}
}

func automaticModelAvailable(settings config.AppSettings, provider string) bool {
	if relay := settings.Relay; relay != nil && relay.Enabled && strings.TrimSpace(relay.Key) != "" {
		return true
	}
	if configured, exists := settings.Providers[provider]; exists {
		return configured.Enabled && strings.TrimSpace(configured.APIKey) != ""
	}
	environmentKey, supported := providerAPIKeyEnvironment(provider)
	return supported && strings.TrimSpace(os.Getenv(environmentKey)) != ""
}
