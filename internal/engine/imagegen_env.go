package engine

import (
	"strings"

	"github.com/MilkSU-Official/milksu/internal/config"
)

// ImageGenCredential is the resolved paid ImageGen route for a Coding sidecar.
// Keys stay in process env (MILKSU_IMAGEGEN_*) and never enter tool output.
type ImageGenCredential struct {
	Provider string
	Model    string
	Source   string
	APIKey   string
	BaseURL  string
}

// ResolveImageGenCredential returns the ImageGen API route when settings name
// a model and that source has a usable key. Chat active_model is never used.
func ResolveImageGenCredential(settings config.AppSettings) (ImageGenCredential, bool) {
	selection, ok := config.ResolveImageGenModel(settings)
	if !ok {
		return ImageGenCredential{}, false
	}
	credential := ImageGenCredential{
		Provider: selection.Provider,
		Model:    selection.Model,
		Source:   selection.Source,
	}
	switch selection.Source {
	case config.ModelSourceAccount:
		if !accountRelayReady(settings) {
			return ImageGenCredential{}, false
		}
		credential.APIKey = strings.TrimSpace(settings.Relay.Key)
		credential.BaseURL = strings.TrimSpace(settings.Relay.URL)
		if credential.BaseURL == "" {
			credential.BaseURL = config.DefaultTokenFluxImageGenBaseURL
		}
	case config.ModelSourcePersonal, "service":
		name := strings.TrimSpace(selection.Provider)
		provider, exists := settings.Providers[name]
		if !exists || !provider.Enabled {
			return ImageGenCredential{}, false
		}
		if provider.Custom {
			payload := customProviderPayloadFor(settings, name)
			if payload == nil {
				return ImageGenCredential{}, false
			}
			credential.APIKey = strings.TrimSpace(stringValue(payload["key"]))
			credential.BaseURL = strings.TrimSpace(stringValue(payload["baseUrl"]))
		} else {
			credential.APIKey = strings.TrimSpace(provider.APIKey)
			if provider.BaseURL != nil {
				credential.BaseURL = strings.TrimSpace(*provider.BaseURL)
			}
			if credential.BaseURL == "" && name == "tokenflux" {
				credential.BaseURL = config.DefaultTokenFluxImageGenBaseURL
			}
		}
		if credential.APIKey == "" || credential.BaseURL == "" {
			return ImageGenCredential{}, false
		}
	default:
		return ImageGenCredential{}, false
	}
	if credential.APIKey == "" || credential.BaseURL == "" || credential.Model == "" {
		return ImageGenCredential{}, false
	}
	return credential, true
}

func stringValue(value any) string {
	text, _ := value.(string)
	return text
}

// appendImageGenEnvironment injects the isolated ImageGen route. It never
// writes OPENAI_API_KEY for ImageGen and never copies the chat active_model.
func appendImageGenEnvironment(environment []string, settings config.AppSettings) []string {
	credential, ok := ResolveImageGenCredential(settings)
	if !ok {
		return environment
	}
	return append(environment,
		"MILKSU_IMAGEGEN_CONFIGURED=1",
		"MILKSU_IMAGEGEN_PROVIDER="+credential.Provider,
		"MILKSU_IMAGEGEN_MODEL="+credential.Model,
		"MILKSU_IMAGEGEN_SOURCE="+credential.Source,
		"MILKSU_IMAGEGEN_API_KEY="+credential.APIKey,
		"MILKSU_IMAGEGEN_BASE_URL="+credential.BaseURL,
	)
}
