package config

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/MilkSU-Official/milksu/internal/appdata"
	"github.com/MilkSU-Official/milksu/internal/externaleditor"
)

const (
	relaySecretAccount       = "relay"
	nssctfArenaSecretAccount = "nssctf-agent-arena"
	providerAccountPrefix    = "provider:"
	tokenFluxAccountURL      = "https://tokenflux.dev/v1"
)

type RelayConfig struct {
	Enabled     bool   `json:"enabled"`
	URL         string `json:"url"`
	Key         string `json:"key,omitempty"`
	HasKey      bool   `json:"has_key"`
	SessionOnly bool   `json:"session_only,omitempty"`
	RemoveKey   bool   `json:"remove_key,omitempty"`
}

type ProviderConfig struct {
	APIKey       string   `json:"api_key,omitempty"`
	HasAPIKey    bool     `json:"has_api_key"`
	SessionOnly  bool     `json:"session_only,omitempty"`
	RemoveAPIKey bool     `json:"remove_api_key,omitempty"`
	BaseURL      *string  `json:"base_url,omitempty"`
	Enabled      bool     `json:"enabled"`
	Custom       bool     `json:"custom,omitempty"`
	Name         string   `json:"name,omitempty"`
	Models       []string `json:"models,omitempty"`
}

type NSSCTFArenaConfig struct {
	Token       string `json:"token,omitempty"`
	HasToken    bool   `json:"has_token"`
	SessionOnly bool   `json:"session_only,omitempty"`
	RemoveToken bool   `json:"remove_token,omitempty"`
}

type ModelVerification struct {
	Provider   string `json:"provider"`
	Model      string `json:"model"`
	VerifiedAt string `json:"verified_at"`
}

const (
	ModelSourceAccount  = "account"
	ModelSourcePersonal = "personal"
)

type ModelRoutingConfig struct {
	SourceOrder  []string `json:"source_order"`
	AutoFallback *bool    `json:"auto_fallback"`
}

// SecurityToolPreference records only the user's global availability choice.
// Detection, versions and runtime paths are always recomputed from the local
// machine and must never be trusted from persisted settings.
type SecurityToolPreference struct {
	Enabled bool `json:"enabled"`
}

type AppSettings struct {
	ActiveProvider          string                                    `json:"active_provider"`
	ActiveModel             string                                    `json:"active_model"`
	ModelVerified           *ModelVerification                        `json:"model_verification,omitempty"`
	ModelRouting            ModelRoutingConfig                        `json:"model_routing"`
	Relay                   *RelayConfig                              `json:"relay,omitempty"`
	NSSCTFArena             *NSSCTFArenaConfig                        `json:"nssctf_arena,omitempty"`
	Locale                  *string                                   `json:"locale,omitempty"`
	DisabledSkills          []string                                  `json:"disabled_skills"`
	PreferredExternalEditor string                                    `json:"preferred_external_editor,omitempty"`
	SecurityTools           map[string]SecurityToolPreference         `json:"security_tools,omitempty"`
	ModelThinking           map[string]map[string]ModelThinkingConfig `json:"model_thinking,omitempty"`
	Providers               map[string]ProviderConfig                 `json:"providers"`
	// RuntimeModelCatalogPath is injected only into resolved settings so Pi can
	// read the same refreshed public model metadata as the desktop UI. It is
	// never persisted or returned across Desktop RPC.
	RuntimeModelCatalogPath string `json:"-"`
	RuntimeThinkingLevel    string `json:"-"`
}

func DefaultSettings() AppSettings {
	return AppSettings{
		ActiveProvider: "tokenflux",
		ActiveModel:    "x-ai/grok-4.6",
		ModelRouting: ModelRoutingConfig{
			SourceOrder:  []string{ModelSourceAccount, ModelSourcePersonal},
			AutoFallback: boolPointer(false),
		},
		Providers: make(map[string]ProviderConfig),
	}
}

type Store struct {
	mu                      sync.RWMutex
	path                    string
	secretStore             secretStore
	secretValues            map[string]string
	runtimeModelCatalogPath string
	runtimeRelay            *RelayConfig
	settings                AppSettings
}

