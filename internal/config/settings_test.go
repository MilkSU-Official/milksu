package config

import (
	"encoding/json"
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
	settings := withDefaults(AppSettings{DisabledSkills: []string{
		" product-design ",
		"product-design",
		"../../untrusted",
		"-review-security",
		"release-milksu-",
		"review-security",
	}})
	if settings.ActiveProvider != presetDeepSeekServiceID || settings.ActiveModel != "deepseek-flash" {
		t.Fatalf("unexpected defaults: %#v", settings)
	}
	if settings.DefaultKernel != "pi" {
		t.Fatalf("default kernel should be pi: %q", settings.DefaultKernel)
	}
	if settings.BusySend != "interrupt" {
		t.Fatalf("default busy send should be interrupt: %q", settings.BusySend)
	}
	if got := NormalizeBusySend("排队"); got != "queue" {
		t.Fatalf("NormalizeBusySend(排队)=%q", got)
	}
	if got := NormalizeDefaultKernel("DSH"); got != "dsh" {
		t.Fatalf("NormalizeDefaultKernel(DSH)=%q", got)
	}
	if got := NormalizeDefaultKernel(""); got != "pi" {
		t.Fatalf("NormalizeDefaultKernel empty=%q", got)
	}
	if got := NormalizeDefaultKernel("pi"); got != "pi" {
		t.Fatalf("NormalizeDefaultKernel(pi)=%q", got)
	}
	if settings.PreferredExternalEditor != "vscode" {
		t.Fatalf("expected default VS Code editor, got %q", settings.PreferredExternalEditor)
	}
	if settings.Providers == nil {
		t.Fatal("providers map must be initialized")
	}
	if len(settings.ModelRouting.SourceOrder) != 2 ||
		settings.ModelRouting.SourceOrder[0] != ModelSourceAccount ||
		settings.ModelRouting.AutoFallback == nil ||
		*settings.ModelRouting.AutoFallback {
		t.Fatalf("unexpected model routing defaults: %#v", settings.ModelRouting)
	}
	if len(settings.DisabledSkills) != 2 ||
		settings.DisabledSkills[0] != "product-design" ||
		settings.DisabledSkills[1] != "review-security" {
		t.Fatalf("unexpected disabled skills: %#v", settings.DisabledSkills)
	}
	if settings.Lab == nil || settings.Lab.AutoCreateAVD == nil || !*settings.Lab.AutoCreateAVD {
		t.Fatalf("lab auto-create should default on: %#v", settings.Lab)
	}
	preset, ok := settings.Providers[presetDeepSeekServiceID]
	if !ok || !preset.Custom || preset.Name != "DeepSeek" || preset.Enabled ||
		preset.BaseURL == nil || *preset.BaseURL != presetDeepSeekBaseURL ||
		len(preset.Models) != 2 || preset.Models[0] != "deepseek-flash" {
		t.Fatalf("expected default DeepSeek service: %#v", preset)
	}
}

func TestStorePersistsLocaleKernelAndActiveModel(t *testing.T) {
	path := filepath.Join(t.TempDir(), "settings.json")
	store, err := newStore(path, fakeSecretStore{})
	if err != nil {
		t.Fatal(err)
	}
	locale := "en"
	settings := store.Get()
	settings.Locale = &locale
	settings.DefaultKernel = "dsh"
	settings.BusySend = "queue"
	settings.UiFont = "geist"
	settings.ConversationFont = "noto-serif-sc"
	settings.UiFontSize = "15"
	settings.ConversationFontSize = "12"
	settings.ActiveProvider = presetDeepSeekServiceID
	settings.ActiveModel = "deepseek-v4-pro"
	if err := store.Save(settings); err != nil {
		t.Fatal(err)
	}

	reloaded, err := newStore(path, fakeSecretStore{})
	if err != nil {
		t.Fatal(err)
	}
	got := reloaded.Get()
	if got.Locale == nil || *got.Locale != "en" {
		t.Fatalf("locale did not persist: %#v", got.Locale)
	}
	if got.DefaultKernel != "dsh" {
		t.Fatalf("default kernel did not persist: %q", got.DefaultKernel)
	}
	if got.BusySend != "queue" {
		t.Fatalf("busy send did not persist: %q", got.BusySend)
	}
	if got.UiFont != "geist" || got.ConversationFont != "noto-serif-sc" {
		t.Fatalf("fonts did not persist: %q / %q", got.UiFont, got.ConversationFont)
	}
	if got.UiFontSize != "15" || got.ConversationFontSize != "12" {
		t.Fatalf("font sizes did not persist: %q / %q", got.UiFontSize, got.ConversationFontSize)
	}
	if got.ActiveProvider != presetDeepSeekServiceID || got.ActiveModel != "deepseek-v4-pro" {
		t.Fatalf("active model did not persist: %s/%s", got.ActiveProvider, got.ActiveModel)
	}
}

