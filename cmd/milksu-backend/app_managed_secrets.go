package main

import "errors"

func (a *App) PutManagedSecret(account, secret string) error {
	if a.settings == nil {
		return errors.New("desktop runtime is unavailable")
	}
	return a.settings.PutManagedSecret(account, secret)
}

func (a *App) DeleteManagedSecret(account string) error {
	if a.settings == nil {
		return errors.New("desktop runtime is unavailable")
	}
	return a.settings.DeleteManagedSecret(account)
}

func (a *App) LookupManagedSecret(account string) (string, error) {
	if a.settings == nil {
		return "", errors.New("desktop runtime is unavailable")
	}
	return a.settings.LookupManagedSecret(account)
}
