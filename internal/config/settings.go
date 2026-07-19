package config

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"

	"github.com/MilkSU-Official/milksu/internal/appdata"
)

type RelayConfig struct {
	Enabled bool   `json:"enabled"`
	URL     string `json:"url"`
	Key     string `json:"key"`
}

type ProviderConfig struct {
	APIKey  string  `json:"api_key"`
	BaseURL *string `json:"base_url,omitempty"`
	Enabled bool    `json:"enabled"`
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
	mu       sync.RWMutex
	path     string
	settings AppSettings
}

func NewStore() (*Store, error) {
	directory, err := appDataDirectory()
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return nil, fmt.Errorf("create app data directory: %w", err)
	}

	store := &Store{
		path:     filepath.Join(directory, "settings.json"),
		settings: DefaultSettings(),
	}
	if err := store.load(); err != nil && !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	return store, nil
}

func (s *Store) Get() AppSettings {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return clone(s.settings)
}

func (s *Store) Save(value AppSettings) error {
	value = withDefaults(value)
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return fmt.Errorf("encode settings: %w", err)
	}
	if err := writePrivateFile(s.path, data); err != nil {
		return fmt.Errorf("write settings: %w", err)
	}

	s.mu.Lock()
	s.settings = clone(value)
	s.mu.Unlock()
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
	s.settings = withDefaults(value)
	return nil
}

func appDataDirectory() (string, error) {
	return appdata.Directory()
}

func writePrivateFile(path string, data []byte) error {
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