func TestNormalizeUiFontSizeUsesConcretePixels(t *testing.T) {
	if got := NormalizeUiFontSize("15px"); got != "15" {
		t.Fatalf("15px: %q", got)
	}
	if got := NormalizeUiFontSize("16"); got != "16" {
		t.Fatalf("16: %q", got)
	}
	if got := NormalizeUiFontSize("large"); got != "13" {
		t.Fatalf("invalid preset: %q", got)
	}
	if got := NormalizeUiFontSize("10"); got != "13" {
		t.Fatalf("below range: %q", got)
	}
	if got := NormalizeUiFontSize("19"); got != "13" {
		t.Fatalf("above range: %q", got)
	}
}

func TestNormalizeUiEmphasis(t *testing.T) {
	if got := NormalizeUiEmphasis(""); got != "default" {
		t.Fatalf("empty: %q", got)
	}
	if got := NormalizeUiEmphasis("blue"); got != "blue" {
		t.Fatalf("blue: %q", got)
	}
	if got := NormalizeUiEmphasis("purple"); got != "violet" {
		t.Fatalf("purple alias: %q", got)
	}
	if got := NormalizeUiEmphasis("neon"); got != "default" {
		t.Fatalf("unknown: %q", got)
	}
}

func TestResolveSubmittedUsesJustWrittenDeepSeekKey(t *testing.T) {
	path := filepath.Join(t.TempDir(), "settings.json")
	store, err := newStore(path, fakeSecretStore{})
	if err != nil {
		t.Fatal(err)
	}
	stored := store.Get()
	preset := stored.Providers[presetDeepSeekServiceID]
	if preset.Enabled || preset.HasAPIKey || preset.APIKey != "" {
		t.Fatalf("store DeepSeek should start disabled and unkeyed: %#v", preset)
	}

	baseURL := presetDeepSeekBaseURL
	submitted := stored
	submitted.ActiveProvider = presetDeepSeekServiceID
	submitted.ActiveModel = "deepseek-flash"
	submitted.Providers[presetDeepSeekServiceID] = ProviderConfig{
		Custom:  true,
		Name:    "DeepSeek",
		Enabled: true,
		APIKey:  "deepseek-test-secret",
		BaseURL: &baseURL,
		Models:  []string{"deepseek-flash", "deepseek-v4-pro"},
	}
	resolved := store.ResolveSubmitted(submitted)
	if resolved.ActiveProvider != presetDeepSeekServiceID || resolved.ActiveModel != "deepseek-flash" {
		t.Fatalf("submitted DeepSeek was remapped: %s/%s", resolved.ActiveProvider, resolved.ActiveModel)
	}
	got := resolved.Providers[presetDeepSeekServiceID]
	if !got.Enabled || !got.Custom || got.APIKey != "deepseek-test-secret" {
		t.Fatalf("probe snapshot ignored the submitted DeepSeek key: %#v", got)
	}
}

func TestWithDefaultsDoesNotRemapCustomRelayDeepSeek(t *testing.T) {
	baseURL := presetDeepSeekBaseURL
	settings := withDefaults(AppSettings{
		ActiveProvider: presetDeepSeekServiceID,
		ActiveModel:    "deepseek-flash",
		Providers: map[string]ProviderConfig{
			presetDeepSeekServiceID: {
				Custom:  true,
				Name:    "DeepSeek",
				Enabled: true,
				BaseURL: &baseURL,
				Models:  []string{"deepseek-flash", "deepseek-v4-pro"},
			},
		},
	})
	if settings.ActiveProvider != presetDeepSeekServiceID || settings.ActiveModel != "deepseek-flash" {
		t.Fatalf("custom-relay-deepseek was remapped to %s/%s", settings.ActiveProvider, settings.ActiveModel)
	}
}

