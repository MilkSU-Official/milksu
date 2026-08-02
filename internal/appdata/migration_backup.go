package appdata

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"hash"
	"io"
	"io/fs"
	"net/url"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"

	_ "modernc.org/sqlite"
)

const (
	migrationBackupFingerprintSchema = "milksu-migration-backup-input/v1"
	migrationBackupDirectorySuffix   = "-migration-backups"
	maxMigrationBackupAttempts       = 2
)

// MigrationBackupResult describes the durable, credential-free backup created
// immediately before one or more numbered SQLite migrations. Path is internal
// application state outside the live data root; callers must not put it into a
// diagnostic bundle without the existing path sanitization.
type MigrationBackupResult struct {
	Required             bool
	Created              bool
	Reused               bool
	Path                 string
	PendingDatabaseCount int
	FileCount            int
	Bytes                int64
	CredentialsIncluded  bool
}

type pendingDatabaseMigration struct {
	relativePath string
	current      int
	supported    int
	legacy       bool
}

// EnsurePreMigrationBackup performs a read-only migration preflight and, only
// when at least one managed non-credential database needs an upgrade, creates
// a validated full MilkSU safety backup outside root before any database
// constructor is allowed to migrate.
//
// A database without schema_migrations is treated as a legacy v0 candidate.
// Its owning migrator remains responsible for validating the exact business
// schema transactionally. Malformed history and databases newer than this
// build fail before the backup directory is created. credentials.db is always
// rejected as an input and remains excluded from the existing backup format.
func EnsurePreMigrationBackup(
	ctx context.Context,
	root string,
	descriptors []DatabaseDescriptor,
) (MigrationBackupResult, error) {
	root, err := secureRoot(root)
	if err != nil {
		return MigrationBackupResult{}, err
	}
	pending, err := preflightDatabaseMigrations(ctx, root, descriptors)
	if err != nil {
		return MigrationBackupResult{}, err
	}
	if len(pending) == 0 {
		return MigrationBackupResult{}, nil
	}

	result := MigrationBackupResult{
		Required:             true,
		PendingDatabaseCount: len(pending),
		CredentialsIncluded:  false,
	}
	directory := filepath.Join(
		filepath.Dir(root),
		"."+filepath.Base(root)+migrationBackupDirectorySuffix,
	)
	if err := ensureMigrationBackupDirectory(directory); err != nil {
		return result, err
	}

	for attempt := 0; attempt < maxMigrationBackupAttempts; attempt++ {
		before, err := migrationBackupFingerprint(root, pending)
		if err != nil {
			return result, err
		}
		destination := filepath.Join(directory, "migration-"+before+".zip")
		if validation, exists, err := validatedExistingMigrationBackup(destination); err != nil {
			return result, err
		} else if exists {
			result.Reused = true
			result.Path = destination
			result.FileCount = validation.FileCount
			result.Bytes = validation.Bytes
			return result, nil
		}

		temporary, err := reserveMigrationBackupPath(directory)
		if err != nil {
			return result, err
		}
		exported, exportErr := ExportBackup(ctx, root, temporary)
		if exportErr != nil {
			_ = os.Remove(temporary)
			return result, fmt.Errorf("create pre-migration safety backup: %w", exportErr)
		}
		if exported.CredentialsIncluded {
			_ = os.Remove(temporary)
			return result, fmt.Errorf("pre-migration safety backup unexpectedly contains credentials")
		}
		validation, validationErr := ValidateBackup(temporary)
		if validationErr != nil || !validation.Valid || validation.CredentialsIncluded {
			_ = os.Remove(temporary)
			if validationErr != nil {
				return result, fmt.Errorf("validate pre-migration safety backup: %w", validationErr)
			}
			return result, fmt.Errorf("pre-migration safety backup failed validation")
		}

		after, fingerprintErr := migrationBackupFingerprint(root, pending)
		if fingerprintErr != nil {
			_ = os.Remove(temporary)
			return result, fingerprintErr
		}
		if after != before {
			_ = os.Remove(temporary)
			if attempt+1 < maxMigrationBackupAttempts {
				continue
			}
			return result, fmt.Errorf("database state changed while creating the pre-migration safety backup")
		}

		destination = filepath.Join(directory, "migration-"+after+".zip")
		installed, installErr := installMigrationBackup(temporary, destination)
		_ = os.Remove(temporary)
		if installErr != nil {
			return result, installErr
		}
		if !installed {
			existing, exists, existingErr := validatedExistingMigrationBackup(destination)
			if existingErr != nil {
				return result, existingErr
			}
			if !exists {
				return result, fmt.Errorf("pre-migration safety backup disappeared during installation")
			}
			result.Reused = true
			result.Path = destination
			result.FileCount = existing.FileCount
			result.Bytes = existing.Bytes
			return result, nil
		}
		if err := syncDirectory(directory); err != nil {
			return result, err
		}
		result.Created = true
		result.Path = destination
		result.FileCount = validation.FileCount
		result.Bytes = validation.Bytes
		return result, nil
	}
	return result, fmt.Errorf("could not create a stable pre-migration safety backup")
}