func NewStore() (*Store, error) {
	directory, err := appdata.Ensure()
	if err != nil {
		return nil, err
	}
	secrets, err := newSQLiteSecretStore(filepath.Join(directory, localCredentialsDatabaseName))
	if err != nil {
		return nil, err
	}
	return newStore(filepath.Join(directory, "settings.json"), secrets)
}

func newStore(path string, secrets secretStore) (*Store, error) {
	store := &Store{
		path:         path,
		secretStore:  secrets,
		secretValues: make(map[string]string),
		settings:     DefaultSettings(),
	}
	if err := store.load(); err != nil && !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	return store, nil
}

// Get returns settings safe to send across the Wails boundary. Existing
// credentials are represented only by HasKey/HasAPIKey and never returned.
func (s *Store) Get() AppSettings {
	s.mu.RLock()
	defer s.mu.RUnlock()
	// Apply defaults on read so stale official providers (deepseek, …) never
	// reach Desktop RPC or the Agent start path after a product surface change.
	return withDefaults(clone(s.settings))
}

// GetResolved returns a private copy for starting a local Engine process.
// Callers must not serialize or send this value to the frontend.
func (s *Store) GetResolved() AppSettings {
	s.mu.RLock()
	defer s.mu.RUnlock()
	value := withDefaults(clone(s.settings))
	for name, provider := range value.Providers {
		provider.APIKey = s.secretValues[providerSecretAccount(name)]
		value.Providers[name] = provider
	}
	if s.runtimeRelay != nil {
		relay := *s.runtimeRelay
		value.Relay = &relay
	} else if value.Relay != nil {
		value.Relay.Key = s.secretValues[relaySecretAccount]
	}
	if value.NSSCTFArena != nil {
		value.NSSCTFArena.Token = s.secretValues[nssctfArenaSecretAccount]
	}
	value.RuntimeModelCatalogPath = s.runtimeModelCatalogPath
	return value
}

// SetManagedAccountRelay stores the account-assigned provider credential in
// the same local secret store used by a manually configured relay. The secret
// is never returned through Desktop RPC or written to settings.json.
func (s *Store) SetManagedAccountRelay(baseURL, credential string) (bool, error) {
	baseURL = strings.TrimSpace(baseURL)
	credential = strings.TrimSpace(credential)
	if err := validateAccountModelURL(baseURL); err != nil {
		return false, fmt.Errorf("account model URL: %w", err)
	}
	if err := validateSecretInput(credential); err != nil {
		return false, fmt.Errorf("account model credential: %w", err)
	}
	if credential == "" {
		return false, fmt.Errorf("account model credential is required")
	}
	current := s.Get()
	resolved := s.GetResolved()
	if current.Relay != nil && current.Relay.Enabled && current.Relay.URL == baseURL &&
		resolved.Relay != nil && resolved.Relay.Key == credential && !current.Relay.SessionOnly {
		return false, nil
	}
	current.Relay = &RelayConfig{
		Enabled: true, URL: baseURL, Key: credential,
	}
	if err := s.Save(current); err != nil {
		return false, err
	}
	return true, nil
}

func (s *Store) ClearManagedAccountRelay() (bool, error) {
	current := s.Get()
	if current.Relay == nil || (!current.Relay.HasKey && !current.Relay.Enabled) {
		return false, nil
	}
	current.Relay.Enabled = false
	current.Relay.RemoveKey = true
	if err := s.Save(current); err != nil {
		return false, err
	}
	return true, nil
}

// SetRuntimeModelCatalogPath publishes public, non-credential model metadata
// to local Sidecars without adding it to persisted Settings or Desktop RPC.
func (s *Store) SetRuntimeModelCatalogPath(path string) {
	s.mu.Lock()
	s.runtimeModelCatalogPath = strings.TrimSpace(path)
	s.mu.Unlock()
}

