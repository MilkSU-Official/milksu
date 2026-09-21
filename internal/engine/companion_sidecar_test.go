package engine

import (
	"errors"
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

func TestCompanionTurnAuthDoesNotCrossWireSources(t *testing.T) {
	relayURL := "https://tokenflux.dev/v1"
	personalURL := "https://relay.example.test"
	settings := config.DefaultSettings()
	settings.ActiveProvider = "custom-relay-home"
	settings.CompanionSource = "personal"
	settings.CompanionProvider = ""
	settings.CompanionModel = "deepseek-chat"
	settings.Relay = &config.RelayConfig{Enabled: true, Key: "account-secret", URL: relayURL}
	settings.Providers["custom-relay-home"] = config.ProviderConfig{
		Custom:  true,
		Enabled: true,
		Name:    "home",
		APIKey:  "home-secret",
		BaseURL: &personalURL,
		Models:  []string{"deepseek-chat"},
	}

	payload, err := CompanionTurnAuth(settings)
	if !errors.Is(err, ErrCompanionCredentialMissing) || payload != nil {
		t.Fatalf("empty personal provider must not use the homepage relay: payload=%#v err=%v", payload, err)
	}
	if got := CompanionCustomProvider(settings); got != nil {
		t.Fatalf("custom payload must not fall back to ActiveProvider: %#v", got)
	}

	settings.CompanionSource = "account"
	settings.CompanionProvider = "custom-relay-home"
	settings.CompanionModel = "deepseek/deepseek-flash"
	payload, err = CompanionTurnAuth(settings)
	if err != nil {
		t.Fatal(err)
	}
	if payload != nil {
		t.Fatalf("account source must use the account credential, not the personal relay: %#v", payload)
	}

	settings.Relay = nil
	if _, err = CompanionTurnAuth(settings); !errors.Is(err, ErrCompanionCredentialMissing) {
		t.Fatalf("account source without a key = %v, want missing credential", err)
	}
}
