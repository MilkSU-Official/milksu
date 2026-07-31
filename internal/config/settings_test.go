package config

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
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

type failingSetSecretStore struct {
	fakeSecretStore
	err error
}

func (s failingSetSecretStore) Set(string, string) error {
	return s.err
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
	settings.NSSCTFArena = &NSSCTFArenaConfig{Token: "nss_agent_arena-secret"}
	if err := store.Save(settings); err != nil {
		t.Fatal(err)
	}

	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(data), "provider-secret") ||
		strings.Contains(string(data), "relay-secret") ||
		strings.Contains(string(data), "arena-secret") {
		t.Fatalf("settings file contains a credential: %s", data)
	}
	public := store.Get()
	if public.Providers["deepseek"].APIKey != "" || !public.Providers["deepseek"].HasAPIKey {
		t.Fatalf("public provider settings leaked or lost credential status: %#v", public.Providers["deepseek"])
	}
	if public.Relay.Key != "" || !public.Relay.HasKey {
		t.Fatalf("public relay settings leaked or lost credential status: %#v", public.Relay)
	}
	if public.NSSCTFArena.Token != "" || !public.NSSCTFArena.HasToken {
		t.Fatalf("public NSSCTF Arena settings leaked or lost token status: %#v", public.NSSCTFArena)
	}
	resolved := store.GetResolved()
	if resolved.Providers["deepseek"].APIKey != "provider-secret" ||
		resolved.Relay.Key != "relay-secret" ||
		resolved.NSSCTFArena.Token != "nss_agent_arena-secret" {
		t.Fatal("engine settings did not resolve stored credentials")
	}
}

func TestStorePersistsAndInvalidatesModelVerification(t *testing.T) {
	path := filepath.Join(t.TempDir(), "settings.json")
	store, err := newStore(path, fakeSecretStore{})
	if err != nil {
		t.Fatal(err)
	}
	settings := DefaultSettings()
	settings.Providers["deepseek"] = ProviderConfig{APIKey: "provider-secret", Enabled: true}
	if err := store.Save(settings); err != nil {
		t.Fatal(err)
	}
	verifiedAt := time.Date(2026, 7, 31, 4, 30, 0, 0, time.UTC)
	if err := store.RecordModelVerification("deepseek", "deepseek-v4-flash", verifiedAt); err != nil {
		t.Fatal(err)
	}
	verification := store.Get().ModelVerified
	if verification == nil ||
		verification.Provider != "deepseek" ||
		verification.Model != "deepseek-v4-flash" ||
		verification.VerifiedAt != "2026-07-31T04:30:00Z" {
		t.Fatalf("unexpected model verification: %#v", verification)
	}

	reloaded, err := newStore(path, store.secretStore)
	if err != nil {
		t.Fatal(err)
	}
	if reloaded.Get().ModelVerified == nil {
		t.Fatal("model verification did not survive restart")
	}

	changed := reloaded.Get()
	changed.ActiveModel = "deepseek-v4-pro"
	if err := reloaded.Save(changed); err != nil {
		t.Fatal(err)
	}
	if reloaded.Get().ModelVerified != nil {
		t.Fatal("changing the active model must invalidate prior verification")
	}
}

func TestStoreValidatesBaseURLAndInvalidatesVerificationWhenItChanges(t *testing.T) {
	path := filepath.Join(t.TempDir(), "settings.json")
	store, err := newStore(path, fakeSecretStore{})
	if err != nil {
		t.Fatal(err)
	}
	firstURL := "https://api.deepseek.com"
	settings := DefaultSettings()
	settings.Providers["deepseek"] = ProviderConfig{
		APIKey:  "provider-secret",
		BaseURL: &firstURL,
		Enabled: true,
	}
	if err := store.Save(settings); err != nil {
		t.Fatal(err)
	}
	if err := store.RecordModelVerification("deepseek", "deepseek-v4-flash", time.Now()); err != nil {
		t.Fatal(err)
	}

	changed := store.Get()
	secondURL := "https://gateway.example.test/v1"
	provider := changed.Providers["deepseek"]
	provider.BaseURL = &secondURL
	changed.Providers["deepseek"] = provider
	if err := store.Save(changed); err != nil {
		t.Fatal(err)
	}
	if store.Get().ModelVerified != nil {
		t.Fatal("changing the active provider Base URL must invalidate prior verification")
	}

	invalid := store.Get()
	badURL := "file:///tmp/provider"
	provider = invalid.Providers["deepseek"]
	provider.BaseURL = &badURL
	invalid.Providers["deepseek"] = provider
	if err := store.Save(invalid); err == nil || !strings.Contains(err.Error(), "must use http or https") {
		t.Fatalf("expected invalid provider Base URL rejection, got %v", err)
	}
}

