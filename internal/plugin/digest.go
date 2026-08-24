package plugin

import (
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

const (
	maxPackageBytes = 16 << 20
	maxPackageFiles = 128
)

// packageDigest binds every path and byte in a plugin directory. Length
// prefixes make the stream unambiguous across platforms and file boundaries.
func packageDigest(directory string) (string, error) {
	return digestDirectory(directory, nil)
}

func packagePayloadDigest(directory string) (string, error) {
	return digestDirectory(directory, map[string]struct{}{signatureFileName: {}})
}

func digestDirectory(directory string, ignored map[string]struct{}) (string, error) {
	root, err := filepath.Abs(directory)
	if err != nil {
		return "", err
	}
	paths := make([]string, 0, 8)
	caseFolded := make(map[string]string, 8)
	var total int64
	err = filepath.WalkDir(root, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if path == root {
			return nil
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("plugin package contains symlink: %s", path)
		}
		if entry.IsDir() {
			return nil
		}
		if !info.Mode().IsRegular() {
			return fmt.Errorf("plugin package contains non-regular file: %s", path)
		}
		total += info.Size()
		if total > maxPackageBytes {
			return fmt.Errorf("plugin package is larger than %d bytes", maxPackageBytes)
		}
		relative, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		relative = filepath.ToSlash(relative)
		if _, skip := ignored[relative]; skip {
			return nil
		}
		folded := strings.ToLower(relative)
		if previous, collision := caseFolded[folded]; collision && previous != relative {
			return fmt.Errorf("plugin package paths collide across filesystems: %s and %s", previous, relative)
		}
		caseFolded[folded] = relative
		paths = append(paths, relative)
		if len(paths) > maxPackageFiles {
			return fmt.Errorf("plugin package contains more than %d files", maxPackageFiles)
		}
		return nil
	})
	if err != nil {
		return "", err
	}
	sort.Strings(paths)
	hash := sha256.New()
	var length [8]byte
	for _, relative := range paths {
		binary.BigEndian.PutUint64(length[:], uint64(len(relative)))
		_, _ = hash.Write(length[:])
		_, _ = io.WriteString(hash, relative)
		path := filepath.Join(root, filepath.FromSlash(relative))
		info, err := os.Stat(path)
		if err != nil {
			return "", err
		}
		binary.BigEndian.PutUint64(length[:], uint64(info.Size()))
		_, _ = hash.Write(length[:])
		file, err := os.Open(path)
		if err != nil {
			return "", err
		}
		_, copyErr := io.Copy(hash, io.LimitReader(file, maxPackageBytes+1))
		closeErr := file.Close()
		if copyErr != nil {
			return "", copyErr
		}
		if closeErr != nil {
			return "", closeErr
		}
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}

func validDigest(value string) bool {
	return hexDigestPattern.MatchString(strings.ToLower(strings.TrimSpace(value)))
}
