package appdata

import (
	"fmt"
	"os"
	"path/filepath"
)

const BundleIdentifier = "com.milksu.app"

func Directory() (string, error) {
	base, err := os.UserConfigDir()
	if err != nil {
		return "", fmt.Errorf("resolve user config directory: %w", err)
	}
	return filepath.Join(base, BundleIdentifier), nil
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
	return directory, nil
}