func TestStoreRejectsVerificationForInactiveModel(t *testing.T) {
	store, err := newStore(filepath.Join(t.TempDir(), "settings.json"), fakeSecretStore{})
	if err != nil {
		t.Fatal(err)
	}
	err = store.RecordModelVerification("openai", "gpt-4.1", time.Now())
	if err == nil || !strings.Contains(err.Error(), "no longer matches active model") {
		t.Fatalf("expected inactive-model verification rejection, got %v", err)
	}
}

func TestStoreKeepsCredentialInSessionWhenKeychainWriteFails(t *testing.T) {
	path := filepath.Join(t.TempDir(), "settings.json")
	store, err := newStore(path, failingSetSecretStore{
		fakeSecretStore: fakeSecretStore{},
		err:             errors.New("keychain locked"),
	})
	if err != nil {
		t.Fatal(err)
	}
	settings := DefaultSettings()
	settings.Providers["deepseek"] = ProviderConfig{APIKey: "session-secret", Enabled: true}

	err = store.Save(settings)
	if err == nil || !strings.Contains(err.Error(), "keychain locked") {
		t.Fatalf("expected actionable persistence error, got %v", err)
	}
	public := store.Get().Providers["deepseek"]
	if !public.HasAPIKey || !public.SessionOnly || public.APIKey != "" {
		t.Fatalf("unexpected public session credential state: %#v", public)
	}
	if resolved := store.GetResolved().Providers["deepseek"].APIKey; resolved != "session-secret" {
		t.Fatal("session credential is unavailable to the local engine")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(data), "session-secret") || strings.Contains(string(data), "session_only") {
		t.Fatalf("session credential metadata leaked to disk: %s", data)
	}

	reloaded, err := newStore(path, fakeSecretStore{})
	if err != nil {
		t.Fatal(err)
	}
	if reloaded.Get().Providers["deepseek"].HasAPIKey {
		t.Fatal("session-only credential survived a simulated restart")
	}
}

func TestStoreSkipsPersistentSecretStoreForExplicitSessionCredential(t *testing.T) {
	path := filepath.Join(t.TempDir(), "settings.json")
	store, err := newStore(path, failingSetSecretStore{
		fakeSecretStore: fakeSecretStore{},
		err:             errors.New("persistent store must not be called"),
	})
	if err != nil {
		t.Fatal(err)
	}
	settings := DefaultSettings()
	settings.Providers["deepseek"] = ProviderConfig{
		APIKey:      "session-secret",
		Enabled:     true,
		SessionOnly: true,
	}

	if err := store.Save(settings); err != nil {
		t.Fatalf("explicit session credential unexpectedly touched persistent storage: %v", err)
	}
	public := store.Get().Providers["deepseek"]
	if !public.HasAPIKey || !public.SessionOnly || public.APIKey != "" {
		t.Fatalf("unexpected public session credential state: %#v", public)
	}
	if resolved := store.GetResolved().Providers["deepseek"].APIKey; resolved != "session-secret" {
		t.Fatal("explicit session credential is unavailable to the local engine")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(data), "session-secret") || strings.Contains(string(data), "session_only") {
		t.Fatalf("session credential metadata leaked to disk: %s", data)
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

func TestStoreNormalizesAndExplicitlyRemovesArenaToken(t *testing.T) {
	path := filepath.Join(t.TempDir(), "settings.json")
	secrets := fakeSecretStore{}
	store, err := newStore(path, secrets)
	if err != nil {
		t.Fatal(err)
	}
	settings := DefaultSettings()
	settings.NSSCTFArena = &NSSCTFArenaConfig{Token: "  nss_agent_arena-secret  "}
	if err := store.Save(settings); err != nil {
		t.Fatal(err)
	}
	if resolved := store.GetResolved().NSSCTFArena.Token; resolved != "nss_agent_arena-secret" {
		t.Fatalf("Arena token was not normalized: %q", resolved)
	}

	public := store.Get()
	public.NSSCTFArena.RemoveToken = true
	if err := store.Save(public); err != nil {
		t.Fatal(err)
	}
	if _, err := secrets.Get(nssctfArenaSecretAccount); !errors.Is(err, errSecretNotFound) {
		t.Fatalf("Arena token still exists: %v", err)
	}
	if store.Get().NSSCTFArena.HasToken {
		t.Fatal("removed Arena token still appears configured")
	}
}