func preflightDatabaseMigrations(
	ctx context.Context,
	root string,
	descriptors []DatabaseDescriptor,
) ([]pendingDatabaseMigration, error) {
	managed := make(map[string]struct{}, len(backupDatabases))
	for _, relativePath := range backupDatabases {
		managed[filepath.ToSlash(relativePath)] = struct{}{}
	}
	seen := make(map[string]struct{}, len(descriptors))
	pending := make([]pendingDatabaseMigration, 0, len(descriptors))
	for _, descriptor := range descriptors {
		relativePath := filepath.ToSlash(descriptor.RelativePath)
		if strings.EqualFold(filepath.Base(relativePath), "credentials.db") {
			return nil, fmt.Errorf("credentials database cannot participate in ordinary migration backups")
		}
		if descriptor.Supported <= 0 {
			return nil, fmt.Errorf("database %q has no positive supported migration version", descriptor.LogicalName)
		}
		if !safeDescriptorPath(relativePath) {
			return nil, fmt.Errorf("database %q has an unsafe migration path", descriptor.LogicalName)
		}
		if _, ok := managed[relativePath]; !ok {
			return nil, fmt.Errorf("database %q is absent from the credential-free backup allowlist", descriptor.LogicalName)
		}
		if _, duplicate := seen[relativePath]; duplicate {
			return nil, fmt.Errorf("duplicate database migration descriptor %q", relativePath)
		}
		seen[relativePath] = struct{}{}

		path, missing, err := resolveDatabaseFile(root, relativePath)
		if err != nil {
			return nil, fmt.Errorf(
				"preflight database %q: %s",
				descriptor.LogicalName,
				sanitizeDatabaseError(err.Error(), root),
			)
		}
		if missing {
			continue
		}
		databaseURL := (&url.URL{Scheme: "file", Path: path}).String() + "?mode=ro"
		database, err := sql.Open("sqlite", databaseURL)
		if err != nil {
			return nil, fmt.Errorf("preflight database %q: %w", descriptor.LogicalName, err)
		}
		database.SetMaxOpenConns(1)
		history, historyErr := inspectMigrationHistory(ctx, database)
		closeErr := database.Close()
		if historyErr != nil {
			return nil, fmt.Errorf(
				"preflight database %q: %s",
				descriptor.LogicalName,
				sanitizeDatabaseError(historyErr.Error(), root),
			)
		}
		if closeErr != nil {
			return nil, fmt.Errorf(
				"close database %q after migration preflight: %s",
				descriptor.LogicalName,
				sanitizeDatabaseError(closeErr.Error(), root),
			)
		}
		if history.Exists && history.Current > descriptor.Supported {
			return nil, fmt.Errorf(
				"database %q requires migration version %d, but this build supports %d",
				descriptor.LogicalName,
				history.Current,
				descriptor.Supported,
			)
		}
		if !history.Exists || history.Current < descriptor.Supported {
			pending = append(pending, pendingDatabaseMigration{
				relativePath: relativePath,
				current:      history.Current,
				supported:    descriptor.Supported,
				legacy:       !history.Exists,
			})
		}
	}
	if len(seen) != len(managed) {
		var missing []string
		for relativePath := range managed {
			if _, ok := seen[relativePath]; !ok {
				missing = append(missing, relativePath)
			}
		}
		slices.Sort(missing)
		return nil, fmt.Errorf(
			"migration backup preflight is missing database descriptors: %s",
			strings.Join(missing, ", "),
		)
	}
	slices.SortFunc(pending, func(left, right pendingDatabaseMigration) int {
		return strings.Compare(left.relativePath, right.relativePath)
	})
	return pending, nil
}

