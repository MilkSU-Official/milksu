package appdata

import (
	"archive/zip"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

const (
	BackupSchema          = "milksu-backup/v1"
	maxBackupFileCount    = 20_000
	maxBackupArchiveBytes = int64(2 * 1024 * 1024 * 1024)
)

var backupRoots = []string{
	DataLayoutFile,
	"conversations",
	"ctf-workspaces",
	filepath.Join("ctf", "memories"),
	filepath.Join("agent-home", "attachments"),
	filepath.Join("agent-home", "pi", "sessions"),
}

var backupDatabases = []string{
	filepath.Join("ctf", "memory.sqlite3"),
	filepath.Join("nssctf", "catalog.sqlite3"),
	filepath.Join("ctfshow", "catalog.sqlite3"),
	filepath.Join("runtime", "events.sqlite3"),
}

var sensitiveBackupPaths = []string{
	"credentials.db",
	filepath.Join("browser", "bridge-pairing.json"),
	filepath.Join("agent-home", "pi", "auth.json"),
}

type DataStatus struct {
	Directory      string                        `json:"directory"`
	FileCount      int                           `json:"fileCount"`
	Bytes          int64                         `json:"bytes"`
	LastModifiedAt string                        `json:"lastModifiedAt,omitempty"`
	Databases      []DatabaseCompatibilityStatus `json:"databases,omitempty"`
}

type BackupFile struct {
	Path   string `json:"path"`
	Bytes  int64  `json:"bytes"`
	SHA256 string `json:"sha256"`
}

type BackupManifest struct {
	Schema              string       `json:"schema"`
	CreatedAt           string       `json:"createdAt"`
	Platform            string       `json:"platform"`
	CredentialsIncluded bool         `json:"credentialsIncluded"`
	Files               []BackupFile `json:"files"`
	Excluded            []string     `json:"excluded"`
}

type BackupExport struct {
	Path                string `json:"path"`
	CreatedAt           string `json:"createdAt"`
	FileCount           int    `json:"fileCount"`
	Bytes               int64  `json:"bytes"`
	CredentialsIncluded bool   `json:"credentialsIncluded"`
	Cancelled           bool   `json:"cancelled,omitempty"`
}

type BackupValidation struct {
	Valid               bool   `json:"valid"`
	Schema              string `json:"schema"`
	CreatedAt           string `json:"createdAt"`
	FileCount           int    `json:"fileCount"`
	Bytes               int64  `json:"bytes"`
	CredentialsIncluded bool   `json:"credentialsIncluded"`
}

func Inspect(root string) (DataStatus, error) {
	root, err := secureRoot(root)
	if err != nil {
		return DataStatus{}, err
	}
	status := DataStatus{Directory: root}
	err = filepath.WalkDir(root, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.Type()&os.ModeSymlink != 0 {
			if entry.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if !entry.Type().IsRegular() {
			return nil
		}
		info, infoErr := entry.Info()
		if infoErr != nil {
			return infoErr
		}
		status.FileCount++
		status.Bytes += info.Size()
		if status.LastModifiedAt == "" || info.ModTime().UTC().Format(time.RFC3339) > status.LastModifiedAt {
			status.LastModifiedAt = info.ModTime().UTC().Format(time.RFC3339)
		}
		return nil
	})
	if err != nil {
		return DataStatus{}, fmt.Errorf("inspect MilkSU data: %w", err)
	}
	return status, nil
}

func ExportBackup(ctx context.Context, root, destination string) (BackupExport, error) {
	root, err := secureRoot(root)
	if err != nil {
		return BackupExport{}, err
	}
	destination, err = secureDestination(root, destination)
	if err != nil {
		return BackupExport{}, err
	}
	if err := os.MkdirAll(filepath.Dir(destination), 0o700); err != nil {
		return BackupExport{}, fmt.Errorf("create backup destination: %w", err)
	}

	temporary, err := os.CreateTemp(filepath.Dir(destination), ".milksu-backup-*.zip")
	if err != nil {
		return BackupExport{}, fmt.Errorf("create backup file: %w", err)
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(0o600); err != nil {
		temporary.Close()
		return BackupExport{}, fmt.Errorf("protect backup file: %w", err)
	}

	snapshots, err := snapshotDatabases(ctx, root)
	if err != nil {
		temporary.Close()
		return BackupExport{}, err
	}
	defer os.RemoveAll(snapshots.directory)

	archive := zip.NewWriter(temporary)
	manifest := BackupManifest{
		Schema:              BackupSchema,
		CreatedAt:           time.Now().UTC().Format(time.RFC3339),
		Platform:            runtime.GOOS + "/" + runtime.GOARCH,
		CredentialsIncluded: false,
		Excluded: []string{
			"API Key 与 Arena Token",
			"浏览器配对令牌",
			"PI 认证文件",
			"临时缓存与工作区沙箱",
		},
	}
	seen := make(map[string]struct{})
	if err := addSanitizedSettings(archive, root, seen, &manifest); err != nil {
		archive.Close()
		temporary.Close()
		return BackupExport{}, err
	}
	for _, relativeRoot := range backupRoots {
		if err := addBackupRoot(archive, root, relativeRoot, seen, &manifest); err != nil {
			archive.Close()
			temporary.Close()
			return BackupExport{}, err
		}
	}
	for relativePath, snapshotPath := range snapshots.files {
		if err := addBackupFile(archive, snapshotPath, relativePath, seen, &manifest); err != nil {
			archive.Close()
			temporary.Close()
			return BackupExport{}, err
		}
	}
	slices.SortFunc(manifest.Files, func(left, right BackupFile) int {
		return strings.Compare(left.Path, right.Path)
	})
	manifestData, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		archive.Close()
		temporary.Close()
		return BackupExport{}, fmt.Errorf("encode backup manifest: %w", err)
	}
	header := &zip.FileHeader{Name: "manifest.json", Method: zip.Deflate}
	header.SetMode(0o600)
	header.SetModTime(time.Now().UTC())
	writer, err := archive.CreateHeader(header)
	if err != nil {
		archive.Close()
		temporary.Close()
		return BackupExport{}, fmt.Errorf("create backup manifest: %w", err)
	}
	if _, err := writer.Write(manifestData); err != nil {
		archive.Close()
		temporary.Close()
		return BackupExport{}, fmt.Errorf("write backup manifest: %w", err)
	}
	if err := archive.Close(); err != nil {
		temporary.Close()
		return BackupExport{}, fmt.Errorf("finish backup archive: %w", err)
	}
	if err := temporary.Sync(); err != nil {
		temporary.Close()
		return BackupExport{}, fmt.Errorf("sync backup archive: %w", err)
	}
	if err := temporary.Close(); err != nil {
		return BackupExport{}, fmt.Errorf("close backup archive: %w", err)
	}
	if err := os.Rename(temporaryPath, destination); err != nil {
		return BackupExport{}, fmt.Errorf("install backup archive: %w", err)
	}
	if err := os.Chmod(destination, 0o600); err != nil {
		return BackupExport{}, fmt.Errorf("protect backup archive: %w", err)
	}
	info, err := os.Stat(destination)
	if err != nil {
		return BackupExport{}, fmt.Errorf("inspect backup archive: %w", err)
	}
	return BackupExport{
		Path:                destination,
		CreatedAt:           manifest.CreatedAt,
		FileCount:           len(manifest.Files),
		Bytes:               info.Size(),
		CredentialsIncluded: false,
	}, nil
}

func ValidateBackup(path string) (BackupValidation, error) {
	path = filepath.Clean(strings.TrimSpace(path))
	if path == "." || !filepath.IsAbs(path) {
		return BackupValidation{}, fmt.Errorf("backup path must be absolute")
	}
	archive, err := zip.OpenReader(path)
	if err != nil {
		return BackupValidation{}, fmt.Errorf("open backup archive: %w", err)
	}
	defer archive.Close()
	if len(archive.File) > maxBackupFileCount+1 {
		return BackupValidation{}, fmt.Errorf("backup contains too many files")
	}

	var manifest BackupManifest
	archiveFiles := make(map[string]*zip.File)
	var total int64
	for _, item := range archive.File {
		name, nameErr := validateArchiveName(item.Name)
		if nameErr != nil {
			return BackupValidation{}, nameErr
		}
		if _, exists := archiveFiles[name]; exists {
			return BackupValidation{}, fmt.Errorf("backup contains duplicate path %q", name)
		}
		archiveFiles[name] = item
		total += int64(item.UncompressedSize64)
		if total > maxBackupArchiveBytes {
			return BackupValidation{}, fmt.Errorf("backup expands beyond the supported size")
		}
		if name == "manifest.json" {
			reader, openErr := item.Open()
			if openErr != nil {
				return BackupValidation{}, fmt.Errorf("open backup manifest: %w", openErr)
			}
			decodeErr := json.NewDecoder(io.LimitReader(reader, 4*1024*1024)).Decode(&manifest)
			closeErr := reader.Close()
			if decodeErr != nil {
				return BackupValidation{}, fmt.Errorf("decode backup manifest: %w", decodeErr)
			}
			if closeErr != nil {
				return BackupValidation{}, fmt.Errorf("close backup manifest: %w", closeErr)
			}
		}
	}
	if manifest.Schema != BackupSchema {
		return BackupValidation{}, fmt.Errorf("unsupported backup schema %q", manifest.Schema)
	}
	if manifest.CredentialsIncluded {
		return BackupValidation{}, fmt.Errorf("backup unexpectedly contains credentials")
	}
	if len(manifest.Files) > maxBackupFileCount {
		return BackupValidation{}, fmt.Errorf("backup manifest contains too many files")
	}

	var bytes int64
	for _, expected := range manifest.Files {
		name, nameErr := validateArchiveName("data/" + expected.Path)
		if nameErr != nil {
			return BackupValidation{}, nameErr
		}
		if sensitiveBackupPath(expected.Path) {
			return BackupValidation{}, fmt.Errorf("backup contains sensitive path %q", expected.Path)
		}
		item := archiveFiles[name]
		if item == nil {
			return BackupValidation{}, fmt.Errorf("backup is missing %q", expected.Path)
		}
		if int64(item.UncompressedSize64) != expected.Bytes {
			return BackupValidation{}, fmt.Errorf("backup size mismatch for %q", expected.Path)
		}
		digest, digestErr := archiveDigest(item)
		if digestErr != nil {
			return BackupValidation{}, digestErr
		}
		if digest != expected.SHA256 {
			return BackupValidation{}, fmt.Errorf("backup checksum mismatch for %q", expected.Path)
		}
		delete(archiveFiles, name)
		bytes += expected.Bytes
	}
	delete(archiveFiles, "manifest.json")
	if len(archiveFiles) != 0 {
		return BackupValidation{}, fmt.Errorf("backup contains files absent from the manifest")
	}
	return BackupValidation{
		Valid:               true,
		Schema:              manifest.Schema,
		CreatedAt:           manifest.CreatedAt,
		FileCount:           len(manifest.Files),
		Bytes:               bytes,
		CredentialsIncluded: false,
	}, nil
}

type databaseSnapshots struct {
	directory string
	files     map[string]string
}

func snapshotDatabases(ctx context.Context, root string) (databaseSnapshots, error) {
	directory, err := os.MkdirTemp("", "milksu-backup-snapshots-*")
	if err != nil {
		return databaseSnapshots{}, fmt.Errorf("create database snapshot directory: %w", err)
	}
	result := databaseSnapshots{directory: directory, files: make(map[string]string)}
	for index, relativePath := range backupDatabases {
		source := filepath.Join(root, relativePath)
		info, statErr := os.Lstat(source)
		if errors.Is(statErr, os.ErrNotExist) {
			continue
		}
		if statErr != nil {
			os.RemoveAll(directory)
			return databaseSnapshots{}, fmt.Errorf("inspect database %q: %w", relativePath, statErr)
		}
		if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
			os.RemoveAll(directory)
			return databaseSnapshots{}, fmt.Errorf("database %q must be a regular file", relativePath)
		}
		destination := filepath.Join(directory, fmt.Sprintf("%02d.sqlite3", index))
		database, openErr := sql.Open("sqlite", source)
		if openErr != nil {
			os.RemoveAll(directory)
			return databaseSnapshots{}, fmt.Errorf("open database %q: %w", relativePath, openErr)
		}
		_, snapshotErr := database.ExecContext(ctx, `VACUUM INTO ?`, destination)
		closeErr := database.Close()
		if snapshotErr != nil {
			os.RemoveAll(directory)
			return databaseSnapshots{}, fmt.Errorf("snapshot database %q: %w", relativePath, snapshotErr)
		}
		if closeErr != nil {
			os.RemoveAll(directory)
			return databaseSnapshots{}, fmt.Errorf("close database %q: %w", relativePath, closeErr)
		}
		result.files[relativePath] = destination
	}
	return result, nil
}

