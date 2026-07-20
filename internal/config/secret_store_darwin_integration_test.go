//go:build darwin && cgo

package config

import (
	"fmt"
	"os"
	"testing"
	"time"
)

func TestMacOSKeychainRoundTrip(t *testing.T) {
	if os.Getenv("MILKSU_KEYCHAIN_INTEGRATION") != "1" {
		t.Skip("set MILKSU_KEYCHAIN_INTEGRATION=1 to modify a temporary macOS Keychain item")
	}
	store := keychainSecretStore{}
	account := fmt.Sprintf("integration-probe-%d", time.Now().UnixNano())
	secret := "milksu-temporary-keychain-probe"
	defer func() {
		if err := store.Delete(account); err != nil {
			t.Errorf("delete temporary Keychain item: %v", err)
		}
	}()
	if err := store.Set(account, secret); err != nil {
		t.Fatal(err)
	}
	actual, err := store.Get(account)
	if err != nil {
		t.Fatal(err)
	}
	if actual != secret {
		t.Fatal("macOS Keychain returned different credential bytes")
	}
}