func ensureMigrationBackupDirectory(directory string) error {
	info, err := os.Lstat(directory)
	if errors.Is(err, os.ErrNotExist) {
		if err := os.Mkdir(directory, 0o700); err != nil {
			return fmt.Errorf("create migration backup directory: %w", err)
		}
		return nil
	}
	if err != nil {
		return fmt.Errorf("inspect migration backup directory: %w", err)
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.IsDir() {
		return fmt.Errorf("migration backup path must be a private directory")
	}
	if err := os.Chmod(directory, 0o700); err != nil {
		return fmt.Errorf("protect migration backup directory: %w", err)
	}
	return nil
}

func validatedExistingMigrationBackup(path string) (BackupValidation, bool, error) {
	info, err := os.Lstat(path)
	if errors.Is(err, os.ErrNotExist) {
		return BackupValidation{}, false, nil
	}
	if err != nil {
		return BackupValidation{}, false, fmt.Errorf("inspect existing migration backup: %w", err)
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
		return BackupValidation{}, false, fmt.Errorf("existing migration backup must be a regular file")
	}
	validation, err := ValidateBackup(path)
	if err != nil {
		return BackupValidation{}, false, fmt.Errorf("validate existing migration backup: %w", err)
	}
	if !validation.Valid || validation.CredentialsIncluded {
		return BackupValidation{}, false, fmt.Errorf("existing migration backup is not credential-free and valid")
	}
	return validation, true, nil
}

func reserveMigrationBackupPath(directory string) (string, error) {
	file, err := os.CreateTemp(directory, ".pending-migration-*.zip")
	if err != nil {
		return "", fmt.Errorf("reserve migration backup path: %w", err)
	}
	path := file.Name()
	if err := file.Close(); err != nil {
		_ = os.Remove(path)
		return "", fmt.Errorf("close migration backup placeholder: %w", err)
	}
	if err := os.Remove(path); err != nil {
		return "", fmt.Errorf("release migration backup placeholder: %w", err)
	}
	return path, nil
}

// installMigrationBackup uses a hard link because source and destination are
// in the same private directory. Link creation is atomic and never overwrites
// an existing backup; the caller removes source after this function returns.
func installMigrationBackup(source, destination string) (bool, error) {
	if err := os.Link(source, destination); err != nil {
		if errors.Is(err, fs.ErrExist) {
			return false, nil
		}
		return false, fmt.Errorf("install pre-migration safety backup: %w", err)
	}
	if err := os.Chmod(destination, 0o600); err != nil {
		return false, fmt.Errorf("protect pre-migration safety backup: %w", err)
	}
	return true, nil
}

func syncDirectory(directory string) error {
	handle, err := os.Open(directory)
	if err != nil {
		return fmt.Errorf("open migration backup directory for sync: %w", err)
	}
	defer handle.Close()
	if err := handle.Sync(); err != nil {
		return fmt.Errorf("sync migration backup directory: %w", err)
	}
	return nil
}

func migrationBackupFingerprint(
	root string,
	pending []pendingDatabaseMigration,
) (string, error) {
	digest := sha256.New()
	writeFingerprintField(digest, migrationBackupFingerprintSchema)
	for _, item := range pending {
		writeFingerprintField(digest, item.relativePath)
		writeFingerprintField(digest, strconv.Itoa(item.current))
		writeFingerprintField(digest, strconv.Itoa(item.supported))
		writeFingerprintField(digest, strconv.FormatBool(item.legacy))
		for _, suffix := range []string{"", "-wal", "-shm", "-journal"} {
			relativePath := filepath.FromSlash(item.relativePath) + suffix
			path := filepath.Join(root, relativePath)
			info, err := os.Lstat(path)
			if errors.Is(err, os.ErrNotExist) {
				writeFingerprintField(digest, filepath.ToSlash(relativePath))
				writeFingerprintField(digest, "missing")
				continue
			}
			if err != nil {
				return "", fmt.Errorf("inspect migration input %q: %w", filepath.ToSlash(relativePath), err)
			}
			if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
				return "", fmt.Errorf("migration input %q must be a regular file", filepath.ToSlash(relativePath))
			}
			writeFingerprintField(digest, filepath.ToSlash(relativePath))
			writeFingerprintField(digest, strconv.FormatInt(info.Size(), 10))
			if err := hashFile(digest, path); err != nil {
				return "", fmt.Errorf("fingerprint migration input %q: %w", filepath.ToSlash(relativePath), err)
			}
		}
	}
	if err := fingerprintBackupMetadata(digest, root); err != nil {
		return "", err
	}
	return hex.EncodeToString(digest.Sum(nil)), nil
}

