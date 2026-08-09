package engine

import (
	"testing"

	"github.com/MilkSU-Official/milksu/internal/config"
)

func modelSelectionSettings() config.AppSettings {
	settings := config.DefaultSettings()
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
		if resolved.ActiveProvider != "deepseek" || resolved.ActiveModel != "deepseek-v4-flash" {
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
