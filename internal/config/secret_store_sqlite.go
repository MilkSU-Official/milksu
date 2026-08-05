package config

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/MilkSU-Official/milksu/internal/sqlitemigrate"
)

const (
	localCredentialsDatabaseName = "credentials.db"

	// SupportedCredentialsDatabaseVersion is the numbered SQLite migration
	// version for credentials.db. The database remains deliberately absent
	// from UI compatibility reports and backup archives.
	SupportedCredentialsDatabaseVersion = 1

	credentialsV1MigrationName = "create local credential store"
)

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
	migrator, err := sqlitemigrate.Open(
		path,
		[]sqlitemigrate.Migration{{
			Version: 1,
			Name:    credentialsV1MigrationName,
			Up:      credentialsV1Up,
		}},
	)
	if err != nil {
		return nil, fmt.Errorf("open local credential database: %w", err)
	}
	if err := migrator.Migrate(context.Background()); err != nil {
		migrator.Close()
		return nil, fmt.Errorf("migrate local credential database: %w", err)
	}
	if err := migrator.Close(); err != nil {
		return nil, fmt.Errorf("close local credential database after migration: %w", err)
	}
	return store, nil
}

// credentialsV1Up only creates and validates schema. It never selects,
// updates, deletes, copies, or serializes rows from the credentials table, so
// adopting the pre-migrator database cannot move provider secrets through
// application memory or into an ordinary file.
func credentialsV1Up(ctx context.Context, tx *sql.Tx) error {
	if _, err := tx.ExecContext(ctx, `
CREATE TABLE IF NOT EXISTS credentials (
			account TEXT PRIMARY KEY,
			secret TEXT NOT NULL,
			updated_at TEXT NOT NULL
		)
`); err != nil {
		return fmt.Errorf("create local credential schema: %w", err)
	}

	rows, err := tx.QueryContext(ctx, `PRAGMA table_info(credentials)`)
	if err != nil {
		return fmt.Errorf("inspect local credential schema: %w", err)
	}
	defer rows.Close()

	type column struct {
		name       string
		columnType string
		notNull    int
		primaryKey int
	}
	want := []column{
		{name: "account", columnType: "TEXT", notNull: 0, primaryKey: 1},
		{name: "secret", columnType: "TEXT", notNull: 1, primaryKey: 0},
		{name: "updated_at", columnType: "TEXT", notNull: 1, primaryKey: 0},
	}
	got := make([]column, 0, len(want))
	for rows.Next() {
		var (
			position     int
			value        column
			defaultValue sql.NullString
		)
		if err := rows.Scan(
			&position,
			&value.name,
			&value.columnType,
			&value.notNull,
			&defaultValue,
			&value.primaryKey,
		); err != nil {
			return fmt.Errorf("inspect local credential schema: %w", err)
		}
		if defaultValue.Valid {
			return fmt.Errorf(
				"incompatible local credential column %q: unexpected default",
				value.name,
			)
		}
		got = append(got, value)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("inspect local credential schema: %w", err)
	}
	if len(got) != len(want) {
		return fmt.Errorf(
			"incompatible local credential columns: got %d, want %d",
			len(got),
			len(want),
		)
	}
	for index := range want {
		if got[index].name != want[index].name ||
			!strings.EqualFold(got[index].columnType, want[index].columnType) ||
			got[index].notNull != want[index].notNull ||
			got[index].primaryKey != want[index].primaryKey {
			return fmt.Errorf(
				"incompatible local credential column %d: got (%q %q notnull=%d pk=%d)",
				index,
				got[index].name,
				got[index].columnType,
				got[index].notNull,
				got[index].primaryKey,
			)
		}
	}
	return nil
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
