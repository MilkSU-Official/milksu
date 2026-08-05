package appdata

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const BundleIdentifier = "com.milksu.app"
const DirectoryOverrideEnv = "MILKSU_APPDATA_DIR"

func Directory() (string, error) {
	if override := strings.TrimSpace(os.Getenv(DirectoryOverrideEnv)); override != "" {
		directory, err := validateDirectoryOverride(override)
		if err != nil {
			return "", err
		}
		return directory, nil
	}
	base, err := os.UserConfigDir()
	if err != nil {
		return "", fmt.Errorf("resolve user config directory: %w", err)
	}
	return filepath.Join(base, BundleIdentifier), nil
}

func validateDirectoryOverride(value string) (string, error) {
	clean := filepath.Clean(value)
	if !filepath.IsAbs(clean) {
		return "", fmt.Errorf("%s must be an absolute path", DirectoryOverrideEnv)
	}
	if isFilesystemRoot(clean) {
		return "", fmt.Errorf("%s must not point at the filesystem root", DirectoryOverrideEnv)
	}
	if home, err := os.UserHomeDir(); err == nil && filepath.Clean(home) == clean {
		return "", fmt.Errorf("%s must not point at the user home directory", DirectoryOverrideEnv)
	}
	return clean, nil
}

func isFilesystemRoot(path string) bool {
	clean := filepath.Clean(path)
	return filepath.Dir(clean) == clean
}

func Ensure() (string, error) {
	directory, err := Directory()
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return "", fmt.Errorf("create app data directory: %w", err)
	}
	if err := os.Chmod(directory, 0o700); err != nil {
		return "", fmt.Errorf("protect app data directory: %w", err)
	}
	if err := ensureDataLayout(directory); err != nil {
		return "", err
	}
	return directory, nil
}
