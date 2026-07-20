//go:build !darwin

package config

import "fmt"

type unsupportedSecretStore struct{}

func newPlatformSecretStore() secretStore { return unsupportedSecretStore{} }

func (unsupportedSecretStore) Get(string) (string, error) { return "", errSecretNotFound }

func (unsupportedSecretStore) Set(string, string) error {
	return fmt.Errorf("secure credential storage is not implemented on this platform")
}

func (unsupportedSecretStore) Delete(string) error { return errSecretNotFound }
