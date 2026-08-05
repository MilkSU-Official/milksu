package appdata

import (
	"archive/zip"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const (
	restoreDirectoryName     = "restore"
	pendingRestoreName       = "pending.zip"
	restoreTransactionName   = "transaction.json"
	restoreResultName        = "last-result.json"
	restoreTransactionSchema = "milksu-restore-transaction/v1"
	restoreResultSchema      = "milksu-restore-result/v1"
)

var restoreManagedPaths = func() []string {
	values := []string{
		DataLayoutFile,
		"settings.json",
		"conversations",
		"ctf-workspaces",
		filepath.Join("ctf", "memories"),
		filepath.Join("agent-home", "attachments"),
		filepath.Join("agent-home", "pi", "sessions"),
	}
	for _, databasePath := range backupDatabases {
		values = append(
			values,
			databasePath,
			databasePath+"-wal",
			databasePath+"-shm",
			databasePath+"-journal",
		)
	}
	return values
}()

var restoreManagedDirectoryPaths = []string{
	"conversations",
	"ctf-workspaces",
	filepath.Join("ctf", "memories"),
	filepath.Join("agent-home", "attachments"),
	filepath.Join("agent-home", "pi", "sessions"),
}

type BackupRestoreStage struct {
	CreatedAt       string `json:"createdAt"`
	FileCount       int    `json:"fileCount"`
	Bytes           int64  `json:"bytes"`
	RequiresRestart bool   `json:"requiresRestart"`
	Cancelled       bool   `json:"cancelled,omitempty"`
}

type BackupRestoreResult struct {
	Schema         string `json:"schema"`
	Applied        bool   `json:"applied"`
	AppliedAt      string `json:"appliedAt,omitempty"`
	CreatedAt      string `json:"createdAt,omitempty"`
	FileCount      int    `json:"fileCount,omitempty"`
	Bytes          int64  `json:"bytes,omitempty"`
	RollbackPath   string `json:"rollbackPath,omitempty"`
	RecoveredFirst bool   `json:"recoveredInterruptedRestore,omitempty"`
}

type restoreTransaction struct {
	Schema            string                   `json:"schema"`
	Phase             string                   `json:"phase"`
	StageDirectory    string                   `json:"stageDirectory"`
	RollbackDirectory string                   `json:"rollbackDirectory"`
	Validation        BackupValidation         `json:"validation"`
	Paths             []restoreTransactionPath `json:"paths"`
}

type restoreTransactionPath struct {
	Path      string `json:"path"`
	HadTarget bool   `json:"hadTarget"`
	Touched   bool   `json:"touched"`
}

func StageBackupRestore(root, source string) (BackupRestoreStage, error) {
	root, err := secureRoot(root)
	if err != nil {
		return BackupRestoreStage{}, err
	}
	source, err = secureRestoreSource(root, source)
	if err != nil {
		return BackupRestoreStage{}, err
	}
	validation, err := ValidateBackup(source)
	if err != nil {
		return BackupRestoreStage{}, err
	}
	if err := validateBackupDataLayout(source); err != nil {
		return BackupRestoreStage{}, err
	}
	restoreDirectory, err := ensureRestoreDirectory(root)
	if err != nil {
		return BackupRestoreStage{}, err
	}
	temporary, err := os.CreateTemp(restoreDirectory, ".pending-*.zip")
	if err != nil {
		return BackupRestoreStage{}, fmt.Errorf("create pending restore: %w", err)
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(0o600); err != nil {
		temporary.Close()
		return BackupRestoreStage{}, fmt.Errorf("protect pending restore: %w", err)
	}
	input, err := os.Open(source)
	if err != nil {
		temporary.Close()
		return BackupRestoreStage{}, fmt.Errorf("open backup for restore: %w", err)
	}
	written, copyErr := io.Copy(temporary, io.LimitReader(input, maxBackupArchiveBytes+1))
	closeInputErr := input.Close()
	if copyErr != nil {
		temporary.Close()
		return BackupRestoreStage{}, fmt.Errorf("stage backup restore: %w", copyErr)
	}
	if closeInputErr != nil {
		temporary.Close()
		return BackupRestoreStage{}, fmt.Errorf("close backup for restore: %w", closeInputErr)
	}
	if written > maxBackupArchiveBytes {
		temporary.Close()
		return BackupRestoreStage{}, fmt.Errorf("backup archive exceeds the supported size")
	}
	if err := temporary.Sync(); err != nil {
		temporary.Close()
		return BackupRestoreStage{}, fmt.Errorf("sync pending restore: %w", err)
	}
	if err := temporary.Close(); err != nil {
		return BackupRestoreStage{}, fmt.Errorf("close pending restore: %w", err)
	}
	pendingPath := filepath.Join(restoreDirectory, pendingRestoreName)
	if err := os.Rename(temporaryPath, pendingPath); err != nil {
		return BackupRestoreStage{}, fmt.Errorf("install pending restore: %w", err)
	}
	if err := os.Chmod(pendingPath, 0o600); err != nil {
		return BackupRestoreStage{}, fmt.Errorf("protect pending restore: %w", err)
	}
	return BackupRestoreStage{
		CreatedAt:       validation.CreatedAt,
		FileCount:       validation.FileCount,
		Bytes:           validation.Bytes,
		RequiresRestart: true,
	}, nil
}

func ApplyPendingRestore(root string) (BackupRestoreResult, error) {
	root, err := secureRoot(root)
	if err != nil {
		return BackupRestoreResult{}, err
	}
	recovered, err := recoverInterruptedRestore(root)
	if err != nil {
		return BackupRestoreResult{}, err
	}
	restoreDirectory, err := ensureRestoreDirectory(root)
	if err != nil {
		return BackupRestoreResult{}, err
	}
	pendingPath := filepath.Join(restoreDirectory, pendingRestoreName)
	info, err := os.Lstat(pendingPath)
	if errors.Is(err, os.ErrNotExist) {
		return BackupRestoreResult{Schema: restoreResultSchema, RecoveredFirst: recovered}, nil
	}
	if err != nil {
		return BackupRestoreResult{}, fmt.Errorf("inspect pending restore: %w", err)
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
		return BackupRestoreResult{}, fmt.Errorf("pending restore must be a regular file")
	}
	validation, err := ValidateBackup(pendingPath)
	if err != nil {
		return BackupRestoreResult{}, fmt.Errorf("validate pending restore: %w", err)
	}
	if err := validateBackupDataLayout(pendingPath); err != nil {
		return BackupRestoreResult{}, err
	}
	stageDirectory, err := os.MkdirTemp(filepath.Dir(root), ".milksu-restore-stage-*")
	if err != nil {
		return BackupRestoreResult{}, fmt.Errorf("create restore staging directory: %w", err)
	}
	defer os.RemoveAll(stageDirectory)
	if err := os.Chmod(stageDirectory, 0o700); err != nil {
		return BackupRestoreResult{}, fmt.Errorf("protect restore staging directory: %w", err)
	}
	if err := extractBackupData(pendingPath, stageDirectory); err != nil {
		return BackupRestoreResult{}, err
	}
	rollbackDirectory, err := os.MkdirTemp(filepath.Dir(root), ".milksu-restore-rollback-*")
	if err != nil {
		return BackupRestoreResult{}, fmt.Errorf("create restore rollback directory: %w", err)
	}
	keepRollback := false
	defer func() {
		if !keepRollback {
			_ = os.RemoveAll(rollbackDirectory)
		}
	}()
	if err := os.Chmod(rollbackDirectory, 0o700); err != nil {
		return BackupRestoreResult{}, fmt.Errorf("protect restore rollback directory: %w", err)
	}
	transaction := restoreTransaction{
		Schema:            restoreTransactionSchema,
		Phase:             "applying",
		StageDirectory:    stageDirectory,
		RollbackDirectory: rollbackDirectory,
		Validation:        validation,
		Paths:             make([]restoreTransactionPath, 0, len(restoreManagedPaths)),
	}
	for _, relativePath := range restoreManagedPaths {
		target := filepath.Join(root, relativePath)
		_, statErr := os.Lstat(target)
		transaction.Paths = append(transaction.Paths, restoreTransactionPath{
			Path:      filepath.ToSlash(relativePath),
			HadTarget: statErr == nil,
		})
		if statErr != nil && !errors.Is(statErr, os.ErrNotExist) {
			return BackupRestoreResult{}, fmt.Errorf("inspect restore target %q: %w", relativePath, statErr)
		}
	}
	if err := writeRestoreTransaction(root, transaction); err != nil {
		return BackupRestoreResult{}, err
	}
	for index := range transaction.Paths {
		relativePath := filepath.FromSlash(transaction.Paths[index].Path)
		if err := rejectSymlinkParents(root, relativePath); err != nil {
			if rollbackErr := rollbackRestoreTransaction(root, transaction); rollbackErr != nil {
				return BackupRestoreResult{}, fmt.Errorf("%v; rollback failed: %w", err, rollbackErr)
			}
			return BackupRestoreResult{}, err
		}
		transaction.Paths[index].Touched = true
		if err := writeRestoreTransaction(root, transaction); err != nil {
			if rollbackErr := rollbackRestoreTransaction(root, transaction); rollbackErr != nil {
				return BackupRestoreResult{}, fmt.Errorf("%v; rollback failed: %w", err, rollbackErr)
			}
			return BackupRestoreResult{}, err
		}
		if err := applyRestorePath(root, stageDirectory, rollbackDirectory, relativePath); err != nil {
			if rollbackErr := rollbackRestoreTransaction(root, transaction); rollbackErr != nil {
				return BackupRestoreResult{}, fmt.Errorf("%v; rollback failed: %w", err, rollbackErr)
			}
			return BackupRestoreResult{}, err
		}
	}
	if err := ensureDataLayout(root); err != nil {
		if rollbackErr := rollbackRestoreTransaction(root, transaction); rollbackErr != nil {
			return BackupRestoreResult{}, fmt.Errorf("%v; rollback failed: %w", err, rollbackErr)
		}
		return BackupRestoreResult{}, fmt.Errorf("migrate restored data layout: %w", err)
	}
	transaction.Phase = "committed"
	if err := writeRestoreTransaction(root, transaction); err != nil {
		if rollbackErr := rollbackRestoreTransaction(root, transaction); rollbackErr != nil {
			return BackupRestoreResult{}, fmt.Errorf("%v; rollback failed: %w", err, rollbackErr)
		}
		return BackupRestoreResult{}, err
	}
	result, err := finalizeCommittedRestore(root, transaction)
	if err != nil {
		keepRollback = true
		return BackupRestoreResult{}, err
	}
	keepRollback = true
	result.RecoveredFirst = recovered
	return result, nil
}

func recoverInterruptedRestore(root string) (bool, error) {
	transaction, err := readRestoreTransaction(root)
	if errors.Is(err, os.ErrNotExist) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if transaction.Phase == "committed" {
		if _, err := finalizeCommittedRestore(root, transaction); err != nil {
			return false, err
		}
		return true, nil
	}
	if transaction.Phase != "applying" {
		return false, fmt.Errorf("unsupported restore transaction phase %q", transaction.Phase)
	}
	if err := rollbackRestoreTransaction(root, transaction); err != nil {
		return false, err
	}
	return true, nil
}

func applyRestorePath(root, stageDirectory, rollbackDirectory, relativePath string) error {
	if !managedRestorePath(relativePath) {
		return fmt.Errorf("unsupported restore path %q", relativePath)
	}
	if err := rejectSymlinkParents(root, relativePath); err != nil {
		return err
	}
	target := filepath.Join(root, relativePath)
	rollback := filepath.Join(rollbackDirectory, relativePath)
	if _, err := os.Lstat(target); err == nil {
		if err := os.MkdirAll(filepath.Dir(rollback), 0o700); err != nil {
			return fmt.Errorf("prepare rollback for %q: %w", relativePath, err)
		}
		if err := os.Rename(target, rollback); err != nil {
			return fmt.Errorf("preserve current data %q: %w", relativePath, err)
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("inspect current data %q: %w", relativePath, err)
	}
	source := filepath.Join(stageDirectory, "data", relativePath)
	if _, err := os.Lstat(source); errors.Is(err, os.ErrNotExist) {
		return nil
	} else if err != nil {
		return fmt.Errorf("inspect restored data %q: %w", relativePath, err)
	}
	if err := os.MkdirAll(filepath.Dir(target), 0o700); err != nil {
		return fmt.Errorf("prepare restored data %q: %w", relativePath, err)
	}
	if err := os.Rename(source, target); err != nil {
		return fmt.Errorf("install restored data %q: %w", relativePath, err)
	}
	return nil
}

func rollbackRestoreTransaction(root string, transaction restoreTransaction) error {
	rollbackDirectory, err := validateRestoreWorkDirectory(root, transaction.RollbackDirectory, ".milksu-restore-rollback-")
	if err != nil {
		return err
	}
	for index := len(transaction.Paths) - 1; index >= 0; index-- {
		item := transaction.Paths[index]
		if !item.Touched {
			continue
		}
		relativePath := filepath.FromSlash(item.Path)
		if !managedRestorePath(relativePath) {
			return fmt.Errorf("unsupported rollback path %q", relativePath)
		}
		if err := rejectSymlinkParents(root, relativePath); err != nil {
			return err
		}
		target := filepath.Join(root, relativePath)
		rollback := filepath.Join(rollbackDirectory, relativePath)
		if _, statErr := os.Lstat(rollback); statErr == nil {
			if err := os.RemoveAll(target); err != nil {
				return fmt.Errorf("remove partially restored data %q: %w", relativePath, err)
			}
			if err := os.MkdirAll(filepath.Dir(target), 0o700); err != nil {
				return fmt.Errorf("prepare rollback target %q: %w", relativePath, err)
			}
			if err := os.Rename(rollback, target); err != nil {
				return fmt.Errorf("restore previous data %q: %w", relativePath, err)
			}
		} else if !errors.Is(statErr, os.ErrNotExist) {
			return fmt.Errorf("inspect rollback data %q: %w", relativePath, statErr)
		} else if !item.HadTarget {
			if err := os.RemoveAll(target); err != nil {
				return fmt.Errorf("remove newly restored data %q: %w", relativePath, err)
			}
		}
	}
	_ = os.RemoveAll(transaction.StageDirectory)
	_ = os.RemoveAll(rollbackDirectory)
	if err := os.Remove(filepath.Join(root, restoreDirectoryName, restoreTransactionName)); err != nil &&
		!errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("clear restore transaction: %w", err)
	}
	return nil
}

func finalizeCommittedRestore(root string, transaction restoreTransaction) (BackupRestoreResult, error) {
	rollbackDirectory, err := validateRestoreWorkDirectory(root, transaction.RollbackDirectory, ".milksu-restore-rollback-")
	if err != nil {
		return BackupRestoreResult{}, err
	}
	restoreDirectory, err := ensureRestoreDirectory(root)
	if err != nil {
		return BackupRestoreResult{}, err
	}
	pendingPath := filepath.Join(restoreDirectory, pendingRestoreName)
	if _, statErr := os.Lstat(pendingPath); statErr == nil {
		if err := os.Rename(pendingPath, filepath.Join(rollbackDirectory, "applied-backup.zip")); err != nil {
			return BackupRestoreResult{}, fmt.Errorf("archive applied backup: %w", err)
		}
	} else if !errors.Is(statErr, os.ErrNotExist) {
		return BackupRestoreResult{}, fmt.Errorf("inspect applied backup: %w", statErr)
	}
	rollbackPath := filepath.Join(
		restoreDirectory,
		"rollback-"+time.Now().UTC().Format("20060102T150405.000000000Z"),
	)
	if _, statErr := os.Lstat(rollbackDirectory); statErr == nil {
		if err := os.Rename(rollbackDirectory, rollbackPath); err != nil {
			return BackupRestoreResult{}, fmt.Errorf("install restore rollback snapshot: %w", err)
		}
	} else if !errors.Is(statErr, os.ErrNotExist) {
		return BackupRestoreResult{}, fmt.Errorf("inspect restore rollback snapshot: %w", statErr)
	}
	if err := os.Remove(filepath.Join(restoreDirectory, restoreTransactionName)); err != nil &&
		!errors.Is(err, os.ErrNotExist) {
		return BackupRestoreResult{}, fmt.Errorf("clear committed restore transaction: %w", err)
	}
	result := BackupRestoreResult{
		Schema:       restoreResultSchema,
		Applied:      true,
		AppliedAt:    time.Now().UTC().Format(time.RFC3339),
		CreatedAt:    transaction.Validation.CreatedAt,
		FileCount:    transaction.Validation.FileCount,
		Bytes:        transaction.Validation.Bytes,
		RollbackPath: rollbackPath,
	}
	if err := writeJSONAtomically(
		filepath.Join(restoreDirectory, restoreResultName),
		result,
	); err != nil {
		return BackupRestoreResult{}, fmt.Errorf("write restore result: %w", err)
	}
	_ = os.RemoveAll(transaction.StageDirectory)
	return result, nil
}

func validateBackupDataLayout(path string) error {
	archive, err := zip.OpenReader(path)
	if err != nil {
		return fmt.Errorf("open backup archive: %w", err)
	}
	defer archive.Close()
	for _, item := range archive.File {
		if filepath.ToSlash(item.Name) != "data/"+DataLayoutFile {
			continue
		}
		if item.UncompressedSize64 > maxDataLayoutBytes {
			return fmt.Errorf("backup %s is too large", DataLayoutFile)
		}
		reader, err := item.Open()
		if err != nil {
			return fmt.Errorf("open backup %s: %w", DataLayoutFile, err)
		}
		var layout DataLayout
		decoder := json.NewDecoder(io.LimitReader(reader, maxDataLayoutBytes+1))
		decoder.DisallowUnknownFields()
		decodeErr := decoder.Decode(&layout)
		closeErr := reader.Close()
		if decodeErr != nil {
			return fmt.Errorf("decode backup %s: %w", DataLayoutFile, decodeErr)
		}
		if closeErr != nil {
			return fmt.Errorf("close backup %s: %w", DataLayoutFile, closeErr)
		}
		if layout.Schema != DataLayoutSchema {
			return fmt.Errorf("unsupported backup data layout schema %q", layout.Schema)
		}
		if layout.Version < 0 || layout.Version > CurrentDataLayoutVersion {
			return fmt.Errorf(
				"backup data layout version %d is not supported by this MilkSU build",
				layout.Version,
			)
		}
		return nil
	}
	return fmt.Errorf("backup is missing %s", DataLayoutFile)
}

func extractBackupData(path, destination string) error {
	archive, err := zip.OpenReader(path)
	if err != nil {
		return fmt.Errorf("open backup archive: %w", err)
	}
	defer archive.Close()
	expected := make(map[string]BackupFile)
	for _, item := range archive.File {
		if filepath.ToSlash(item.Name) != "manifest.json" {
			continue
		}
		reader, err := item.Open()
		if err != nil {
			return fmt.Errorf("open backup manifest: %w", err)
		}
		var manifest BackupManifest
		decodeErr := json.NewDecoder(io.LimitReader(reader, 4*1024*1024)).Decode(&manifest)
		closeErr := reader.Close()
		if decodeErr != nil {
			return fmt.Errorf("decode backup manifest: %w", decodeErr)
		}
		if closeErr != nil {
			return fmt.Errorf("close backup manifest: %w", closeErr)
		}
		for _, file := range manifest.Files {
			expected[filepath.ToSlash(file.Path)] = file
		}
		break
	}
	for _, item := range archive.File {
		name, err := validateArchiveName(item.Name)
		if err != nil {
			return err
		}
		if name == "manifest.json" {
			continue
		}
		relativePath := filepath.FromSlash(strings.TrimPrefix(name, "data/"))
		if !managedBackupPath(relativePath) {
			return fmt.Errorf("backup contains unsupported restore path %q", relativePath)
		}
		expectedFile, exists := expected[filepath.ToSlash(relativePath)]
		if !exists {
			return fmt.Errorf("backup manifest is missing restored file %q", relativePath)
		}
		target := filepath.Join(destination, "data", relativePath)
		if err := os.MkdirAll(filepath.Dir(target), 0o700); err != nil {
			return fmt.Errorf("prepare restored file %q: %w", relativePath, err)
		}
		reader, err := item.Open()
		if err != nil {
			return fmt.Errorf("open restored file %q: %w", relativePath, err)
		}
		output, err := os.OpenFile(target, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
		if err != nil {
			reader.Close()
			return fmt.Errorf("create restored file %q: %w", relativePath, err)
		}
		digest := sha256.New()
		written, copyErr := io.Copy(io.MultiWriter(output, digest), io.LimitReader(reader, int64(item.UncompressedSize64)+1))
		closeOutputErr := output.Close()
		closeReaderErr := reader.Close()
		if copyErr != nil {
			return fmt.Errorf("extract restored file %q: %w", relativePath, copyErr)
		}
		if closeOutputErr != nil {
			return fmt.Errorf("close restored file %q: %w", relativePath, closeOutputErr)
		}
		if closeReaderErr != nil {
			return fmt.Errorf("close backup entry %q: %w", relativePath, closeReaderErr)
		}
		if written != int64(item.UncompressedSize64) {
			return fmt.Errorf("restored file size mismatch for %q", relativePath)
		}
		if hex.EncodeToString(digest.Sum(nil)) != expectedFile.SHA256 {
			return fmt.Errorf("restored file checksum mismatch for %q", relativePath)
		}
		delete(expected, filepath.ToSlash(relativePath))
	}
	if len(expected) != 0 {
		return fmt.Errorf("backup did not extract every manifest file")
	}
	return nil
}

func managedBackupPath(path string) bool {
	path = filepath.Clean(path)
	if path == DataLayoutFile || path == "settings.json" {
		return true
	}
	for _, databasePath := range backupDatabases {
		if path == filepath.Clean(databasePath) {
			return true
		}
	}
	for _, root := range restoreManagedDirectoryPaths {
		root = filepath.Clean(root)
		if strings.HasPrefix(path, root+string(filepath.Separator)) {
			return true
		}
	}
	return false
}

func managedRestorePath(path string) bool {
	path = filepath.Clean(path)
	for _, allowed := range restoreManagedPaths {
		if path == filepath.Clean(allowed) {
			return true
		}
	}
	return false
}

func ensureRestoreDirectory(root string) (string, error) {
	path := filepath.Join(root, restoreDirectoryName)
	if info, err := os.Lstat(path); err == nil {
		if info.Mode()&os.ModeSymlink != 0 || !info.IsDir() {
			return "", fmt.Errorf("restore state path must be a directory")
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return "", fmt.Errorf("inspect restore state directory: %w", err)
	} else if err := os.Mkdir(path, 0o700); err != nil {
		return "", fmt.Errorf("create restore state directory: %w", err)
	}
	if err := os.Chmod(path, 0o700); err != nil {
		return "", fmt.Errorf("protect restore state directory: %w", err)
	}
	return path, nil
}

func secureRestoreSource(root, source string) (string, error) {
	source = filepath.Clean(strings.TrimSpace(source))
	if source == "." || !filepath.IsAbs(source) {
		return "", fmt.Errorf("restore source must be an absolute path")
	}
	relative, err := filepath.Rel(root, source)
	if err != nil {
		return "", fmt.Errorf("compare restore source: %w", err)
	}
	if relative == "." || (relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator))) {
		return "", fmt.Errorf("restore source must be outside the MilkSU data directory")
	}
	info, err := os.Lstat(source)
	if err != nil {
		return "", fmt.Errorf("inspect restore source: %w", err)
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
		return "", fmt.Errorf("restore source must be a regular file")
	}
	if info.Size() > maxBackupArchiveBytes {
		return "", fmt.Errorf("restore source exceeds the supported size")
	}
	return source, nil
}

func rejectSymlinkParents(root, relativePath string) error {
	current := root
	parts := strings.Split(filepath.Clean(relativePath), string(filepath.Separator))
	for _, part := range parts[:len(parts)-1] {
		current = filepath.Join(current, part)
		info, err := os.Lstat(current)
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil {
			return fmt.Errorf("inspect restore parent %q: %w", relativePath, err)
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("restore parent for %q must not be a symlink", relativePath)
		}
		if !info.IsDir() {
			return fmt.Errorf("restore parent for %q must be a directory", relativePath)
		}
	}
	return nil
}

func writeRestoreTransaction(root string, transaction restoreTransaction) error {
	restoreDirectory, err := ensureRestoreDirectory(root)
	if err != nil {
		return err
	}
	return writeJSONAtomically(
		filepath.Join(restoreDirectory, restoreTransactionName),
		transaction,
	)
}

func readRestoreTransaction(root string) (restoreTransaction, error) {
	path := filepath.Join(root, restoreDirectoryName, restoreTransactionName)
	info, err := os.Lstat(path)
	if err != nil {
		return restoreTransaction{}, err
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() || info.Size() > 1024*1024 {
		return restoreTransaction{}, fmt.Errorf("restore transaction is invalid")
	}
	file, err := os.Open(path)
	if err != nil {
		return restoreTransaction{}, fmt.Errorf("open restore transaction: %w", err)
	}
	defer file.Close()
	var transaction restoreTransaction
	decoder := json.NewDecoder(io.LimitReader(file, 1024*1024+1))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&transaction); err != nil {
		return restoreTransaction{}, fmt.Errorf("decode restore transaction: %w", err)
	}
	if transaction.Schema != restoreTransactionSchema {
		return restoreTransaction{}, fmt.Errorf("unsupported restore transaction schema %q", transaction.Schema)
	}
	if len(transaction.Paths) != len(restoreManagedPaths) {
		return restoreTransaction{}, fmt.Errorf("restore transaction path set is incomplete")
	}
	if _, err := validateRestoreWorkDirectory(root, transaction.RollbackDirectory, ".milksu-restore-rollback-"); err != nil {
		return restoreTransaction{}, err
	}
	if _, err := validateRestoreWorkDirectory(root, transaction.StageDirectory, ".milksu-restore-stage-"); err != nil &&
		transaction.Phase != "committed" {
		return restoreTransaction{}, err
	}
	return transaction, nil
}

func validateRestoreWorkDirectory(root, path, prefix string) (string, error) {
	path = filepath.Clean(path)
	parent := filepath.Clean(filepath.Dir(root))
	if filepath.Dir(path) != parent || !strings.HasPrefix(filepath.Base(path), prefix) {
		return "", fmt.Errorf("restore work directory is outside the expected location")
	}
	return path, nil
}

func writeJSONAtomically(path string, value any) error {
	payload, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	payload = append(payload, '\n')
	temporary, err := os.CreateTemp(filepath.Dir(path), ".milksu-state-*")
	if err != nil {
		return err
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(0o600); err != nil {
		temporary.Close()
		return err
	}
	if _, err := temporary.Write(payload); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Sync(); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	if err := os.Rename(temporaryPath, path); err != nil {
		return err
	}
	return os.Chmod(path, 0o600)
}
