package engine

import (
	"reflect"
	"testing"

	"github.com/MilkSU-Official/milksu/internal/config"
)

func routingSettings() config.AppSettings {
	settings := config.DefaultSettings()
	settings.ActiveProvider = "tokenflux"
	settings.ActiveModel = "grok-4.5"
	settings.Providers["tokenflux"] = config.ProviderConfig{
		APIKey:  "personal-secret",
		Enabled: true,
	}
	settings.Relay = &config.RelayConfig{
		Enabled: true,
		URL:     "https://tokenflux.dev/v1",
		Key:     "account-secret",
	}
	return settings
}

func TestResolvedModelSourceOrderHonorsPreference(t *testing.T) {
	settings := routingSettings()
	settings.ModelRouting.SourceOrder = []string{config.ModelSourcePersonal, config.ModelSourceAccount}
	if got := resolvedModelSourceOrder(settings); !reflect.DeepEqual(got, settings.ModelRouting.SourceOrder) {
		t.Fatalf("unexpected source order: %#v", got)
	}
}

func TestResolvedModelSourceOrderSkipsUnavailableSources(t *testing.T) {
	settings := routingSettings()
	settings.Relay.Key = ""
	if got := resolvedModelSourceOrder(settings); !reflect.DeepEqual(got, []string{config.ModelSourcePersonal}) {
		t.Fatalf("unexpected available sources: %#v", got)
	}
}

func TestPreferredModelSourceOrderOnlyReordersTheCurrentTurn(t *testing.T) {
	settings := routingSettings()
	settings.ModelRouting.SourceOrder = []string{config.ModelSourceAccount, config.ModelSourcePersonal}
	got := preferredModelSourceOrder(settings, config.ModelSourcePersonal)
	want := []string{config.ModelSourcePersonal, config.ModelSourceAccount}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("unexpected preferred source order: got %#v want %#v", got, want)
	}
	if !reflect.DeepEqual(settings.ModelRouting.SourceOrder, []string{config.ModelSourceAccount, config.ModelSourcePersonal}) {
		t.Fatalf("conversation preference mutated global settings: %#v", settings.ModelRouting.SourceOrder)
	}
}

func TestPreferredModelSourceOrderIgnoresUnavailablePreference(t *testing.T) {
	settings := routingSettings()
	settings.Relay.Key = ""
	got := preferredModelSourceOrder(settings, config.ModelSourceAccount)
	if !reflect.DeepEqual(got, []string{config.ModelSourcePersonal}) {
		t.Fatalf("unexpected available source order: %#v", got)
	}
}

func TestModelRoutingEnvironmentContainsNoSourceNamesWithoutCredentials(t *testing.T) {
	settings := config.DefaultSettings()
	environment := engineEnvironment(settings)
	for _, entry := range environment {
		if entry == "MILKSU_MODEL_SOURCE_ORDER=account,personal" {
			t.Fatalf("unavailable model sources leaked into environment: %#v", environment)
		}
	}
}

func TestCustomRelayUsesOnlyThePersonalSource(t *testing.T) {
	baseURL := "https://relay.example.test/v1"
	settings := routingSettings()
	settings.ActiveProvider = "custom-relay-example"
	settings.ActiveModel = "vendor/model"
	settings.Providers["custom-relay-example"] = config.ProviderConfig{
		Custom: true, Name: "Example", Models: []string{"vendor/model"},
		APIKey: "custom-secret", BaseURL: &baseURL, Enabled: true,
	}

	if got := resolvedModelSourceOrder(settings); !reflect.DeepEqual(got, []string{config.ModelSourcePersonal}) {
		t.Fatalf("custom relay must not route through account quota: %#v", got)
	}
}
