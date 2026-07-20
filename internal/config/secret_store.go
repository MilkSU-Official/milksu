package config

import "errors"

var errSecretNotFound = errors.New("credential not found")

type secretStore interface {
	Get(account string) (string, error)
	Set(account, secret string) error
	Delete(account string) error
}