// fingerprintBackupMetadata avoids reusing a full pre-migration archive after
// unrelated user state changed. It hashes only path metadata, never file
// contents; database bytes are hashed separately above. Sensitive paths are
// neither opened nor included.
func fingerprintBackupMetadata(digest hash.Hash, root string) error {
	roots := append([]string(nil), backupRoots...)
	roots = append(roots, "settings.json")
	type entry struct {
		path    string
		size    int64
		modTime int64
		mode    fs.FileMode
	}
	var entries []entry
	for _, relativeRoot := range roots {
		if err := rejectSymlinkParents(root, relativeRoot); err != nil {
			return fmt.Errorf(
				"inspect migration backup input %q: %w",
				filepath.ToSlash(relativeRoot),
				err,
			)
		}
		source := filepath.Join(root, relativeRoot)
		info, err := os.Lstat(source)
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil {
			return fmt.Errorf("inspect migration backup input %q: %w", filepath.ToSlash(relativeRoot), err)
		}
		if info.Mode()&os.ModeSymlink != 0 {
			continue
		}
		if info.Mode().IsRegular() {
			if !sensitiveBackupPath(relativeRoot) {
				entries = append(entries, entry{
					path:    filepath.ToSlash(relativeRoot),
					size:    info.Size(),
					modTime: info.ModTime().UnixNano(),
					mode:    info.Mode(),
				})
			}
			continue
		}
		if !info.IsDir() {
			continue
		}
		if err := filepath.WalkDir(source, func(path string, item fs.DirEntry, walkErr error) error {
			if walkErr != nil {
				return walkErr
			}
			if item.Type()&os.ModeSymlink != 0 {
				if item.IsDir() {
					return filepath.SkipDir
				}
				return nil
			}
			if !item.Type().IsRegular() {
				return nil
			}
			relativePath, err := filepath.Rel(root, path)
			if err != nil {
				return err
			}
			if sensitiveBackupPath(relativePath) {
				return nil
			}
			info, err := item.Info()
			if err != nil {
				return err
			}
			entries = append(entries, entry{
				path:    filepath.ToSlash(relativePath),
				size:    info.Size(),
				modTime: info.ModTime().UnixNano(),
				mode:    info.Mode(),
			})
			return nil
		}); err != nil {
			return fmt.Errorf("inspect migration backup input %q: %w", filepath.ToSlash(relativeRoot), err)
		}
	}
	slices.SortFunc(entries, func(left, right entry) int {
		return strings.Compare(left.path, right.path)
	})
	for _, item := range entries {
		writeFingerprintField(digest, item.path)
		writeFingerprintField(digest, strconv.FormatInt(item.size, 10))
		writeFingerprintField(digest, strconv.FormatInt(item.modTime, 10))
		writeFingerprintField(digest, item.mode.String())
	}
	return nil
}

func hashFile(digest hash.Hash, path string) error {
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()
	if _, err := io.Copy(digest, file); err != nil {
		return err
	}
	return nil
}

func writeFingerprintField(digest hash.Hash, value string) {
	_, _ = io.WriteString(digest, strconv.Itoa(len(value)))
	_, _ = io.WriteString(digest, ":")
	_, _ = io.WriteString(digest, value)
	_, _ = io.WriteString(digest, "\n")
}
