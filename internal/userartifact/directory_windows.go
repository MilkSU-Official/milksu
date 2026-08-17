//go:build windows

package userartifact

import (
	"fmt"
	"os"
	"path/filepath"
)

func defaultDirectory() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("resolve user home for MilkSU artifacts: %w", err)
	}
	return filepath.Join(home, "MilkSU"), nil
}
