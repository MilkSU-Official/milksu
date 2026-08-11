package engine

import (
	"os"
	"strings"

	"github.com/MilkSU-Official/milksu/internal/config"
)

func accountModelSourceAvailable(settings config.AppSettings) bool {
	relay := settings.Relay
	return relay != nil && relay.Enabled && strings.TrimSpace(relay.Key) != ""
}

func personalModelSourceAvailable(settings config.AppSettings) bool {
	provider := strings.TrimSpace(settings.ActiveProvider)
	if configured, exists := settings.Providers[provider]; exists {
		return configured.Enabled && strings.TrimSpace(configured.APIKey) != ""
	}
	environmentKey, supported := providerAPIKeyEnvironment(provider)
	return supported && strings.TrimSpace(os.Getenv(environmentKey)) != ""
}

func resolvedModelSourceOrder(settings config.AppSettings) []string {
	requested := settings.ModelRouting.SourceOrder
	if len(requested) == 0 {
		requested = []string{config.ModelSourceAccount, config.ModelSourcePersonal}
	}
	available := map[string]bool{
		config.ModelSourceAccount:  accountModelSourceAvailable(settings),
		config.ModelSourcePersonal: personalModelSourceAvailable(settings),
	}
	result := make([]string, 0, 2)
	seen := make(map[string]bool, 2)
	for _, source := range requested {
		source = strings.TrimSpace(source)
		if !available[source] || seen[source] {
			continue
		}
		seen[source] = true
		result = append(result, source)
	}
	for _, source := range []string{config.ModelSourceAccount, config.ModelSourcePersonal} {
		if available[source] && !seen[source] {
			result = append(result, source)
		}
	}
	return result
}

func preferredModelSourceOrder(settings config.AppSettings, preference string) []string {
	available := resolvedModelSourceOrder(settings)
	preference = strings.TrimSpace(preference)
	if preference != config.ModelSourceAccount && preference != config.ModelSourcePersonal {
		return available
	}
	result := make([]string, 0, len(available))
	for _, source := range available {
		if source == preference {
			result = append(result, source)
		}
	}
	for _, source := range available {
		if source != preference {
			result = append(result, source)
		}
	}
	return result
}

func modelSourceAutoFallback(settings config.AppSettings) bool {
	return settings.ModelRouting.AutoFallback == nil || *settings.ModelRouting.AutoFallback
}