func (s *Store) Save(value AppSettings) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	value = withDefaults(value)
	if err := validateCustomProviders(value); err != nil {
		return err
	}
	verification := cloneModelVerification(s.settings.ModelVerified)
	if modelVerificationInvalidated(s.settings, value) {
		verification = nil
	}
	value.ModelVerified = verification
	secrets := cloneSecrets(s.secretValues)
	var persistenceErrors []error
	for name, previous := range s.settings.Providers {
		if !previous.Custom {
			continue
		}
		next, exists := value.Providers[name]
		if exists && next.Custom {
			continue
		}
		account := providerSecretAccount(name)
		if err := deleteSecretIfPresent(s.secretStore, account); err != nil {
			return fmt.Errorf("remove custom relay %s credential: %w", name, err)
		}
		delete(secrets, account)
	}
	for name, provider := range value.Providers {
		account := providerSecretAccount(name)
		if provider.BaseURL != nil {
			baseURL := strings.TrimSpace(*provider.BaseURL)
			if baseURL == "" {
				provider.BaseURL = nil
			} else {
				if err := validateProviderBaseURL(baseURL); err != nil {
					return fmt.Errorf("provider %s Base URL: %w", name, err)
				}
				provider.BaseURL = &baseURL
			}
		}
		if err := validateSecretInput(provider.APIKey); err != nil {
			return fmt.Errorf("provider %s credential: %w", name, err)
		}
		switch {
		case provider.RemoveAPIKey:
			if err := deleteSecretIfPresent(s.secretStore, account); err != nil {
				return fmt.Errorf("remove provider %s credential: %w", name, err)
			}
			delete(secrets, account)
			provider.SessionOnly = false
		case provider.APIKey != "":
			if provider.SessionOnly {
				secrets[account] = provider.APIKey
			} else if err := s.secretStore.Set(account, provider.APIKey); err != nil {
				if secrets[account] == "" {
					secrets[account] = provider.APIKey
					provider.SessionOnly = true
				}
				persistenceErrors = append(persistenceErrors, fmt.Errorf("store provider %s credential: %w", name, err))
			} else {
				secrets[account] = provider.APIKey
				provider.SessionOnly = false
			}
		}
		provider.APIKey = ""
		provider.RemoveAPIKey = false
		provider.HasAPIKey = secrets[account] != ""
		value.Providers[name] = provider
	}

	if value.Relay != nil {
		value.Relay.URL = strings.TrimSpace(value.Relay.URL)
		if value.Relay.URL == "" {
			value.Relay.URL = tokenFluxAccountURL
		}
		if err := validateAccountModelURL(value.Relay.URL); err != nil {
			return fmt.Errorf("account model URL: %w", err)
		}
		if err := validateSecretInput(value.Relay.Key); err != nil {
			return fmt.Errorf("account model credential: %w", err)
		}
		switch {
		case value.Relay.RemoveKey:
			if err := deleteSecretIfPresent(s.secretStore, relaySecretAccount); err != nil {
				return fmt.Errorf("remove relay credential: %w", err)
			}
			delete(secrets, relaySecretAccount)
			value.Relay.SessionOnly = false
		case value.Relay.Key != "":
			if value.Relay.SessionOnly {
				secrets[relaySecretAccount] = value.Relay.Key
			} else if err := s.secretStore.Set(relaySecretAccount, value.Relay.Key); err != nil {
				if secrets[relaySecretAccount] == "" {
					secrets[relaySecretAccount] = value.Relay.Key
					value.Relay.SessionOnly = true
				}
				persistenceErrors = append(persistenceErrors, fmt.Errorf("store relay credential: %w", err))
			} else {
				secrets[relaySecretAccount] = value.Relay.Key
				value.Relay.SessionOnly = false
			}
		}
		value.Relay.Key = ""
		value.Relay.RemoveKey = false
		value.Relay.HasKey = secrets[relaySecretAccount] != ""
	}

	if value.NSSCTFArena != nil {
		value.NSSCTFArena.Token = strings.TrimSpace(value.NSSCTFArena.Token)
		if err := validateSecretInput(value.NSSCTFArena.Token); err != nil {
			return fmt.Errorf("NSSCTF Agent Arena token: %w", err)
		}
		switch {
		case value.NSSCTFArena.RemoveToken:
			if err := deleteSecretIfPresent(s.secretStore, nssctfArenaSecretAccount); err != nil {
				return fmt.Errorf("remove NSSCTF Agent Arena token: %w", err)
			}
			delete(secrets, nssctfArenaSecretAccount)
			value.NSSCTFArena.SessionOnly = false
		case value.NSSCTFArena.Token != "":
			if len(value.NSSCTFArena.Token) > 1024 {
				return fmt.Errorf("NSSCTF Agent Arena token must be at most 1024 characters")
			}
			if !strings.HasPrefix(value.NSSCTFArena.Token, "nss_agent_") {
				return fmt.Errorf("NSSCTF Agent Arena token must start with nss_agent_")
			}
			if value.NSSCTFArena.SessionOnly {
				secrets[nssctfArenaSecretAccount] = value.NSSCTFArena.Token
			} else if err := s.secretStore.Set(nssctfArenaSecretAccount, value.NSSCTFArena.Token); err != nil {
				if secrets[nssctfArenaSecretAccount] == "" {
					secrets[nssctfArenaSecretAccount] = value.NSSCTFArena.Token
					value.NSSCTFArena.SessionOnly = true
				}
				persistenceErrors = append(persistenceErrors, fmt.Errorf("store NSSCTF Agent Arena token: %w", err))
			} else {
				secrets[nssctfArenaSecretAccount] = value.NSSCTFArena.Token
				value.NSSCTFArena.SessionOnly = false
			}
		}
		value.NSSCTFArena.Token = ""
		value.NSSCTFArena.RemoveToken = false
		value.NSSCTFArena.HasToken = secrets[nssctfArenaSecretAccount] != ""
	}

	if err := persistSettings(s.path, value); err != nil {
		return err
	}
	s.settings = clone(value)
	s.secretValues = secrets
	return errors.Join(persistenceErrors...)
}

