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
		// The app-level default is inherited once, when a conversation is created - never at run
		// time. Filling it in here is how one bad default took over conversations that had already
		// picked their own model, so a manual conversation without its own choice is a loud
		// failure instead of a silent substitution.
		if strings.TrimSpace(provider) == "" || strings.TrimSpace(model) == "" {
			return settings, fmt.Errorf(
				"this conversation selected its own model but its record has no provider/model; " +
					"pick a model again in the model selector",
			)
		}
		settings.ActiveProvider = strings.TrimSpace(provider)
		settings.ActiveModel = strings.TrimSpace(model)
		return settings, nil
	}

	return settings, nil
}
