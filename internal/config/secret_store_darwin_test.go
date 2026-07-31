//go:build darwin && cgo

package config

import (
	"errors"
	"os"
	"testing"

	"github.com/google/uuid"
)

// This opt-in test exercises the same Security.framework path as the packaged
// desktop app without using a real provider credential.
func TestDarwinKeychainRoundTrip(t *testing.T) {
	if os.Getenv("MILKSU_KEYCHAIN_INTEGRATION") != "1" {
		t.Skip("set MILKSU_KEYCHAIN_INTEGRATION=1 to test the login Keychain")
	}
	store := keychainSecretStore{}
	account := "integration-test:" + uuid.NewString()
	secret := "milksu-test-" + uuid.NewString()
	t.Cleanup(func() {
		if err := store.Delete(account); err != nil && !errors.Is(err, errSecretNotFound) {
			t.Logf("cleanup test Keychain item: %v", err)
		}
	})
	if err := store.Set(account, secret); err != nil {
		t.Fatal(err)
	}
	resolved, err := store.Get(account)
	if err != nil {
		t.Fatal(err)
	}
	if resolved != secret {
		t.Fatal("Keychain round trip returned a different value")
	}
	if err := store.Delete(account); err != nil {
		t.Fatal(err)
	}
}