// SetSecurityToolEnabled updates one local capability preference without
// round-tripping model credentials or unrelated settings through the UI.
func (s *Store) SetSecurityToolEnabled(id string, enabled bool) error {
	id = strings.TrimSpace(id)
	if id == "" || len(id) > 64 {
		return fmt.Errorf("security tool id is invalid")
	}
	for _, character := range id {
		if (character < 'a' || character > 'z') &&
			(character < '0' || character > '9') && character != '-' {
			return fmt.Errorf("security tool id is invalid")
		}
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	next := clone(s.settings)
	if next.SecurityTools == nil {
		next.SecurityTools = make(map[string]SecurityToolPreference)
	}
	next.SecurityTools[id] = SecurityToolPreference{Enabled: enabled}
	if err := persistSettings(s.path, next); err != nil {
		return err
	}
	s.settings = next
	return nil
}

func (s *Store) RecordModelVerification(provider, model string, verifiedAt time.Time) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	provider = strings.TrimSpace(provider)
	model = strings.TrimSpace(model)
	if provider == "" || model == "" {
		return fmt.Errorf("verified provider and model are required")
	}
	if provider != s.settings.ActiveProvider || model != s.settings.ActiveModel {
		return fmt.Errorf(
			"verified model %s/%s no longer matches active model %s/%s",
			provider,
			model,
			s.settings.ActiveProvider,
			s.settings.ActiveModel,
		)
	}
	next := clone(s.settings)
	next.ModelVerified = &ModelVerification{
		Provider:   provider,
		Model:      model,
		VerifiedAt: verifiedAt.UTC().Format(time.RFC3339),
	}
	if err := persistSettings(s.path, next); err != nil {
		return err
	}
	s.settings = next
	return nil
}

