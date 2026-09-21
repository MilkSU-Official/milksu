package engine

import (
	"testing"

	"github.com/MilkSU-Official/milksu/internal/config"
)

func TestCompanionCustomProviderUsesCompanionRelayNotHomepage(t *testing.T) {
	homepageURL := "https://tokenflux.dev/v1"
	companionURL := "https://api.deepseek.example.test"
	settings := config.DefaultSettings()
	settings.ActiveProvider = "tokenflux"
	settings.ActiveModel = "deepseek/deepseek-flash"
	settings.CompanionSource = "personal"
	settings.CompanionProvider = "custom-relay-product-loop"
	settings.CompanionModel = "deepseek-chat"
	settings.Providers["custom-relay-product-loop"] = config.ProviderConfig{
		Custom:  true,
		Enabled: true,
		Name:    "product-loop",
		Models:  []string{"deepseek-chat"},
		APIKey:  "deepseek-personal-secret",
		BaseURL: &companionURL,
	}
	settings.Providers["tokenflux"] = config.ProviderConfig{
		Enabled: true,
		APIKey:  "tokenflux-homepage-secret",
		BaseURL: &homepageURL,
	}

	custom := CompanionCustomProvider(settings)
	if custom == nil {
		t.Fatal("personal companion custom-relay must travel with the turn")
	}
	if custom["id"] != "custom-relay-product-loop" || custom["baseUrl"] != companionURL {
		t.Fatalf("companion must use its own relay, not the homepage provider: %#v", custom)
	}
	if custom["key"] != "deepseek-personal-secret" {
		t.Fatal("companion custom-relay key must be the personal relay key")
	}
	if homepage := customProviderTurnPayload(settings); homepage != nil {
		t.Fatalf("homepage TokenFlux is not a custom relay: %#v", homepage)
	}
}