func TestRemovedDeepSeekPresetIsNotReseeded(t *testing.T) {
	settings := withDefaults(AppSettings{
		RemovedPresetServices: []string{presetDeepSeekServiceID, "custom-relay-other"},
	})
	if _, exists := settings.Providers[presetDeepSeekServiceID]; exists {
		t.Fatal("removed DeepSeek preset was put back")
	}
	if settings.ActiveProvider != "tokenflux" || settings.ActiveModel != "x-ai/grok-4.6" {
		t.Fatalf("removed DeepSeek should fall back to TokenFlux, got %s/%s", settings.ActiveProvider, settings.ActiveModel)
	}
	if len(settings.RemovedPresetServices) != 1 || settings.RemovedPresetServices[0] != presetDeepSeekServiceID {
		t.Fatalf("unexpected removed presets: %#v", settings.RemovedPresetServices)
	}
}

func TestWithDefaultsRemapsStaleOfficialProviderToDeepSeek(t *testing.T) {
	settings := withDefaults(AppSettings{
		ActiveProvider: "deepseek",
		ActiveModel:    "unknown-model",
	})
	if settings.ActiveProvider != presetDeepSeekServiceID || settings.ActiveModel != "deepseek-flash" {
		t.Fatalf("stale official DeepSeek remapped to %s/%s", settings.ActiveProvider, settings.ActiveModel)
	}
}

func TestWithDefaultsKeepsExplicitTokenFlux(t *testing.T) {
	settings := withDefaults(AppSettings{
		ActiveProvider: "tokenflux",
		ActiveModel:    "x-ai/grok-4.6",
	})
	if settings.ActiveProvider != "tokenflux" || settings.ActiveModel != "x-ai/grok-4.6" {
		t.Fatalf("explicit TokenFlux was remapped: %s/%s", settings.ActiveProvider, settings.ActiveModel)
	}
}

func TestNormalizeOptionalSkillsAndWorkerModel(t *testing.T) {
	settings := withDefaults(AppSettings{
		EnabledOptionalSkills: []string{" jadx ", "product-design", "ghidra-rpc", "../../x"},
		WorkerProvider:        "tokenflux",
		WorkerModel:           "grok-4.5",
		WorkerSource:          "account",
	})
	if len(settings.EnabledOptionalSkills) != 2 ||
		settings.EnabledOptionalSkills[0] != "jadx" ||
		settings.EnabledOptionalSkills[1] != "ghidra-rpc" {
		t.Fatalf("unexpected optional skills: %#v", settings.EnabledOptionalSkills)
	}
	selection, ok := ResolveWorkerModel(settings)
	if !ok || selection.Provider != "tokenflux" || selection.Model != "grok-4.5" || selection.Source != "account" {
		t.Fatalf("unexpected worker model: %#v", selection)
	}
	cleared := withDefaults(AppSettings{WorkerProvider: "tokenflux"})
	if _, ok := ResolveWorkerModel(cleared); ok {
		t.Fatal("empty worker model should inherit")
	}
}