func (s *Store) load() error {
	data, err := os.ReadFile(s.path)
	if err != nil {
		return err
	}
	var value AppSettings
	if err := json.Unmarshal(data, &value); err != nil {
		return fmt.Errorf("decode settings: %w", err)
	}
	value = withDefaults(value)
	if err := validateCustomProviders(value); err != nil {
		return fmt.Errorf("validate settings: %w", err)
	}
	migrated := false

	for name, provider := range value.Providers {
		account := providerSecretAccount(name)
		if provider.APIKey != "" {
			if err := validateSecretInput(provider.APIKey); err != nil {
				return fmt.Errorf("migrate provider %s credential: %w", name, err)
			}
			if err := s.secretStore.Set(account, provider.APIKey); err != nil {
				return fmt.Errorf("migrate provider %s credential: %w", name, err)
			}
			s.secretValues[account] = provider.APIKey
			migrated = true
		} else if provider.HasAPIKey {
			secret, err := s.secretStore.Get(account)
			if err != nil && !errors.Is(err, errSecretNotFound) {
				return fmt.Errorf("read provider %s credential: %w", name, err)
			}
			if err == nil {
				s.secretValues[account] = secret
			}
		}
		provider.APIKey = ""
		provider.RemoveAPIKey = false
		provider.HasAPIKey = s.secretValues[account] != ""
		value.Providers[name] = provider
	}

	if value.Relay != nil {
		if value.Relay.Key != "" {
			if err := validateSecretInput(value.Relay.Key); err != nil {
				return fmt.Errorf("migrate relay credential: %w", err)
			}
			if err := s.secretStore.Set(relaySecretAccount, value.Relay.Key); err != nil {
				return fmt.Errorf("migrate relay credential: %w", err)
			}
			s.secretValues[relaySecretAccount] = value.Relay.Key
			migrated = true
		} else if value.Relay.HasKey {
			secret, err := s.secretStore.Get(relaySecretAccount)
			if err != nil && !errors.Is(err, errSecretNotFound) {
				return fmt.Errorf("read relay credential: %w", err)
			}
			if err == nil {
				s.secretValues[relaySecretAccount] = secret
			}
		}
		value.Relay.Key = ""
		value.Relay.RemoveKey = false
		value.Relay.HasKey = s.secretValues[relaySecretAccount] != ""
	}

	if value.NSSCTFArena != nil {
		value.NSSCTFArena.Token = strings.TrimSpace(value.NSSCTFArena.Token)
		if value.NSSCTFArena.Token != "" {
			if err := validateSecretInput(value.NSSCTFArena.Token); err != nil {
				return fmt.Errorf("migrate NSSCTF Agent Arena token: %w", err)
			}
			if len(value.NSSCTFArena.Token) > 1024 || !strings.HasPrefix(value.NSSCTFArena.Token, "nss_agent_") {
				return fmt.Errorf("migrate NSSCTF Agent Arena token: invalid token prefix")
			}
			if err := s.secretStore.Set(nssctfArenaSecretAccount, value.NSSCTFArena.Token); err != nil {
				return fmt.Errorf("migrate NSSCTF Agent Arena token: %w", err)
			}
			s.secretValues[nssctfArenaSecretAccount] = value.NSSCTFArena.Token
			migrated = true
		} else if value.NSSCTFArena.HasToken {
			secret, err := s.secretStore.Get(nssctfArenaSecretAccount)
			if err != nil && !errors.Is(err, errSecretNotFound) {
				return fmt.Errorf("read NSSCTF Agent Arena token: %w", err)
			}
			if err == nil {
				s.secretValues[nssctfArenaSecretAccount] = secret
			}
		}
		value.NSSCTFArena.Token = ""
		value.NSSCTFArena.RemoveToken = false
		value.NSSCTFArena.HasToken = s.secretValues[nssctfArenaSecretAccount] != ""
	}

	s.settings = value
	if migrated {
		return persistSettings(s.path, value)
	}
	return nil
}

func persistSettings(path string, value AppSettings) error {
	value = withoutSessionCredentials(value)
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return fmt.Errorf("encode settings: %w", err)
	}
	if err := writePrivateFile(path, data); err != nil {
		return fmt.Errorf("write settings: %w", err)
	}
	return nil
}

func withoutSessionCredentials(value AppSettings) AppSettings {
	value = clone(value)
	for name, provider := range value.Providers {
		if provider.SessionOnly {
			provider.HasAPIKey = false
			provider.SessionOnly = false
			value.Providers[name] = provider
		}
	}
	if value.Relay != nil && value.Relay.SessionOnly {
		value.Relay.HasKey = false
		value.Relay.SessionOnly = false
	}
	if value.NSSCTFArena != nil && value.NSSCTFArena.SessionOnly {
		value.NSSCTFArena.HasToken = false
		value.NSSCTFArena.SessionOnly = false
	}
	return value
}

func appDataDirectory() (string, error) {
	return appdata.Directory()
}

