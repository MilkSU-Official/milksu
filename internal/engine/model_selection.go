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

// ResolveTaskModel returns a private settings copy with the model selected for
// one Agent task. Automatic mode uses the single app-level default model.
// Manual mode only applies an explicit per-conversation override.
func ResolveTaskModel(
	settings config.AppSettings,
	_ string,
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

	return settings, nil
}
