package main

import (
	"testing"

	"github.com/MilkSU-Official/milksu/internal/config"
)

func providerWithKey(enabled bool) config.ProviderConfig {
	return config.ProviderConfig{HasAPIKey: true, Enabled: enabled}
}

// Replacing a credential stays lazy so a streaming turn and an in-flight model probe
// survive the save. Withdrawing one must not: the key is already inside a running
// Sidecar's environment, and only stopping that process puts it out of reach.
func TestCredentialWithdrawnSeparatesRemovalFromRotation(t *testing.T) {
	for _, testCase := range []struct {
		name      string
		previous  config.AppSettings
		next      config.AppSettings
		withdrawn bool
	}{
		{
			name:     "key replaced with another key",
			previous: config.AppSettings{Providers: map[string]config.ProviderConfig{"tokenflux": providerWithKey(true)}},
			next:     config.AppSettings{Providers: map[string]config.ProviderConfig{"tokenflux": providerWithKey(true)}},
		},
		{
			name:      "key deleted",
			previous:  config.AppSettings{Providers: map[string]config.ProviderConfig{"tokenflux": providerWithKey(true)}},
			next:      config.AppSettings{Providers: map[string]config.ProviderConfig{"tokenflux": {Enabled: true}}},
			withdrawn: true,
		},
		{
			name:      "service switched off while it holds a key",
			previous:  config.AppSettings{Providers: map[string]config.ProviderConfig{"tokenflux": providerWithKey(true)}},
			next:      config.AppSettings{Providers: map[string]config.ProviderConfig{"tokenflux": providerWithKey(false)}},
			withdrawn: true,
		},
		{
			name:      "whole service row removed",
			previous:  config.AppSettings{Providers: map[string]config.ProviderConfig{"custom-relay-deepseek": providerWithKey(true)}},
			next:      config.AppSettings{Providers: map[string]config.ProviderConfig{}},
			withdrawn: true,
		},
		{
			name:     "service switched off with no key to lose",
			previous: config.AppSettings{Providers: map[string]config.ProviderConfig{"tokenflux": {Enabled: true}}},
			next:     config.AppSettings{Providers: map[string]config.ProviderConfig{"tokenflux": {}}},
		},
		{
			name:     "key of a service that was already off is deleted",
			previous: config.AppSettings{Providers: map[string]config.ProviderConfig{"tokenflux": providerWithKey(false)}},
			next:     config.AppSettings{Providers: map[string]config.ProviderConfig{"tokenflux": {}}},
		},
		{
			name:     "a new service is added",
			previous: config.AppSettings{Providers: map[string]config.ProviderConfig{}},
			next:     config.AppSettings{Providers: map[string]config.ProviderConfig{"tokenflux": providerWithKey(true)}},
		},
		{
			name:      "account relay key cleared",
			previous:  config.AppSettings{Relay: &config.RelayConfig{Enabled: true, HasKey: true}},
			next:      config.AppSettings{Relay: &config.RelayConfig{Enabled: true}},
			withdrawn: true,
		},
		{
			name:      "account relay switched off while it holds a key",
			previous:  config.AppSettings{Relay: &config.RelayConfig{Enabled: true, HasKey: true}},
			next:      config.AppSettings{Relay: &config.RelayConfig{HasKey: true}},
			withdrawn: true,
		},
		{
			name:     "account relay URL changed, key kept",
			previous: config.AppSettings{Relay: &config.RelayConfig{Enabled: true, HasKey: true, URL: "https://tokenflux.dev/v1"}},
			next:     config.AppSettings{Relay: &config.RelayConfig{Enabled: true, HasKey: true, URL: "https://tokenflux.dev/v1/"}},
		},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			if got := credentialWithdrawn(testCase.previous, testCase.next); got != testCase.withdrawn {
				t.Fatalf("credentialWithdrawn = %v, want %v", got, testCase.withdrawn)
			}
		})
	}
}