func TestCloneDoesNotShareMaps(t *testing.T) {
	original := DefaultSettings()
	original.Providers["openai"] = ProviderConfig{APIKey: "secret", Enabled: true}
	original.Providers["custom-relay-local"] = ProviderConfig{
		Custom: true, Name: "Local relay", Models: []string{"model-a"}, Enabled: true,
	}
	original.DisabledSkills = []string{"product-design"}
	original.EnabledOptionalSkills = []string{"jadx"}
	original.WorkerProvider = "tokenflux"
	original.WorkerModel = "grok-4.5"
	original.WorkerSource = "account"
	original.SecurityTools = map[string]SecurityToolPreference{
		"capa": {Enabled: true},
	}
	original.ModelContextWindows = map[string]map[string]int{
		"tokenflux": {"x-ai/grok-4.6": 2_000_000},
	}
	copied := clone(original)
	delete(copied.Providers, "openai")
	custom := copied.Providers["custom-relay-local"]
	custom.Models[0] = "model-b"
	copied.Providers["custom-relay-local"] = custom
	copied.ModelRouting.SourceOrder[0] = ModelSourcePersonal
	*copied.ModelRouting.AutoFallback = true
	copied.DisabledSkills[0] = "review-security"
	copied.EnabledOptionalSkills[0] = "ghidra-rpc"
	copied.WorkerModel = "other"
	copied.SecurityTools["capa"] = SecurityToolPreference{Enabled: false}
	if _, exists := original.Providers["openai"]; !exists {
		t.Fatal("clone modified original provider map")
	}
	if original.Providers["custom-relay-local"].Models[0] != "model-a" {
		t.Fatal("clone shared custom relay models")
	}
	if original.ModelRouting.SourceOrder[0] != ModelSourceAccount ||
		original.ModelRouting.AutoFallback == nil ||
		*original.ModelRouting.AutoFallback {
		t.Fatal("clone modified original model routing")
	}
	if original.DisabledSkills[0] != "product-design" {
		t.Fatal("clone modified original disabled skills")
	}
	if original.EnabledOptionalSkills[0] != "jadx" {
		t.Fatal("clone modified original optional skills")
	}
	if original.WorkerModel != "grok-4.5" {
		t.Fatal("clone modified original worker model")
	}
	if !original.SecurityTools["capa"].Enabled {
		t.Fatal("clone modified original security tool preference")
	}
	copied.ModelContextWindows["tokenflux"]["x-ai/grok-4.6"] = 128_000
	if original.ModelContextWindows["tokenflux"]["x-ai/grok-4.6"] != 2_000_000 {
		t.Fatal("clone modified original model context windows")
	}
}

func TestManagedSecretsStayOnTheMCPPrefix(t *testing.T) {
	path := filepath.Join(t.TempDir(), "settings.json")
	secrets := fakeSecretStore{}
	store, err := newStore(path, secrets)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.PutManagedSecret("provider:tokenflux", "nope"); err == nil {
		t.Fatal("expected foreign secret account to be rejected")
	}
	if err := store.PutManagedSecret("mcp.user.github.env.GITHUB_TOKEN", "ghp_test"); err != nil {
		t.Fatal(err)
	}
	value, err := store.LookupManagedSecret("mcp.user.github.env.GITHUB_TOKEN")
	if err != nil || value != "ghp_test" {
		t.Fatalf("lookup managed secret: %q %v", value, err)
	}
	if _, err := store.LookupManagedSecret("provider:tokenflux"); err == nil {
		t.Fatal("expected foreign lookup to be rejected")
	}
}

func TestManagedAccountRelayPersistsOnlyInCredentialStore(t *testing.T) {
	path := filepath.Join(t.TempDir(), "settings.json")
	secrets := fakeSecretStore{}
	store, err := newStore(path, secrets)
	if err != nil {
		t.Fatal(err)
	}
	const credential = "account-assigned-provider-key"
	const baseURL = "https://tokenflux.dev/v1"
	changed, err := store.SetManagedAccountRelay(baseURL, credential)
	if err != nil {
		t.Fatal(err)
	}
	if !changed {
		t.Fatal("first managed relay update was not reported as changed")
	}
	changed, err = store.SetManagedAccountRelay(baseURL, credential)
	if err != nil || changed {
		t.Fatalf("identical managed relay update was not idempotent: changed=%v err=%v", changed, err)
	}
	public := store.Get()
	if public.Relay == nil || public.Relay.Key != "" || !public.Relay.HasKey || public.Relay.SessionOnly {
		t.Fatalf("managed account credential leaked or was not marked persisted: %#v", public.Relay)
	}
	resolved := store.GetResolved()
	if resolved.Relay == nil || resolved.Relay.Key != credential || resolved.Relay.URL != baseURL || !resolved.Relay.Enabled {
		t.Fatalf("managed account credential was not resolved: %#v", resolved.Relay)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(data), credential) {
		t.Fatal("managed account credential leaked into settings.json")
	}
	if secrets[relaySecretAccount] != credential {
		t.Fatal("managed account credential was not persisted in the credential store")
	}
	cleared, err := store.ClearManagedAccountRelay()
	if err != nil || !cleared {
		t.Fatalf("managed relay clear failed: changed=%v err=%v", cleared, err)
	}
	cleared, err = store.ClearManagedAccountRelay()
	if err != nil || cleared {
		t.Fatalf("managed relay clear was not idempotent: changed=%v err=%v", cleared, err)
	}
	if _, exists := secrets[relaySecretAccount]; exists {
		t.Fatal("managed account credential was not removed from the credential store")
	}
}

