package config

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestSQLiteSecretStoreRoundTripAndPrivatePermissions(t *testing.T) {
	directory := t.TempDir()
	path := filepath.Join(directory, localCredentialsDatabaseName)
	rawStore, err := newSQLiteSecretStore(path)
	if err != nil {
		t.Fatal(err)
	}
	store := rawStore.(sqliteSecretStore)

	if err := store.Set("provider:deepseek", "sqlite-secret"); err != nil {
		t.Fatal(err)
	}
	value, err := store.Get("provider:deepseek")
	if err != nil || value != "sqlite-secret" {
		t.Fatalf("unexpected SQLite credential round trip: value=%q err=%v", value, err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("credential database permissions = %o, want 600", info.Mode().Perm())
	}
	if err := store.Delete("provider:deepseek"); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Get("provider:deepseek"); !errors.Is(err, errSecretNotFound) {
		t.Fatalf("deleted credential is still readable: %v", err)
	}
}
