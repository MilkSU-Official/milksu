package engine

import (
	"fmt"
	"strings"

	"github.com/MilkSU-Official/milksu/internal/config"
)

const (
	ModelModeAuto   = "auto"
	ModelModeManual = "manual"
)

const (
	ctfAgentDefaultProvider = "tokenflux"
	ctfAgentDefaultModel    = "grok-4.5"
)

func isCTFAgentRole(role string) bool {
	switch strings.TrimSpace(role) {
	case "solver", "tool-builder", "strategist":
		return true
	default:
		return false
	}
}

// ResolveTaskModel returns a private settings copy with the model selected for
// one Agent task. CTF roles use MilkSU's CTF-specific automatic default unless
// a conversation has an explicit manual override.
func ResolveTaskModel(
	settings config.AppSettings,
	role string,
	mode,
	provider,
	model string,
) (config.AppSettings, error) {
	mode = strings.TrimSpace(mode)
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

	if mode == "" || mode == ModelModeAuto {
		if isCTFAgentRole(role) {
			settings.ActiveProvider = ctfAgentDefaultProvider
			settings.ActiveModel = ctfAgentDefaultModel
		}
		return settings, nil
	}

	return settings, nil
}
