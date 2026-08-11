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
	APIKey       string  `json:"api_key,omitempty"`
	HasAPIKey    bool    `json:"has_api_key"`
	SessionOnly  bool    `json:"session_only,omitempty"`
	RemoveAPIKey bool    `json:"remove_api_key,omitempty"`
	BaseURL      *string `json:"base_url,omitempty"`
	Enabled      bool    `json:"enabled"`
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

type ModelSelection struct {
	Provider string `json:"provider"`
	Model    string `json:"model"`
}

const (
	ModelSourceAccount  = "account"
	ModelSourcePersonal = "personal"
)

type ModelRoutingConfig struct {
	SourceOrder  []string `json:"source_order"`
	AutoFallback *bool    `json:"auto_fallback"`
}

type AppSettings struct {
	ActiveProvider string                    `json:"active_provider"`
	ActiveModel    string                    `json:"active_model"`
	VisionModel    *ModelSelection           `json:"vision_model,omitempty"`
	ModelVerified  *ModelVerification        `json:"model_verification,omitempty"`
	ModelRouting   ModelRoutingConfig        `json:"model_routing"`
	Relay          *RelayConfig              `json:"relay,omitempty"`
	NSSCTFArena    *NSSCTFArenaConfig        `json:"nssctf_arena,omitempty"`
	Locale         *string                   `json:"locale,omitempty"`
	DisabledSkills []string                  `json:"disabled_skills"`
	Providers      map[string]ProviderConfig `json:"providers"`
}

func DefaultSettings() AppSettings {
	return AppSettings{
		ActiveProvider: "deepseek",
		ActiveModel:    "deepseek-v4-flash",
		ModelRouting: ModelRoutingConfig{
			SourceOrder:  []string{ModelSourceAccount, ModelSourcePersonal},
			AutoFallback: boolPointer(true),
		},
		Providers: make(map[string]ProviderConfig),
	}
}

type Store struct {
	mu           sync.RWMutex
	path         string
	secretStore  secretStore
	secretValues map[string]string
	settings     AppSettings
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
	return clone(s.settings)
}

// GetResolved returns a private copy for starting a local Engine process.
// Callers must not serialize or send this value to the frontend.
func (s *Store) GetResolved() AppSettings {
	s.mu.RLock()
	defer s.mu.RUnlock()
	value := clone(s.settings)
	for name, provider := range value.Providers {
		provider.APIKey = s.secretValues[providerSecretAccount(name)]
		value.Providers[name] = provider
	}
	if value.Relay != nil {
		value.Relay.Key = s.secretValues[relaySecretAccount]
	}
	if value.NSSCTFArena != nil {
		value.NSSCTFArena.Token = s.secretValues[nssctfArenaSecretAccount]
	}
	return value
}

func (s *Store) Save(value AppSettings) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	value = withDefaults(value)
	verification := cloneModelVerification(s.settings.ModelVerified)
	if modelVerificationInvalidated(s.settings, value) {
		verification = nil
	}
	value.ModelVerified = verification
	secrets := cloneSecrets(s.secretValues)
	var persistenceErrors []error
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
	if value.VisionModel != nil {
		provider := strings.TrimSpace(value.VisionModel.Provider)
		model := strings.TrimSpace(value.VisionModel.Model)
		if provider == "" || model == "" {
			value.VisionModel = nil
		} else {
			value.VisionModel = &ModelSelection{
				Provider: provider,
				Model:    model,
			}
		}
	}
	if value.Providers == nil {
		value.Providers = make(map[string]ProviderConfig)
	}
	value.ModelRouting.SourceOrder = normalizeModelSourceOrder(value.ModelRouting.SourceOrder)
	if value.ModelRouting.AutoFallback == nil {
		value.ModelRouting.AutoFallback = boolPointer(true)
	}
	value.DisabledSkills = normalizeDisabledSkills(value.DisabledSkills)
	return value
}

func boolPointer(value bool) *bool {
	return &value
}

func boolValue(value *bool) bool {
	return value == nil || *value
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
	if value.ModelRouting.AutoFallback != nil {
		autoFallback := *value.ModelRouting.AutoFallback
		copy.ModelRouting.AutoFallback = &autoFallback
	}
	copy.Providers = make(map[string]ProviderConfig, len(value.Providers))
	for name, provider := range value.Providers {
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
	if value.VisionModel != nil {
		vision := *value.VisionModel
		copy.VisionModel = &vision
	}
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
	active := next.Providers[next.ActiveProvider]
	if active.APIKey != "" || active.RemoveAPIKey {
		return true
	}
	previousActive := previous.Providers[previous.ActiveProvider]
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

func validateAccountModelURL(value string) error {
	if err := validateProviderBaseURL(value); err != nil {
		return err
	}
	parsed, _ := url.Parse(value)
	if parsed.Scheme != "https" {
		return fmt.Errorf("must use https")
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
