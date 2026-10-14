package config

import "errors"

var errSecretNotFound = errors.New("credential not found")

// ErrSecretNotFound is returned when a platform secret account has no value.
var ErrSecretNotFound = errSecretNotFound

func PlatformSecretGet(account string) (string, error) {
	return newPlatformSecretStore().Get(account)
}

func PlatformSecretSet(account, secret string) error {
	return newPlatformSecretStore().Set(account, secret)
}

func PlatformSecretDelete(account string) error {
	return newPlatformSecretStore().Delete(account)
}

type secretStore interface {
	Get(account string) (string, error)
	Set(account, secret string) error
	Delete(account string) error
}