func addBackupRoot(
	archive *zip.Writer,
	root string,
	relativeRoot string,
	seen map[string]struct{},
	manifest *BackupManifest,
) error {
	source := filepath.Join(root, relativeRoot)
	info, err := os.Lstat(source)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("inspect backup source %q: %w", relativeRoot, err)
	}
	if info.Mode()&os.ModeSymlink != 0 {
		return nil
	}
	if info.Mode().IsRegular() {
		return addBackupFile(archive, source, relativeRoot, seen, manifest)
	}
	if !info.IsDir() {
		return nil
	}
	return filepath.WalkDir(source, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.Type()&os.ModeSymlink != 0 {
			if entry.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if entry.IsDir() {
			return nil
		}
		if !entry.Type().IsRegular() {
			return nil
		}
		relativePath, relativeErr := filepath.Rel(root, path)
		if relativeErr != nil {
			return relativeErr
		}
		return addBackupFile(archive, path, relativePath, seen, manifest)
	})
}

func addBackupFile(
	archive *zip.Writer,
	source string,
	relativePath string,
	seen map[string]struct{},
	manifest *BackupManifest,
) error {
	relativePath, err := secureRelativePath(relativePath)
	if err != nil {
		return err
	}
	if sensitiveBackupPath(relativePath) {
		return nil
	}
	if _, exists := seen[relativePath]; exists {
		return fmt.Errorf("duplicate backup path %q", relativePath)
	}
	seen[relativePath] = struct{}{}

	file, err := os.Open(source)
	if err != nil {
		return fmt.Errorf("open backup source %q: %w", relativePath, err)
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return fmt.Errorf("inspect backup source %q: %w", relativePath, err)
	}
	if !info.Mode().IsRegular() {
		return fmt.Errorf("backup source %q is not a regular file", relativePath)
	}
	header, err := zip.FileInfoHeader(info)
	if err != nil {
		return fmt.Errorf("prepare backup source %q: %w", relativePath, err)
	}
	header.Name = "data/" + filepath.ToSlash(relativePath)
	header.Method = zip.Deflate
	header.SetMode(0o600)
	writer, err := archive.CreateHeader(header)
	if err != nil {
		return fmt.Errorf("create backup entry %q: %w", relativePath, err)
	}
	digest := sha256.New()
	written, err := io.Copy(io.MultiWriter(writer, digest), file)
	if err != nil {
		return fmt.Errorf("write backup entry %q: %w", relativePath, err)
	}
	if written != info.Size() {
		return fmt.Errorf("backup source %q changed while being read", relativePath)
	}
	manifest.Files = append(manifest.Files, BackupFile{
		Path:   filepath.ToSlash(relativePath),
		Bytes:  written,
		SHA256: hex.EncodeToString(digest.Sum(nil)),
	})
	return nil
}

