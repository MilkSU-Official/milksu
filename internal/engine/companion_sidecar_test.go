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
		t.Fatalf("explicit account model without a key = %v, want missing credential", err)
	}
}

func TestFactoryAccountCompanionAdoptsMainWindowRoute(t *testing.T) {
	settings := config.DefaultSettings()
	settings.ActiveProvider = "tokenflux"
	settings.ActiveModel = "deepseek/deepseek-flash"
	settings.Providers["tokenflux"] = config.ProviderConfig{
		Enabled: true,
		APIKey:  "tokenflux-personal-secret",
	}
	settings.CompanionProvider = ""
	settings.CompanionModel = ""
	settings.CompanionSource = ""
	settings.Relay = nil

	selection := ResolveCompanionTurn(settings)
	if selection.Provider != "tokenflux" || selection.Model != "deepseek/deepseek-flash" || selection.Source != "personal" {
		t.Fatalf("factory account without a relay must use the main window route: %#v", selection)
	}
	payload, err := CompanionTurnAuth(settings)
	if err != nil || payload != nil {
		t.Fatalf("personal tokenflux auth = %#v err=%v", payload, err)
	}
	saved := config.ResolveCompanionModel(settings)
	if saved.Source != config.ModelSourceAccount || saved.Provider != config.DefaultCompanionProvider {
		t.Fatalf("saved companion selection was rewritten: %#v", saved)
	}

	relayURL := "https://tokenflux.dev/v1"
	settings.Relay = &config.RelayConfig{Enabled: true, Key: "account-secret", URL: relayURL}
	selection = ResolveCompanionTurn(settings)
	if selection.Source != config.ModelSourceAccount || selection.Model != config.DefaultCompanionModel {
		t.Fatalf("connected account must stay on the factory account route: %#v", selection)
	}
	if payload, err = CompanionTurnAuth(settings); err != nil || payload != nil {
		t.Fatalf("account auth = %#v err=%v", payload, err)
	}
}

func TestFactoryAccountCompanionAdoptsCustomMainWindowRelay(t *testing.T) {
	baseURL := "https://api.deepseek.example.test"
	settings := config.DefaultSettings()
	settings.ActiveProvider = "custom-relay-deepseek"
	settings.ActiveModel = "deepseek-flash"
	settings.Providers["custom-relay-deepseek"] = config.ProviderConfig{
		Custom:  true,
		Enabled: true,
		Name:    "DeepSeek",
		APIKey:  "deepseek-personal-secret",
		BaseURL: &baseURL,
		Models:  []string{"deepseek-flash"},
	}
	settings.Relay = nil

	selection := ResolveCompanionTurn(settings)
	if selection.Provider != "custom-relay-deepseek" || selection.Model != "deepseek-flash" || selection.Source != "service" {
		t.Fatalf("factory account must adopt the enabled DeepSeek relay: %#v", selection)
	}
	payload, err := CompanionTurnAuth(settings)
	if err != nil || payload == nil || payload["id"] != "custom-relay-deepseek" || payload["key"] != "deepseek-personal-secret" {
		t.Fatalf("adopted relay payload = %#v err=%v", payload, err)
	}
}

func TestExplicitCompanionSourceIsNotReplaced(t *testing.T) {
	settings := config.DefaultSettings()
	settings.ActiveProvider = "tokenflux"
	settings.ActiveModel = "deepseek/deepseek-flash"
	settings.Providers["tokenflux"] = config.ProviderConfig{
		Enabled: true,
		APIKey:  "tokenflux-personal-secret",
	}
	settings.CompanionSource = "personal"
	settings.CompanionProvider = "tokenflux"
	settings.CompanionModel = "google/gemini-3.8-flash"
	settings.Relay = nil

	selection := ResolveCompanionTurn(settings)
	if selection.Source != "personal" || selection.Model != "google/gemini-3.8-flash" {
		t.Fatalf("explicit personal companion model was replaced: %#v", selection)
	}

	settings.CompanionSource = "account"
	settings.CompanionProvider = "tokenflux"
	settings.CompanionModel = "openai/gpt-4.1"
	selection = ResolveCompanionTurn(settings)
	if selection.Source != "account" || selection.Model != "openai/gpt-4.1" {
		t.Fatalf("explicit account companion model was replaced: %#v", selection)
	}
	if _, err := CompanionTurnAuth(settings); !errors.Is(err, ErrCompanionCredentialMissing) {
		t.Fatalf("explicit account model without a relay = %v", err)
	}
}
