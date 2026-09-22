package config

import (
	"strings"

	"github.com/MilkSU-Official/milksu/internal/imagegencatalog"
)

const (
	// DefaultImageGenProvider is the TokenFlux relay used for account / personal ImageGen.
	DefaultImageGenProvider = "tokenflux"
	// DefaultImageGenModel is the factory ImageGen pick (OpenAI GPT Image via TokenFlux routing).
	DefaultImageGenModel = "openai/gpt-image-2"
	// DefaultImageGenSource prefers the MilkSU account TokenFlux quota.
	DefaultImageGenSource = ModelSourceAccount
	// DefaultTokenFluxImageGenBaseURL is the only TokenFlux product base URL for Images API calls.
	DefaultTokenFluxImageGenBaseURL = "https://tokenflux.dev/v1"
)

// ImageGenModelSelection is the saved ImageGen route. It is independent of
// active_provider / active_model (chat) and of companion / worker selections.
type ImageGenModelSelection struct {
	Provider string
	Model    string
	Source   string
}

func normalizeImageGenSettings(value AppSettings) AppSettings {
	provider := strings.TrimSpace(value.ImageGenProvider)
	model := strings.TrimSpace(value.ImageGenModel)
	source := strings.TrimSpace(value.ImageGenSource)

	// Empty triplet means ImageGen is off until the user picks a model.
	if provider == "" && model == "" && source == "" {
		value.ImageGenProvider = ""
		value.ImageGenModel = ""
		value.ImageGenSource = ""
		return value
	}

	if provider == "" {
		provider = DefaultImageGenProvider
	}
	if model == "" {
		model = DefaultImageGenModel
	}
	if source != ModelSourceAccount && source != ModelSourcePersonal && source != "service" {
		if provider == "tokenflux" {
			source = DefaultImageGenSource
		} else {
			source = "service"
		}
	}

	// Reject chat-looking ids that are not in the ImageGen catalog when the
	// provider is TokenFlux. Custom relays may advertise other OpenAI-compatible
	// image ids, so only enforce the curated list for tokenflux.
	if provider == "tokenflux" && !imagegencatalog.KnownID(model) {
		model = DefaultImageGenModel
	}

	value.ImageGenProvider = provider
	value.ImageGenModel = model
	value.ImageGenSource = source
	return value
}

// ResolveImageGenModel returns the saved ImageGen selection when configured.
func ResolveImageGenModel(settings AppSettings) (ImageGenModelSelection, bool) {
	settings = normalizeImageGenSettings(settings)
	if settings.ImageGenProvider == "" || settings.ImageGenModel == "" {
		return ImageGenModelSelection{}, false
	}
	return ImageGenModelSelection{
		Provider: settings.ImageGenProvider,
		Model:    settings.ImageGenModel,
		Source:   settings.ImageGenSource,
	}, true
}

// ImageGenConfigured reports whether settings name an ImageGen model.
// Credential readiness is resolved separately when injecting sidecar env.
func ImageGenConfigured(settings AppSettings) bool {
	_, ok := ResolveImageGenModel(settings)
	return ok
}
