package config

import "testing"

func TestWithDefaults(t *testing.T) {
	settings := withDefaults(AppSettings{})
	if settings.ActiveProvider != "deepseek" || settings.ActiveModel != "deepseek-v4-flash" {
		t.Fatalf("unexpected defaults: %#v", settings)
	}
	if settings.Providers == nil {
		t.Fatal("providers map must be initialized")
	}
}

func TestCloneDoesNotShareMaps(t *testing.T) {
	original := DefaultSettings()
	original.Providers["openai"] = ProviderConfig{APIKey: "secret", Enabled: true}
	copied := clone(original)
	delete(copied.Providers, "openai")
	if _, exists := original.Providers["openai"]; !exists {
		t.Fatal("clone modified original provider map")
	}
}