func TestStorePersistsCustomRelayMetadataAndKeepsCredentialPrivate(t *testing.T) {
	path := filepath.Join(t.TempDir(), "settings.json")
	secrets := fakeSecretStore{}
	store, err := newStore(path, secrets)
	if err != nil {
		t.Fatal(err)
	}
	baseURL := "https://relay.example.test/v1"
	settings := DefaultSettings()
	settings.ActiveProvider = "custom-relay-example"
	settings.ActiveModel = "vendor/model-a"
	settings.Providers["custom-relay-example"] = ProviderConfig{
		Custom:  true,
		Name:    "Example relay",
		Models:  []string{" vendor/model-a ", "vendor/model-a", "vendor/model-b"},
		BaseURL: &baseURL,
		APIKey:  "custom-secret",
		Enabled: true,
	}
	if err := store.Save(settings); err != nil {
		t.Fatal(err)
	}

	public := store.Get()
	provider := public.Providers["custom-relay-example"]
	if !provider.Custom || provider.Name != "Example relay" ||
		len(provider.Models) != 2 || provider.Models[0] != "vendor/model-a" ||
		!provider.HasAPIKey || provider.APIKey != "" {
		t.Fatalf("unexpected public custom relay: %#v", provider)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(data), "custom-secret") {
		t.Fatal("custom relay credential leaked into settings.json")
	}
	if resolved := store.GetResolved().Providers["custom-relay-example"].APIKey; resolved != "custom-secret" {
		t.Fatal("custom relay credential was not resolved for the engine")
	}

	removed := store.Get()
	delete(removed.Providers, "custom-relay-example")
	removed.ActiveProvider = "tokenflux"
	removed.ActiveModel = "x-ai/grok-4.6"
	if err := store.Save(removed); err != nil {
		t.Fatal(err)
	}
	if _, exists := secrets[providerSecretAccount("custom-relay-example")]; exists {
		t.Fatal("removing a custom relay retained its credential")
	}
}

func TestStoreRejectsIncompleteCustomRelay(t *testing.T) {
	store, err := newStore(filepath.Join(t.TempDir(), "settings.json"), fakeSecretStore{})
	if err != nil {
		t.Fatal(err)
	}
	settings := DefaultSettings()
	baseURL := "file:///tmp/relay"
	settings.Providers["custom-relay-invalid"] = ProviderConfig{
		Custom: true, Name: "Invalid", Models: []string{"model"}, BaseURL: &baseURL,
	}
	if err := store.Save(settings); err == nil || !strings.Contains(err.Error(), "must use http or https") {
		t.Fatalf("expected custom relay URL validation, got %v", err)
	}
}

