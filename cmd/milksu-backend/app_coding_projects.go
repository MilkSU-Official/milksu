package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"unicode/utf8"

	"github.com/MilkSU-Official/milksu/internal/codingworkspace"
)

func (a *App) GetCodingProjectMemory() (codingworkspace.Snapshot, error) {
	if a.codingProjects == nil {
		return codingworkspace.Snapshot{}, errors.New("Coding project memory is unavailable")
	}
	return a.codingProjects.Get()
}

func (a *App) RememberCodingProject(path string) (codingworkspace.Snapshot, error) {
	if a.codingProjects == nil {
		return codingworkspace.Snapshot{}, errors.New("Coding project memory is unavailable")
	}
	return a.codingProjects.Remember(path)
}

func (a *App) ForgetCodingProject(path string) (codingworkspace.Snapshot, error) {
	if a.codingProjects == nil {
		return codingworkspace.Snapshot{}, errors.New("Coding project memory is unavailable")
	}
	return a.codingProjects.Forget(path)
}

// CreateAgentWorkspace creates a new blank project directory under an existing
// parent directory picked by the user, then returns the created path. When the
// requested name is taken, a numeric suffix keeps the directory unique.
func (a *App) CreateAgentWorkspace(parent string, name string) (string, error) {
	resolvedParent, err := normalizeAgentWorkspaceSelection(parent)
	if err != nil {
		return "", fmt.Errorf("resolve project parent directory: %w", err)
	}
	cleaned, err := cleanAgentWorkspaceName(name)
	if err != nil {
		return "", err
	}
	target := filepath.Join(resolvedParent, cleaned)
	for suffix := 2; ; suffix++ {
		_, statErr := os.Stat(target)
		if statErr == nil {
			target = filepath.Join(resolvedParent, fmt.Sprintf("%s-%d", cleaned, suffix))
			continue
		}
		if !os.IsNotExist(statErr) {
			return "", fmt.Errorf("inspect project directory: %w", statErr)
		}
		break
	}
	if err := os.Mkdir(target, 0o755); err != nil {
		return "", fmt.Errorf("create project directory: %w", err)
	}
	return target, nil
}

func cleanAgentWorkspaceName(name string) (string, error) {
	cleaned := strings.TrimRight(strings.TrimSpace(name), " .")
	if cleaned == "" {
		return "", errors.New("project name is empty")
	}
	if utf8.RuneCountInString(cleaned) > 64 {
		return "", errors.New("project name is too long")
	}
	if cleaned == "." || cleaned == ".." {
		return "", errors.New("project name is reserved")
	}
	for _, r := range cleaned {
		if r < 0x20 || r == 0x7f {
			return "", errors.New("project name contains control characters")
		}
	}
	if strings.ContainsAny(cleaned, `/\<>|"?*:`) {
		return "", errors.New("project name contains reserved characters")
	}
	return cleaned, nil
}