func writePrivateFile(path string, data []byte) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	temporary, err := os.CreateTemp(filepath.Dir(path), ".milksu-*")
	if err != nil {
		return err
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)

	if err := temporary.Chmod(0o600); err != nil {
		temporary.Close()
		return err
	}
	if _, err := temporary.Write(data); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Sync(); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	return os.Rename(temporaryPath, path)
}

func withDefaults(value AppSettings) AppSettings {
	defaults := DefaultSettings()
	if value.ActiveProvider == "" {
		value.ActiveProvider = defaults.ActiveProvider
	}
	if value.ActiveModel == "" {
		value.ActiveModel = defaults.ActiveModel
	}
	if value.Providers == nil {
		value.Providers = make(map[string]ProviderConfig)
	}
	for id, provider := range value.Providers {
		if !provider.Custom {
			continue
		}
		provider.Name = strings.TrimSpace(provider.Name)
		provider.Models = normalizeCustomModels(provider.Models)
		value.Providers[id] = provider
	}
	// Product surface is TokenFlux + custom relays only. Stale official
	// providers (deepseek/openai/…) are remapped so Agent turns do not start
	// against a retired vendor default.
	active := strings.TrimSpace(value.ActiveProvider)
	if active != "tokenflux" {
		provider, exists := value.Providers[active]
		if !exists || !provider.Custom {
			value.ActiveProvider = defaults.ActiveProvider
			model := strings.TrimSpace(value.ActiveModel)
			if model == "" ||
				strings.EqualFold(active, "deepseek") ||
				strings.HasPrefix(strings.ToLower(model), "deepseek") ||
				strings.EqualFold(active, "openai") ||
				strings.EqualFold(active, "anthropic") ||
				strings.EqualFold(active, "google") ||
				strings.EqualFold(active, "groq") ||
				strings.EqualFold(active, "mistral") {
				value.ActiveModel = defaults.ActiveModel
			}
		}
	}
	value.ModelRouting.SourceOrder = normalizeModelSourceOrder(value.ModelRouting.SourceOrder)
	if value.ModelRouting.AutoFallback == nil {
		// Off by default: the picker lists enabled services; do not silently hop sources.
		value.ModelRouting.AutoFallback = boolPointer(false)
	}
	value.DisabledSkills = normalizeDisabledSkills(value.DisabledSkills)
	value.PreferredExternalEditor = externaleditor.Normalize(value.PreferredExternalEditor)
	value.SecurityTools = normalizeSecurityToolPreferences(value.SecurityTools)
	value.ModelThinking = normalizeModelThinkingOverrides(value.ModelThinking, value.Providers)
	return value
}

func normalizeSecurityToolPreferences(value map[string]SecurityToolPreference) map[string]SecurityToolPreference {
	if len(value) == 0 {
		return nil
	}
	result := make(map[string]SecurityToolPreference, len(value))
	for id, preference := range value {
		id = strings.TrimSpace(id)
		if id == "" || len(id) > 64 {
			continue
		}
		valid := true
		for _, character := range id {
			if (character < 'a' || character > 'z') &&
				(character < '0' || character > '9') && character != '-' {
				valid = false
				break
			}
		}
		if valid {
			result[id] = preference
		}
	}
	if len(result) == 0 {
		return nil
	}
	return result
}

func boolPointer(value bool) *bool {
	return &value
}

func boolValue(value *bool) bool {
	return value != nil && *value
}

func normalizeModelSourceOrder(value []string) []string {
	result := make([]string, 0, 2)
	seen := make(map[string]bool, 2)
	for _, source := range value {
		source = strings.TrimSpace(source)
		if (source != ModelSourceAccount && source != ModelSourcePersonal) || seen[source] {
			continue
		}
		seen[source] = true
		result = append(result, source)
	}
	for _, source := range []string{ModelSourceAccount, ModelSourcePersonal} {
		if !seen[source] {
			result = append(result, source)
		}
	}
	return result
}

func normalizeDisabledSkills(value []string) []string {
	result := make([]string, 0, len(value))
	seen := make(map[string]bool, len(value))
	for _, name := range value {
		name = strings.TrimSpace(name)
		if name == "" || len(name) > 64 || seen[name] {
			continue
		}
		if name[0] == '-' || name[len(name)-1] == '-' {
			continue
		}
		valid := true
		for _, character := range name {
			if (character < 'a' || character > 'z') &&
				(character < '0' || character > '9') && character != '-' {
				valid = false
				break
			}
		}
		if !valid {
			continue
		}
		seen[name] = true
		result = append(result, name)
	}
	return result
}

