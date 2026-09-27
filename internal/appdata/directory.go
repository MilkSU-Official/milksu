package appdata

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const BundleIdentifier = "com.milksu.app"

const (
	// HomeOverrideEnv is the canonical override for the unified state root.
	HomeOverrideEnv = "MILKSU_HOME"
	// DirectoryOverrideEnv is the pre-unification override name. It used to
	// point at the data directory itself; the unified ~/.milksu layout treats
	// it as the root that contains data/, config/, workspaces/ and backups/.
	// Isolated desktop instances rely on this to keep their state inside their
	// own userData/runtime-data directory.
	DirectoryOverrideEnv = "MILKSU_APPDATA_DIR"
)

const homeDirectoryName = ".milksu"

// Home resolves the unified MilkSU state root without creating it.
// Resolution order: MILKSU_HOME, MILKSU_APPDATA_DIR (legacy root alias),
// then ~/.milksu.
func Home() (string, error) {
	root, _, err := resolveHome()
	return root, err
}

// resolveHome returns the state root and whether it came from the platform
// default (true) or an environment override (false). Only the default root is
// eligible for legacy directory migration.
func resolveHome() (string, bool, error) {
	if override := strings.TrimSpace(os.Getenv(HomeOverrideEnv)); override != "" {
		root, err := validateDirectoryOverride(HomeOverrideEnv, override)
		return root, false, err
	}
	if override := strings.TrimSpace(os.Getenv(DirectoryOverrideEnv)); override != "" {
		root, err := validateDirectoryOverride(DirectoryOverrideEnv, override)
		return root, false, err
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", false, fmt.Errorf("resolve user home directory: %w", err)
	}
	return filepath.Join(home, homeDirectoryName), true, nil
}

// Directory resolves the MilkSU data directory (<root>/data) without
// creating it. Most stores only need the data directory; use Home for the
// state root and Ensure before first write.
func Directory() (string, error) {
	root, err := Home()
	if err != nil {
		return "", err
	}
	return filepath.Join(root, "data"), nil
}

// ConfigDirectory resolves <root>/config and creates it.
func ConfigDirectory() (string, error) {
	root, err := Home()
	if err != nil {
		return "", err
	}
	return ensureHomeSubdirectory(root, "config")
}

// WorkspacesDirectory resolves <root>/workspaces and creates it.
func WorkspacesDirectory() (string, error) {
	root, err := Home()
	if err != nil {
		return "", err
	}
	return ensureHomeSubdirectory(root, "workspaces")
}

// BackupsDirectory resolves <root>/backups and creates it.
func BackupsDirectory() (string, error) {
	root, err := Home()
	if err != nil {
		return "", err
	}
	return ensureHomeSubdirectory(root, "backups")
}

func ensureHomeSubdirectory(root, name string) (string, error) {
	directory := filepath.Join(root, name)
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return "", fmt.Errorf("create MilkSU %s directory: %w", name, err)
	}
	if err := os.Chmod(directory, 0o700); err != nil {
		return "", fmt.Errorf("protect MilkSU %s directory: %w", name, err)
	}
	return directory, nil
}

func validateDirectoryOverride(envName, value string) (string, error) {
	clean := filepath.Clean(value)
	if !filepath.IsAbs(clean) {
		return "", fmt.Errorf("%s must be an absolute path", envName)
	}
	if isFilesystemRoot(clean) {
		return "", fmt.Errorf("%s must not point at the filesystem root", envName)
	}
	if home, err := os.UserHomeDir(); err == nil && filepath.Clean(home) == clean {
		return "", fmt.Errorf("%s must not point at the user home directory", envName)
	}
	return clean, nil
}

func isFilesystemRoot(path string) bool {
	clean := filepath.Clean(path)
	return filepath.Dir(clean) == clean
}

// Ensure resolves the state root, migrates legacy platform data into the
// unified ~/.milksu layout when this is the first run of a migrated install,
// creates the root directory skeleton and returns the data directory.
func Ensure() (string, error) {
	root, defaulted, err := resolveHome()
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(root, 0o700); err != nil {
		return "", fmt.Errorf("create MilkSU home directory: %w", err)
	}
	if err := os.Chmod(root, 0o700); err != nil {
		return "", fmt.Errorf("protect MilkSU home directory: %w", err)
	}
	if defaulted {
		if err := migrateLegacyHome(root); err != nil {
			return "", err
		}
	}
	if err := ensureDataLayout(root); err != nil {
		return "", err
	}
	for _, name := range []string{"data", "config", "workspaces", "backups"} {
		if _, err := ensureHomeSubdirectory(root, name); err != nil {
			return "", err
		}
	}
	return filepath.Join(root, "data"), nil
}