func addSanitizedSettings(
	archive *zip.Writer,
	root string,
	seen map[string]struct{},
	manifest *BackupManifest,
) error {
	const relativePath = "settings.json"
	path := filepath.Join(root, relativePath)
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("read settings for backup: %w", err)
	}
	if len(data) > 4*1024*1024 {
		return fmt.Errorf("settings file is unexpectedly large")
	}
	var value map[string]any
	if err := json.Unmarshal(data, &value); err != nil {
		return fmt.Errorf("decode settings for backup: %w", err)
	}
	removeSensitiveJSONFields(value)
	sanitized, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return fmt.Errorf("encode sanitized settings: %w", err)
	}
	sanitized = append(sanitized, '\n')
	return addBackupBytes(archive, relativePath, sanitized, seen, manifest)
}

func removeSensitiveJSONFields(value any) {
	switch typed := value.(type) {
	case map[string]any:
		for key, child := range typed {
			switch strings.ToLower(strings.TrimSpace(key)) {
			case "api_key", "key", "token", "secret", "password":
				delete(typed, key)
			default:
				removeSensitiveJSONFields(child)
			}
		}
	case []any:
		for _, child := range typed {
			removeSensitiveJSONFields(child)
		}
	}
}

func addBackupBytes(
	archive *zip.Writer,
	relativePath string,
	data []byte,
	seen map[string]struct{},
	manifest *BackupManifest,
) error {
	relativePath, err := secureRelativePath(relativePath)
	if err != nil {
		return err
	}
	if _, exists := seen[relativePath]; exists {
		return fmt.Errorf("duplicate backup path %q", relativePath)
	}
	seen[relativePath] = struct{}{}
	header := &zip.FileHeader{
		Name:   "data/" + filepath.ToSlash(relativePath),
		Method: zip.Deflate,
	}
	header.SetMode(0o600)
	header.SetModTime(time.Now().UTC())
	writer, err := archive.CreateHeader(header)
	if err != nil {
		return fmt.Errorf("create backup entry %q: %w", relativePath, err)
	}
	if _, err := writer.Write(data); err != nil {
		return fmt.Errorf("write backup entry %q: %w", relativePath, err)
	}
	digest := sha256.Sum256(data)
	manifest.Files = append(manifest.Files, BackupFile{
		Path:   filepath.ToSlash(relativePath),
		Bytes:  int64(len(data)),
		SHA256: hex.EncodeToString(digest[:]),
	})
	return nil
}