func clone(value AppSettings) AppSettings {
	copy := value
	copy.ModelRouting.SourceOrder = append([]string(nil), value.ModelRouting.SourceOrder...)
	copy.DisabledSkills = append([]string(nil), value.DisabledSkills...)
	if value.SecurityTools != nil {
		copy.SecurityTools = make(map[string]SecurityToolPreference, len(value.SecurityTools))
		for id, preference := range value.SecurityTools {
			copy.SecurityTools[id] = preference
		}
	}
	if value.ModelThinking != nil {
		copy.ModelThinking = make(map[string]map[string]ModelThinkingConfig, len(value.ModelThinking))
		for provider, models := range value.ModelThinking {
			copyModels := make(map[string]ModelThinkingConfig, len(models))
			for model, configured := range models {
				configured.Levels = append([]string(nil), configured.Levels...)
				copyModels[model] = configured
			}
			copy.ModelThinking[provider] = copyModels
		}
	}
	if value.ModelRouting.AutoFallback != nil {
		autoFallback := *value.ModelRouting.AutoFallback
		copy.ModelRouting.AutoFallback = &autoFallback
	}
	copy.Providers = make(map[string]ProviderConfig, len(value.Providers))
	for name, provider := range value.Providers {
		provider.Models = append([]string(nil), provider.Models...)
		copy.Providers[name] = provider
	}
	if value.Relay != nil {
		relay := *value.Relay
		copy.Relay = &relay
	}
	if value.NSSCTFArena != nil {
		arena := *value.NSSCTFArena
		copy.NSSCTFArena = &arena
	}
	if value.Locale != nil {
		locale := *value.Locale
		copy.Locale = &locale
	}
	copy.ModelVerified = cloneModelVerification(value.ModelVerified)
	return copy
}

func cloneModelVerification(value *ModelVerification) *ModelVerification {
	if value == nil {
		return nil
	}
	copy := *value
	return &copy
}

func modelVerificationInvalidated(previous, next AppSettings) bool {
	if previous.ActiveProvider != next.ActiveProvider || previous.ActiveModel != next.ActiveModel {
		return true
	}
	if boolValue(previous.ModelRouting.AutoFallback) != boolValue(next.ModelRouting.AutoFallback) ||
		strings.Join(normalizeModelSourceOrder(previous.ModelRouting.SourceOrder), ",") !=
			strings.Join(normalizeModelSourceOrder(next.ModelRouting.SourceOrder), ",") {
		return true
	}
	previousThinking := ResolveModelThinking(
		previous,
		previous.ActiveProvider,
		previous.ActiveModel,
		"",
	)
	nextThinking := ResolveModelThinking(
		next,
		next.ActiveProvider,
		next.ActiveModel,
		"",
	)
	if previousThinking.Enabled != nextThinking.Enabled ||
		previousThinking.Level != nextThinking.Level ||
		strings.Join(previousThinking.Levels, ",") != strings.Join(nextThinking.Levels, ",") {
		return true
	}
	active := next.Providers[next.ActiveProvider]
	if active.APIKey != "" || active.RemoveAPIKey {
		return true
	}
	previousActive := previous.Providers[previous.ActiveProvider]
	if previousActive.Custom != active.Custom ||
		previousActive.Name != active.Name ||
		strings.Join(previousActive.Models, "\x00") != strings.Join(active.Models, "\x00") {
		return true
	}
	if previousActive.Enabled != active.Enabled {
		return true
	}
	if normalizedBaseURL(previousActive.BaseURL) != normalizedBaseURL(active.BaseURL) {
		return true
	}
	if next.Relay != nil {
		if next.Relay.Key != "" || next.Relay.RemoveKey {
			return true
		}
		if previous.Relay == nil || previous.Relay.Enabled != next.Relay.Enabled {
			return true
		}
		if previous.Relay == nil || strings.TrimSpace(previous.Relay.URL) != strings.TrimSpace(next.Relay.URL) {
			return true
		}
	} else if previous.Relay != nil && previous.Relay.Enabled {
		return true
	}
	return false
}

