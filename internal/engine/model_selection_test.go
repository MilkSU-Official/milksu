package engine

import (
	"testing"

	"github.com/MilkSU-Official/milksu/internal/config"
)

func modelSelectionSettings() config.AppSettings {
	settings := config.DefaultSettings()
	preset := settings.Providers["custom-relay-deepseek"]
	preset.APIKey = "deepseek-official-secret"
	preset.Enabled = true
	settings.Providers["custom-relay-deepseek"] = preset
	settings.Providers["deepseek"] = config.ProviderConfig{
		APIKey:  "deepseek-secret",
		Enabled: true,
	}
	settings.Providers["tokenflux"] = config.ProviderConfig{
		APIKey:  "tokenflux-secret",
		Enabled: true,
	}
	return settings
}

func TestResolveTaskModelAutoUsesSingleDefaultForAllRoles(t *testing.T) {
	settings := modelSelectionSettings()
	for _, role := range []string{"solver", "strategist", "cve-research", "deep-review"} {
		resolved, err := ResolveTaskModel(settings, role, ModelModeAuto, "", "")
		if err != nil {
			t.Fatalf("resolve %s: %v", role, err)
		}
		if resolved.ActiveProvider != "custom-relay-deepseek" || resolved.ActiveModel != "deepseek-flash" {
			t.Fatalf("role %s should use single default route, got %#v", role, resolved)
		}
	}
}

func TestResolveTaskModelHonorsManualOverride(t *testing.T) {
	settings := modelSelectionSettings()
	resolved, err := ResolveTaskModel(
		settings,
		"solver",
		ModelModeManual,
		"tokenflux",
		"grok-4.3",
	)
	if err != nil {
		t.Fatal(err)
	}
	if resolved.ActiveProvider != "tokenflux" || resolved.ActiveModel != "grok-4.3" {
		t.Fatalf("unexpected manual route: %#v", resolved)
	}
}

// The user's rule, verbatim: the global default model only ever applies to a NEW conversation.
// A manual conversation whose record carries no provider/model must fail loudly instead of
// quietly running on the app default - that is how one bad default used to take over existing
// conversations.
func TestResolveTaskModelManualNeverInheritsTheGlobalDefault(t *testing.T) {
	settings := modelSelectionSettings()
	settings.ActiveProvider = "tokenflux"
	settings.ActiveModel = "deepseek/deepseek-flash"

	resolved, err := ResolveTaskModel(settings, "", ModelModeManual, "", "")
	if err == nil {
		t.Fatalf("manual without its own provider/model must not inherit the global default: %#v", resolved)
	}
	if resolved.ActiveProvider != "tokenflux" || resolved.ActiveModel != "deepseek/deepseek-flash" {
		t.Fatalf("a failed resolution must not rewrite the settings: %#v", resolved)
	}
}
