// Package plugins embeds the production-reviewed plugin set in the Go runtime.
// Development plugins are intentionally outside this filesystem.
package plugins

import (
	"bytes"
	"crypto/sha256"
	"embed"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

//go:embed all:official
var officialFS embed.FS

type embeddedFile struct {
	path    string
	payload []byte
}

// MaterializeOfficial creates a content-addressed snapshot of the exact bytes
// embedded in the executable. A populated target is never repaired in place:
// it must match byte-for-byte or startup fails closed.
func MaterializeOfficial(dataDirectory string) (string, error) {
	files, digest, err := embeddedOfficialFiles()
	if err != nil {
		return "", err
	}
	parent := filepath.Join(dataDirectory, "plugins", "bundled")
	root := filepath.Join(parent, digest)
	officialRoot := filepath.Join(root, "official")
	if info, statErr := os.Lstat(root); statErr == nil {
		if info.Mode()&os.ModeSymlink != 0 || !info.IsDir() {
			return "", errors.New("embedded plugin cache target is not a regular directory")
		}
		if err := verifyMaterializedOfficial(officialRoot, files); err != nil {
			return "", fmt.Errorf("embedded plugin cache does not match this executable: %w", err)
		}
		return officialRoot, nil
	} else if !errors.Is(statErr, os.ErrNotExist) {
		return "", statErr
	}
	if err := os.MkdirAll(parent, 0o700); err != nil {
		return "", fmt.Errorf("create embedded plugin cache parent: %w", err)
	}
	temporary, err := os.MkdirTemp(parent, ".materialize-*")
	if err != nil {
		return "", err
	}
	defer os.RemoveAll(temporary)
	temporaryOfficial := filepath.Join(temporary, "official")
	for _, file := range files {
		destination, err := safeDestination(temporaryOfficial, file.path)
		if err != nil {
			return "", err
		}
		if err := os.MkdirAll(filepath.Dir(destination), 0o700); err != nil {
			return "", err
		}
		handle, err := os.OpenFile(destination, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
		if err != nil {
			return "", err
		}
		if _, err := handle.Write(file.payload); err != nil {
			handle.Close()
			return "", err
		}
		if err := handle.Sync(); err != nil {
			handle.Close()
			return "", err
		}
		if err := handle.Close(); err != nil {
			return "", err
		}
	}
	if err := verifyMaterializedOfficial(temporaryOfficial, files); err != nil {
		return "", err
	}
	if err := os.Rename(temporary, root); err != nil {
		if verifyErr := verifyMaterializedOfficial(officialRoot, files); verifyErr == nil {
			return officialRoot, nil
		}
		return "", fmt.Errorf("publish embedded plugin snapshot: %w", err)
	}
	return officialRoot, nil
}

func embeddedOfficialFiles() ([]embeddedFile, string, error) {
	files := make([]embeddedFile, 0, 8)
	caseFolded := make(map[string]string, 8)
	err := fs.WalkDir(officialFS, "official", func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if !fs.ValidPath(path) || (path != "official" && !strings.HasPrefix(path, "official/")) {
			return fmt.Errorf("embedded plugin path is invalid: %q", path)
		}
		if entry.IsDir() {
			return nil
		}
		if entry.Type()&fs.ModeSymlink != 0 || !entry.Type().IsRegular() {
			return fmt.Errorf("embedded plugin entry is not a regular file: %s", path)
		}
		payload, err := officialFS.ReadFile(path)
		if err != nil {
			return err
		}
		relative := strings.TrimPrefix(path, "official/")
		folded := strings.ToLower(relative)
		if previous, collision := caseFolded[folded]; collision && previous != relative {
			return fmt.Errorf("embedded plugin paths collide across filesystems: %s and %s", previous, relative)
		}
		caseFolded[folded] = relative
		files = append(files, embeddedFile{
			path:    relative,
			payload: payload,
		})
		return nil
	})
	if err != nil {
		return nil, "", fmt.Errorf("read embedded plugins: %w", err)
	}
	sort.Slice(files, func(i, j int) bool { return files[i].path < files[j].path })
	hash := sha256.New()
	var length [8]byte
	for _, file := range files {
		binary.BigEndian.PutUint64(length[:], uint64(len(file.path)))
		_, _ = hash.Write(length[:])
		_, _ = hash.Write([]byte(file.path))
		binary.BigEndian.PutUint64(length[:], uint64(len(file.payload)))
		_, _ = hash.Write(length[:])
		_, _ = hash.Write(file.payload)
	}
	return files, hex.EncodeToString(hash.Sum(nil)), nil
}

func verifyMaterializedOfficial(root string, expected []embeddedFile) error {
	actual := make(map[string][]byte, len(expected))
	err := filepath.WalkDir(root, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("cache contains symlink: %s", path)
		}
		if entry.IsDir() {
			return nil
		}
		if !info.Mode().IsRegular() {
			return fmt.Errorf("cache contains non-regular file: %s", path)
		}
		relative, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		key := filepath.ToSlash(relative)
		if !fs.ValidPath(key) {
			return fmt.Errorf("cache contains invalid path: %s", key)
		}
		payload, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		actual[key] = payload
		return nil
	})
	if err != nil {
		return err
	}
	if len(actual) != len(expected) {
		return fmt.Errorf("cache file count is %d, expected %d", len(actual), len(expected))
	}
	for _, file := range expected {
		payload, ok := actual[file.path]
		if !ok || !bytes.Equal(payload, file.payload) {
			return fmt.Errorf("cache file %s differs", file.path)
		}
	}
	return nil
}

func safeDestination(root, relative string) (string, error) {
	if !fs.ValidPath(relative) || relative == "." {
		return "", fmt.Errorf("embedded plugin relative path is invalid: %q", relative)
	}
	destination := filepath.Join(root, filepath.FromSlash(relative))
	rel, err := filepath.Rel(root, destination)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(os.PathSeparator)) {
		return "", fmt.Errorf("embedded plugin path escapes its snapshot: %q", relative)
	}
	return destination, nil
}