func providerSecretAccount(name string) string {
	return providerAccountPrefix + name
}

func cloneSecrets(source map[string]string) map[string]string {
	result := make(map[string]string, len(source))
	for key, value := range source {
		result[key] = value
	}
	return result
}

func validateSecretInput(value string) error {
	if strings.ContainsAny(value, "\x00\r\n") {
		return fmt.Errorf("must not contain NUL or newline characters")
	}
	return nil
}

func validateProviderBaseURL(value string) error {
	if len(value) > 2048 {
		return fmt.Errorf("must be at most 2048 characters")
	}
	parsed, err := url.Parse(value)
	if err != nil {
		return fmt.Errorf("must be a valid URL: %w", err)
	}
	if parsed.Scheme != "https" && parsed.Scheme != "http" {
		return fmt.Errorf("must use http or https")
	}
	if parsed.Host == "" {
		return fmt.Errorf("must include a host")
	}
	if parsed.User != nil {
		return fmt.Errorf("must not include credentials")
	}
	return nil
}

func validateCustomProviders(value AppSettings) error {
	count := 0
	for id, provider := range value.Providers {
		if !provider.Custom {
			continue
		}
		count++
		if count > 8 {
			return fmt.Errorf("at most 8 custom relays may be configured")
		}
		if !validCustomProviderID(id) {
			return fmt.Errorf("custom relay id %q is invalid", id)
		}
		if provider.Name == "" || len([]rune(provider.Name)) > 64 || strings.ContainsAny(provider.Name, "\x00\r\n") {
			return fmt.Errorf("custom relay %s name must be 1 to 64 characters", id)
		}
		if provider.BaseURL == nil || strings.TrimSpace(*provider.BaseURL) == "" {
			return fmt.Errorf("custom relay %s Base URL is required", id)
		}
		if err := validateProviderBaseURL(strings.TrimSpace(*provider.BaseURL)); err != nil {
			return fmt.Errorf("custom relay %s Base URL: %w", id, err)
		}
		if len(provider.Models) == 0 {
			return fmt.Errorf("custom relay %s needs at least one model id", id)
		}
		if len(provider.Models) > 32 {
			return fmt.Errorf("custom relay %s may contain at most 32 models", id)
		}
		for _, model := range provider.Models {
			if len([]rune(model)) > 256 || strings.ContainsAny(model, "\x00\r\n") {
				return fmt.Errorf("custom relay %s has an invalid model id", id)
			}
		}
	}
	if active, exists := value.Providers[value.ActiveProvider]; exists && active.Custom {
		found := false
		for _, model := range active.Models {
			if model == value.ActiveModel {
				found = true
				break
			}
		}
		if !found {
			return fmt.Errorf("active model is not configured for custom relay %s", value.ActiveProvider)
		}
	}
	return nil
}

func validCustomProviderID(value string) bool {
	if !strings.HasPrefix(value, "custom-relay-") || len(value) > 64 {
		return false
	}
	for _, character := range value {
		if (character < 'a' || character > 'z') &&
			(character < '0' || character > '9') && character != '-' {
			return false
		}
	}
	return true
}

func normalizeCustomModels(values []string) []string {
	result := make([]string, 0, len(values))
	seen := make(map[string]bool, len(values))
	for _, model := range values {
		model = strings.TrimSpace(model)
		if model == "" || seen[model] {
			continue
		}
		seen[model] = true
		result = append(result, model)
	}
	return result
}

func validateAccountModelURL(value string) error {
	if err := validateProviderBaseURL(value); err != nil {
		return err
	}
	parsed, _ := url.Parse(value)
	if parsed.Scheme != "https" {
		return fmt.Errorf("must use https")
	}
	if strings.TrimRight(parsed.String(), "/") != tokenFluxAccountURL {
		return fmt.Errorf("must use %s", tokenFluxAccountURL)
	}
	return nil
}

func normalizedBaseURL(value *string) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(*value)
}

func deleteSecretIfPresent(store secretStore, account string) error {
	err := store.Delete(account)
	if errors.Is(err, errSecretNotFound) {
		return nil
	}
	return err
}
