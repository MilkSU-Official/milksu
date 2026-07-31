package config

import (
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"

	_ "modernc.org/sqlite"
)

const localCredentialsDatabaseName = "credentials.db"

// sqliteSecretStore is the M3 local credential store. It deliberately keeps
// credentials outside settings.json and the NSSCTF catalog database. The app
// data directory is private to the current macOS user and the database is
// chmod'd to 0600 after creation.
//
// SQLite does not encrypt the secret payload. The security boundary is the
// local OS account plus the directory/file permissions; callers must never
// serialize values returned by Get across the Wails boundary.
type sqliteSecretStore struct {
	path string
}

func newSQLiteSecretStore(path string) (secretStore, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return nil, fmt.Errorf("create local credential directory: %w", err)
	}
	if err := os.Chmod(filepath.Dir(path), 0o700); err != nil {
		return nil, fmt.Errorf("protect local credential directory: %w", err)
	}
	store := sqliteSecretStore{path: path}
	database, err := store.open()
	if err != nil {
		return nil, err
	}
	defer database.Close()
	if _, err := database.Exec(`
		CREATE TABLE IF NOT EXISTS credentials (
			account TEXT PRIMARY KEY,
			secret TEXT NOT NULL,
			updated_at TEXT NOT NULL
		)
	`); err != nil {
		return nil, fmt.Errorf("migrate local credential database: %w", err)
	}
	if err := os.Chmod(path, 0o600); err != nil {
		return nil, fmt.Errorf("protect local credential database: %w", err)
	}
	return store, nil
}

func (s sqliteSecretStore) Get(account string) (string, error) {
	database, err := s.open()
	if err != nil {
		return "", err
	}
	defer database.Close()
	var secret string
	if err := database.QueryRow(
		`SELECT secret FROM credentials WHERE account = ?`,
		account,
	).Scan(&secret); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", errSecretNotFound
		}
		return "", fmt.Errorf("read local credential: %w", err)
	}
	return secret, nil
}

func (s sqliteSecretStore) Set(account, secret string) error {
	database, err := s.open()
	if err != nil {
		return err
	}
	defer database.Close()
	if _, err := database.Exec(`
		INSERT INTO credentials(account, secret, updated_at)
		VALUES(?, ?, ?)
		ON CONFLICT(account) DO UPDATE SET
			secret = excluded.secret,
			updated_at = excluded.updated_at
	`, account, secret, time.Now().UTC().Format(time.RFC3339)); err != nil {
		return fmt.Errorf("write local credential: %w", err)
	}
	return nil
}

func (s sqliteSecretStore) Delete(account string) error {
	database, err := s.open()
	if err != nil {
		return err
	}
	defer database.Close()
	result, err := database.Exec(`DELETE FROM credentials WHERE account = ?`, account)
	if err != nil {
		return fmt.Errorf("delete local credential: %w", err)
	}
	deleted, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("confirm local credential deletion: %w", err)
	}
	if deleted == 0 {
		return errSecretNotFound
	}
	return nil
}

func (s sqliteSecretStore) open() (*sql.DB, error) {
	database, err := sql.Open("sqlite", s.path)
	if err != nil {
		return nil, fmt.Errorf("open local credential database: %w", err)
	}
	database.SetMaxOpenConns(1)
	if err := database.Ping(); err != nil {
		database.Close()
		return nil, fmt.Errorf("open local credential database: %w", err)
	}
	return database, nil
}