func TestSetSecurityToolEnabledPersistsOnePreference(t *testing.T) {
	path := filepath.Join(t.TempDir(), "settings.json")
	store, err := newStore(path, fakeSecretStore{})
	if err != nil {
		t.Fatal(err)
	}
	if err := store.SetSecurityToolEnabled("ida-pro", false); err != nil {
		t.Fatal(err)
	}
	if store.Get().SecurityTools["ida-pro"].Enabled {
		t.Fatal("disabled preference was not retained")
	}
	reloaded, err := newStore(path, fakeSecretStore{})
	if err != nil {
		t.Fatal(err)
	}
	if reloaded.Get().SecurityTools["ida-pro"].Enabled {
		t.Fatal("disabled preference was not persisted")
	}
	if err := store.SetSecurityToolEnabled("../unsafe", true); err == nil {
		t.Fatal("invalid security tool id was accepted")
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
	settings.ActiveProvider = "deepseek"
	settings.ActiveModel = "deepseek-v4-flash"
	settings.Providers["deepseek"] = ProviderConfig{APIKey: "provider-secret", Enabled: true}
	settings.Relay = &RelayConfig{Enabled: true, URL: "https://tokenflux.dev/v1", Key: "relay-secret"}
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
	settings.ActiveProvider = "tokenflux"
	settings.ActiveModel = "x-ai/grok-4.6"
	settings.Providers["tokenflux"] = ProviderConfig{APIKey: "provider-secret", Enabled: true}
	if err := store.Save(settings); err != nil {
		t.Fatal(err)
	}
	verifiedAt := time.Date(2026, 7, 31, 4, 30, 0, 0, time.UTC)
	if err := store.RecordModelVerification("tokenflux", "x-ai/grok-4.6", verifiedAt); err != nil {
		t.Fatal(err)
	}
	verification := store.Get().ModelVerified
	if verification == nil ||
		verification.Provider != "tokenflux" ||
		verification.Model != "x-ai/grok-4.6" ||
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
	changed.ActiveModel = "x-ai/grok-4.5"
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
	firstURL := "https://tokenflux.dev/v1"
	settings := DefaultSettings()
	settings.ActiveProvider = "tokenflux"
	settings.ActiveModel = "x-ai/grok-4.6"
	settings.Providers["tokenflux"] = ProviderConfig{
		APIKey:  "provider-secret",
		BaseURL: &firstURL,
		Enabled: true,
	}
	if err := store.Save(settings); err != nil {
		t.Fatal(err)
	}
	if err := store.RecordModelVerification("tokenflux", "x-ai/grok-4.6", time.Now()); err != nil {
		t.Fatal(err)
	}

	changed := store.Get()
	secondURL := "https://gateway.example.test/v1"
	provider := changed.Providers["tokenflux"]
	provider.BaseURL = &secondURL
	changed.Providers["tokenflux"] = provider
	if err := store.Save(changed); err != nil {
		t.Fatal(err)
	}
	if store.Get().ModelVerified != nil {
		t.Fatal("changing the active provider Base URL must invalidate prior verification")
	}

	invalid := store.Get()
	badURL := "file:///tmp/provider"
	provider = invalid.Providers["tokenflux"]
	provider.BaseURL = &badURL
	invalid.Providers["tokenflux"] = provider
	if err := store.Save(invalid); err == nil || !strings.Contains(err.Error(), "must use http or https") {
		t.Fatalf("expected invalid provider Base URL rejection, got %v", err)
	}
}

func TestStoreRequiresHTTPSForAccountModelCredentials(t *testing.T) {
	store, err := newStore(filepath.Join(t.TempDir(), "settings.json"), fakeSecretStore{})
	if err != nil {
		t.Fatal(err)
	}
	settings := DefaultSettings()
	settings.Relay = &RelayConfig{
		Enabled: true,
		URL:     "http://tokenflux.invalid/v1",
		Key:     "account-secret",
	}
	if err := store.Save(settings); err == nil || !strings.Contains(err.Error(), "must use https") {
		t.Fatalf("expected insecure account model URL rejection, got %v", err)
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

// The collaboration gate must never widen from a stale or hand-edited file: ids are trimmed,
// self and duplicate entries drop out, and an all-empty list stays empty.
func TestWithDefaultsNormalizesAgentCollaboration(t *testing.T) {
	settings := withDefaults(AppSettings{
		AgentCollaboration: &AgentCollaborationConfig{
			AllowCrossConversation: true,
			AllowByConversation: map[string][]string{
				" conversation-a ": {"conversation-b", "conversation-b", "conversation-a", "  "},
				"":                 {"conversation-b"},
				"conversation-c":   {},
			},
		},
	})
	if settings.AgentCollaboration == nil {
		t.Fatal("the collaboration config must survive withDefaults")
	}
	if !settings.AgentCollaboration.AllowCrossConversation {
		t.Fatal("the switch must survive withDefaults")
	}
	got := settings.AgentCollaboration.AllowByConversation
	if len(got) != 1 || len(got["conversation-a"]) != 1 || got["conversation-a"][0] != "conversation-b" {
		t.Fatalf("allow_by_conversation = %#v, want only conversation-a -> [conversation-b]", got)
	}
	if _, exists := got[""]; exists {
		t.Fatal("an empty source id must be dropped")
	}
	// Off with no list is the product default and must stay nil-ish (no accidental opening).
	empty := withDefaults(AppSettings{})
	if empty.AgentCollaboration != nil {
		t.Fatalf("an untouched settings file must have no collaboration config, got %#v", empty.AgentCollaboration)
	}
}

// The result-reply grant is normalized the same way: no empty/self/duplicate entries can
// survive to widen who may answer a conversation.
func TestWithDefaultsNormalizesResultReplyGrants(t *testing.T) {
	settings := withDefaults(AppSettings{
		AgentCollaboration: &AgentCollaborationConfig{
			AllowCrossConversation:    true,
			ResultReplyByConversation: map[string][]string{" asked ": {"replier", "replier", "asked", ""}},
		},
	})
	if settings.AgentCollaboration == nil {
		t.Fatal("the collaboration config must survive withDefaults")
	}
	got := settings.AgentCollaboration.ResultReplyByConversation
	if len(got) != 1 || len(got["asked"]) != 1 || got["asked"][0] != "replier" {
		t.Fatalf("result_reply_by_conversation = %#v, want only asked -> [replier]", got)
	}
}

// The collaboration gate is sealed by an app-owned file: an agent that edits settings.json by
// hand cannot make its change the reference, and the app says so.
func TestCollaborationSealRefusesAnOutsideEdit(t *testing.T) {
	path := filepath.Join(t.TempDir(), "settings.json")
	store, err := newStore(path, fakeSecretStore{})
	if err != nil {
		t.Fatalf("new store: %v", err)
	}
	on := &AgentCollaborationConfig{
		AllowCrossConversation: true,
		AllowByConversation:    map[string][]string{"conversation-a": {"conversation-b"}},
	}
	if err := store.SetAgentCollaboration(on); err != nil {
		t.Fatalf("set collaboration: %v", err)
	}

	// The agent rewrites settings.json behind the app's back.
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read settings: %v", err)
	}
	var tampered map[string]any
	if err := json.Unmarshal(raw, &tampered); err != nil {
		t.Fatalf("decode settings: %v", err)
	}
	tampered["agent_collaboration"] = map[string]any{"allow_cross_conversation": false}
	encoded, err := json.MarshalIndent(tampered, "", "  ")
	if err != nil {
		t.Fatalf("encode tampered settings: %v", err)
	}
	if err := os.WriteFile(path, encoded, 0o600); err != nil {
		t.Fatalf("write tampered settings: %v", err)
	}

	reloaded, err := newStore(path, fakeSecretStore{})
	if err != nil {
		t.Fatalf("reload store: %v", err)
	}
	if !reloaded.IntegrityWarning() {
		t.Fatal("an outside collaboration edit must raise the integrity warning")
	}
	if !reloaded.Get().SettingsIntegrityWarning {
		t.Fatal("the warning must reach the renderer through Get")
	}
	got := reloaded.Get().AgentCollaboration
	if got == nil || !got.AllowCrossConversation {
		t.Fatalf("the sealed value must stay in force, got %#v", got)
	}
	if len(got.AllowByConversation["conversation-a"]) != 1 {
		t.Fatalf("the sealed allow list must stay in force, got %#v", got.AllowByConversation)
	}
}

// A general settings save may not move the gate: only SetAgentCollaboration can.
func TestGeneralSaveCannotMoveTheCollaborationGate(t *testing.T) {
	path := filepath.Join(t.TempDir(), "settings.json")
	store, err := newStore(path, fakeSecretStore{})
	if err != nil {
		t.Fatalf("new store: %v", err)
	}
	if err := store.SetAgentCollaboration(&AgentCollaborationConfig{AllowCrossConversation: true}); err != nil {
		t.Fatalf("set collaboration: %v", err)
	}

	submitted := store.Get()
	submitted.AgentCollaboration = &AgentCollaborationConfig{AllowCrossConversation: false}
	submitted.PreferredExternalEditor = "vscode"
	if err := store.Save(submitted); err != nil {
		t.Fatalf("save: %v", err)
	}

	got := store.Get()
	if got.AgentCollaboration == nil || !got.AgentCollaboration.AllowCrossConversation {
		t.Fatalf("a general save must not move the gate, got %#v", got.AgentCollaboration)
	}
	if got.PreferredExternalEditor != "vscode" {
		t.Fatalf("the unrelated setting must still apply, got %q", got.PreferredExternalEditor)
	}

	// ...and the seal on disk agrees, so a reload stays consistent.
	reloaded, err := newStore(path, fakeSecretStore{})
	if err != nil {
		t.Fatalf("reload store: %v", err)
	}
	if reloaded.IntegrityWarning() {
		t.Fatal("no outside edit happened, so no warning is expected")
	}
	if reloaded.Get().AgentCollaboration == nil || !reloaded.Get().AgentCollaboration.AllowCrossConversation {
		t.Fatal("the gate must survive the reload")
	}
}

// A model that really failed once keeps a record of what happened, so the picker can mark it red
// instead of guessing. The record is persisted, keeps only the most recent failure per model, and
// disappears as soon as that model answers successfully once.
func TestStoreRecordsAndClearsAModelFailure(t *testing.T) {
	path := filepath.Join(t.TempDir(), "settings.json")
	store, err := newStore(path, fakeSecretStore{})
	if err != nil {
		t.Fatal(err)
	}
	// Never failed: nothing is marked.
	if failures := store.Get().ModelFailures; len(failures) != 0 {
		t.Fatalf("a fresh store must not report model failures: %#v", failures)
	}

	at := time.Date(2026, 9, 18, 17, 0, 0, 0, time.UTC)
	if err := store.RecordModelFailure(
		"custom-relay-deepseek",
		"deepseek-flash",
		"502 status code (no body)",
		at,
	); err != nil {
		t.Fatal(err)
	}

	reloaded, err := newStore(path, fakeSecretStore{})
	if err != nil {
		t.Fatal(err)
	}
	failures := reloaded.Get().ModelFailures
	if len(failures) != 1 {
		t.Fatalf("the failure must persist: %#v", failures)
	}
	if failures[0].Provider != "custom-relay-deepseek" || failures[0].Model != "deepseek-flash" {
		t.Fatalf("unexpected failure target: %#v", failures[0])
	}
	if !strings.Contains(failures[0].Reason, "502") {
		t.Fatalf("the reason must keep the provider text: %#v", failures[0])
	}
	if failures[0].At == "" {
		t.Fatalf("the failure must carry a time: %#v", failures[0])
	}

	// A second failure replaces the first: the picker shows the most recent one.
	if err := store.RecordModelFailure(
		"custom-relay-deepseek",
		"deepseek-flash",
		"connect: connection refused",
		at.Add(time.Hour),
	); err != nil {
		t.Fatal(err)
	}
	failures = store.Get().ModelFailures
	if len(failures) != 1 {
		t.Fatalf("only the most recent failure per model is kept: %#v", failures)
	}
	if !strings.Contains(failures[0].Reason, "connection refused") {
		t.Fatalf("the newer reason must replace the older one: %#v", failures[0])
	}

	// Another model's failure must not touch this one.
	if err := store.RecordModelFailure("tokenflux", "grok-4.6", "429 too many requests", at); err != nil {
		t.Fatal(err)
	}
	if failures := store.Get().ModelFailures; len(failures) != 2 {
		t.Fatalf("each model keeps its own record: %#v", failures)
	}

	// Answering successfully once clears it.
	if err := store.ClearModelFailure("custom-relay-deepseek", "deepseek-flash"); err != nil {
		t.Fatal(err)
	}
	failures = store.Get().ModelFailures
	if len(failures) != 1 || failures[0].Model != "grok-4.6" {
		t.Fatalf("a recovered model must lose its record: %#v", failures)
	}
	clearedReload, err := newStore(path, fakeSecretStore{})
	if err != nil {
		t.Fatal(err)
	}
	if failures := clearedReload.Get().ModelFailures; len(failures) != 1 {
		t.Fatalf("clearing must persist: %#v", failures)
	}

	// Clearing an unknown model is a no-op, not an error.
	if err := store.ClearModelFailure("tokenflux", "never-seen"); err != nil {
		t.Fatal(err)
	}
	if failures := store.Get().ModelFailures; len(failures) != 1 {
		t.Fatalf("clearing an unknown model must not change anything: %#v", failures)
	}
}
