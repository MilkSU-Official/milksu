package config

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

type fakeSecretStore map[string]string

func (s fakeSecretStore) Get(account string) (string, error) {
	value, exists := s[account]
	if !exists {
		return "", errSecretNotFound
	}
	return value, nil
}

func (s fakeSecretStore) Set(account, secret string) error {
	s[account] = secret
	return nil
}

func (s fakeSecretStore) Delete(account string) error {
	if _, exists := s[account]; !exists {
		return errSecretNotFound
	}
	delete(s, account)
	return nil
}

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

func TestStoreKeepsSecretsOutOfSettingsAndPublicBoundary(t *testing.T) {
	path := filepath.Join(t.TempDir(), "settings.json")
	secrets := fakeSecretStore{}
	store, err := newStore(path, secrets)
	if err != nil {
		t.Fatal(err)
	}
	settings := DefaultSettings()
	settings.Providers["deepseek"] = ProviderConfig{APIKey: "provider-secret", Enabled: true}
	settings.Relay = &RelayConfig{Enabled: true, URL: "https://relay.example", Key: "relay-secret"}
	if err := store.Save(settings); err != nil {
		t.Fatal(err)
	}

	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(data), "provider-secret") || strings.Contains(string(data), "relay-secret") {
		t.Fatalf("settings file contains a credential: %s", data)
	}
	public := store.Get()
	if public.Providers["deepseek"].APIKey != "" || !public.Providers["deepseek"].HasAPIKey {
		t.Fatalf("public provider settings leaked or lost credential status: %#v", public.Providers["deepseek"])
	}
	if public.Relay.Key != "" || !public.Relay.HasKey {
		t.Fatalf("public relay settings leaked or lost credential status: %#v", public.Relay)
	}
	resolved := store.GetResolved()
	if resolved.Providers["deepseek"].APIKey != "provider-secret" || resolved.Relay.Key != "relay-secret" {
		t.Fatal("engine settings did not resolve stored credentials")
	}
}

func TestStoreMigratesLegacyPlaintextCredentials(t *testing.T) {
	path := filepath.Join(t.TempDir(), "settings.json")
	legacy := `{"active_provider":"deepseek","active_model":"deepseek-v4-flash","providers":{"deepseek":{"api_key":"legacy-secret","enabled":true}}}`
	if err := os.WriteFile(path, []byte(legacy), 0o600); err != nil {
		t.Fatal(err)
	}
	secrets := fakeSecretStore{}
	store, err := newStore(path, secrets)
	if err != nil {
		t.Fatal(err)
	}
	if secrets[providerSecretAccount("deepseek")] != "legacy-secret" {
		t.Fatal("legacy credential was not migrated")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(data), "legacy-secret") {
		t.Fatalf("legacy credential remained in settings: %s", data)
	}
	if !store.Get().Providers["deepseek"].HasAPIKey {
		t.Fatal("migrated credential status is missing")
	}
}

func TestStoreRemovesCredentialOnlyWhenExplicitlyRequested(t *testing.T) {
	path := filepath.Join(t.TempDir(), "settings.json")
	secrets := fakeSecretStore{}
	store, err := newStore(path, secrets)
	if err != nil {
		t.Fatal(err)
	}
	settings := DefaultSettings()
	settings.Providers["openai"] = ProviderConfig{APIKey: "secret", Enabled: true}
	if err := store.Save(settings); err != nil {
		t.Fatal(err)
	}

	public := store.Get()
	provider := public.Providers["openai"]
	provider.RemoveAPIKey = true
	public.Providers["openai"] = provider
	if err := store.Save(public); err != nil {
		t.Fatal(err)
	}
	if _, err := secrets.Get(providerSecretAccount("openai")); !errors.Is(err, errSecretNotFound) {
		t.Fatalf("credential still exists: %v", err)
	}
	if store.Get().Providers["openai"].HasAPIKey {
		t.Fatal("removed credential still appears configured")
	}
}
