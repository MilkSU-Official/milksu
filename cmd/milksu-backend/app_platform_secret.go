package main

import (
	"errors"
	"strings"

	"github.com/MilkSU-Official/milksu/internal/config"
)

func (a *App) GetPlatformSecret(account string) (string, error) {
	account = strings.TrimSpace(account)
	if account == "" {
		return "", errors.New("secret account is required")
	}
	value, err := config.PlatformSecretGet(account)
	if errors.Is(err, config.ErrSecretNotFound) {
		return "", nil
	}
	return value, err
}

func (a *App) SetPlatformSecret(account, secret string) error {
	account = strings.TrimSpace(account)
	if account == "" {
		return errors.New("secret account is required")
	}
	if strings.ContainsAny(secret, "\x00\r\n") {
		return errors.New("credential must not contain NUL or newline characters")
	}
	if secret == "" {
		return errors.New("credential must not be empty")
	}
	return config.PlatformSecretSet(account, secret)
}

func (a *App) DeletePlatformSecret(account string) error {
	account = strings.TrimSpace(account)
	if account == "" {
		return errors.New("secret account is required")
	}
	err := config.PlatformSecretDelete(account)
	if errors.Is(err, config.ErrSecretNotFound) {
		return nil
	}
	return err
}
