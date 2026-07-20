package config

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/MilkSU-Official/milksu/internal/appdata"
)

const (
	relaySecretAccount    = "relay"
	providerAccountPrefix = "provider:"
)

type RelayConfig struct {
	Enabled   bool   `json:"enabled"`
	URL       string `json:"url"`
	Key       string `json:"key,omitempty"`
	HasKey    bool   `json:"has_key"`
	RemoveKey bool   `json:"remove_key,omitempty"`
}

type ProviderConfig struct {
	APIKey       string  `json:"api_key,omitempty"`
	HasAPIKey    bool    `json:"has_api_key"`
	RemoveAPIKey bool    `json:"remove_api_key,omitempty"`
	BaseURL      *string `json:"base_url,omitempty"`
	Enabled      bool    `json:"enabled"`
}

type AppSettings struct {
	ActiveProvider string                    `json:"active_provider"`
	ActiveModel    string                    `json:"active_model"`
	Relay          *RelayConfig              `json:"relay,omitempty"`
	Locale         *string                   `json:"locale,omitempty"`
	Providers      map[string]ProviderConfig `json:"providers"`
}

func DefaultSettings() AppSettings {
	return AppSettings{
		ActiveProvider: "deepseek",
		ActiveModel:    "deepseek-v4-flash",
		Providers:      make(map[string]ProviderConfig),
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
	directory, err := appDataDirectory()
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return nil, fmt.Errorf("create app data directory: %w", err)
	}
	return newStore(filepath.Join(directory, "settings.json"), newPlatformSecretStore())
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
	return value
}

func (s *Store) Save(value AppSettings) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	value = withDefaults(value)
	secrets := cloneSecrets(s.secretValues)
	for name, provider := range value.Providers {
		account := providerSecretAccount(name)
		if err := validateSecretInput(provider.APIKey); err != nil {
			return fmt.Errorf("provider %s credential: %w", name, err)
		}
		switch {
		case provider.RemoveAPIKey:
			if err := deleteSecretIfPresent(s.secretStore, account); err != nil {
				return fmt.Errorf("remove provider %s credential: %w", name, err)
			}
			delete(secrets, account)
		case provider.APIKey != "":
			if err := s.secretStore.Set(account, provider.APIKey); err != nil {
				return fmt.Errorf("store provider %s credential: %w", name, err)
			}
			secrets[account] = provider.APIKey
		}
		provider.APIKey = ""
		provider.RemoveAPIKey = false
		provider.HasAPIKey = secrets[account] != ""
		value.Providers[name] = provider
	}

	if value.Relay != nil {
		if err := validateSecretInput(value.Relay.Key); err != nil {
			return fmt.Errorf("relay credential: %w", err)
		}
		switch {
		case value.Relay.RemoveKey:
			if err := deleteSecretIfPresent(s.secretStore, relaySecretAccount); err != nil {
				return fmt.Errorf("remove relay credential: %w", err)
			}
			delete(secrets, relaySecretAccount)
		case value.Relay.Key != "":
			if err := s.secretStore.Set(relaySecretAccount, value.Relay.Key); err != nil {
				return fmt.Errorf("store relay credential: %w", err)
			}
			secrets[relaySecretAccount] = value.Relay.Key
		}
		value.Relay.Key = ""
		value.Relay.RemoveKey = false
		value.Relay.HasKey = secrets[relaySecretAccount] != ""
	}

	if err := persistSettings(s.path, value); err != nil {
		return err
	}
	s.settings = clone(value)
	s.secretValues = secrets
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

	s.settings = value
	if migrated {
		return persistSettings(s.path, value)
	}
	return nil
}

func persistSettings(path string, value AppSettings) error {
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return fmt.Errorf("encode settings: %w", err)
	}
	if err := writePrivateFile(path, data); err != nil {
		return fmt.Errorf("write settings: %w", err)
	}
	return nil
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
	if value.ActiveProvider == "" {
		value.ActiveProvider = "deepseek"
	}
	if value.ActiveModel == "" {
		value.ActiveModel = "deepseek-v4-flash"
	}
	if value.Providers == nil {
		value.Providers = make(map[string]ProviderConfig)
	}
	return value
}

func clone(value AppSettings) AppSettings {
	copy := value
	copy.Providers = make(map[string]ProviderConfig, len(value.Providers))
	for name, provider := range value.Providers {
		copy.Providers[name] = provider
	}
	if value.Relay != nil {
		relay := *value.Relay
		copy.Relay = &relay
	}
	if value.Locale != nil {
		locale := *value.Locale
		copy.Locale = &locale
	}
	return copy
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

func deleteSecretIfPresent(store secretStore, account string) error {
	err := store.Delete(account)
	if errors.Is(err, errSecretNotFound) {
		return nil
	}
	return err
}
