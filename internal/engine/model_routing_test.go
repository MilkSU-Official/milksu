package engine

import (
	"testing"

	"github.com/MilkSU-Official/milksu/internal/config"
)

func routedSettings() config.AppSettings {
	settings := config.DefaultSettings()
	settings.Providers["deepseek"] = config.ProviderConfig{
		APIKey:  "deepseek-secret",
		Enabled: true,
	}
	settings.Providers["kourichat"] = config.ProviderConfig{
		APIKey:  "kouri-secret",
		Enabled: true,
	}
	return settings
}

func TestResolveTaskModelRoutesExecutionAndStrategy(t *testing.T) {
	settings := routedSettings()
	fast, err := ResolveTaskModel(settings, "solver", ModelModeAuto, "", "")
	if err != nil {
		t.Fatal(err)
	}
	if fast.ActiveProvider != "deepseek" || fast.ActiveModel != "deepseek-v4-flash" {
		t.Fatalf("unexpected fast route: %#v", fast)
	}

	deep, err := ResolveTaskModel(settings, "strategist", ModelModeAuto, "", "")
	if err != nil {
		t.Fatal(err)
	}
	if deep.ActiveProvider != "kourichat" || deep.ActiveModel != "kimi-k3" {
		t.Fatalf("unexpected deep route: %#v", deep)
	}
}

func TestResolveTaskModelFallsBackWhenDeepCredentialMissing(t *testing.T) {
	settings := routedSettings()
	delete(settings.Providers, "kourichat")
	resolved, err := ResolveTaskModel(settings, "strategist", ModelModeAuto, "", "")
	if err != nil {
		t.Fatal(err)
	}
	if resolved.ActiveProvider != "deepseek" || resolved.ActiveModel != "deepseek-v4-flash" {
		t.Fatalf("expected fast fallback, got %#v", resolved)
	}
}

func TestResolveTaskModelHonorsManualOverride(t *testing.T) {
	settings := routedSettings()
	resolved, err := ResolveTaskModel(
		settings,
		"solver",
		ModelModeManual,
		"kourichat",
		"kimi-k3",
	)
	if err != nil {
		t.Fatal(err)
	}
	if resolved.ActiveProvider != "kourichat" || resolved.ActiveModel != "kimi-k3" {
		t.Fatalf("unexpected manual route: %#v", resolved)
	}
}