func archiveDigest(item *zip.File) (string, error) {
	reader, err := item.Open()
	if err != nil {
		return "", fmt.Errorf("open backup entry %q: %w", item.Name, err)
	}
	defer reader.Close()
	digest := sha256.New()
	if _, err := io.Copy(digest, io.LimitReader(reader, maxBackupArchiveBytes+1)); err != nil {
		return "", fmt.Errorf("read backup entry %q: %w", item.Name, err)
	}
	return hex.EncodeToString(digest.Sum(nil)), nil
}

func secureRoot(root string) (string, error) {
	root = filepath.Clean(strings.TrimSpace(root))
	if root == "." || !filepath.IsAbs(root) {
		return "", fmt.Errorf("MilkSU data directory must be absolute")
	}
	info, err := os.Stat(root)
	if err != nil {
		return "", fmt.Errorf("inspect MilkSU data directory: %w", err)
	}
	if !info.IsDir() {
		return "", fmt.Errorf("MilkSU data path is not a directory")
	}
	return root, nil
}

func secureDestination(root, destination string) (string, error) {
	destination = filepath.Clean(strings.TrimSpace(destination))
	if destination == "." || !filepath.IsAbs(destination) {
		return "", fmt.Errorf("backup destination must be absolute")
	}
	relative, err := filepath.Rel(root, destination)
	if err != nil {
		return "", fmt.Errorf("compare backup destination: %w", err)
	}
	if relative == "." || (relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator))) {
		return "", fmt.Errorf("backup destination must be outside the MilkSU data directory")
	}
	return destination, nil
}

func secureRelativePath(path string) (string, error) {
	path = filepath.Clean(strings.TrimSpace(path))
	if path == "." || filepath.IsAbs(path) || path == ".." ||
		strings.HasPrefix(path, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("invalid backup path %q", path)
	}
	return path, nil
}

func validateArchiveName(name string) (string, error) {
	name = filepath.ToSlash(strings.TrimSpace(name))
	if name == "" || strings.HasPrefix(name, "/") || strings.Contains(name, "\\") {
		return "", fmt.Errorf("invalid backup archive path %q", name)
	}
	clean := filepath.ToSlash(filepath.Clean(filepath.FromSlash(name)))
	if clean == "." || clean == ".." || strings.HasPrefix(clean, "../") || clean != name {
		return "", fmt.Errorf("invalid backup archive path %q", name)
	}
	if clean != "manifest.json" && !strings.HasPrefix(clean, "data/") {
		return "", fmt.Errorf("unexpected backup archive path %q", name)
	}
	return clean, nil
}

func sensitiveBackupPath(path string) bool {
	path = filepath.Clean(filepath.FromSlash(path))
	return slices.Contains(sensitiveBackupPaths, path)
}
