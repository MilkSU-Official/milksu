//go:build darwin && !cgo

package config

import "fmt"

type unsupportedSecretStore struct{}

func newPlatformSecretStore() secretStore { return unsupportedSecretStore{} }

func (unsupportedSecretStore) Get(string) (string, error) { return "", errSecretNotFound }

func (unsupportedSecretStore) Set(string, string) error {
	return fmt.Errorf("macOS Keychain integration requires cgo")
}

func (unsupportedSecretStore) Delete(string) error { return errSecretNotFound }
