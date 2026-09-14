//go:build windows

package main

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/MilkSU-Official/milksu/internal/appdata"
	"github.com/MilkSU-Official/milksu/internal/codingcollab"
	"github.com/MilkSU-Official/milksu/internal/userartifact"
)

func TestWindowsStartupDoesNotRequireGit(t *testing.T) {
	t.Setenv("PATH", "")

	root := t.TempDir()
	t.Setenv(appdata.DirectoryOverrideEnv, filepath.Join(root, "appdata"))
	t.Setenv(userartifact.DirectoryOverrideEnv, filepath.Join(root, "artifacts"))

	application, err := newAppWithDesktopHost(nil)
	if err != nil {
		t.Fatalf("initialize MilkSU without Git: %v", err)
	}
	t.Cleanup(func() {
		application.Shutdown(context.Background())
	})

	if application.codingCollab != nil {
		t.Fatal("a machine without Git received a Coding collaboration manager")
	}
	collaborationDirectory := filepath.Join(root, "appdata", "agent-home", "coding-collaboration")
	if _, err := os.Stat(collaborationDirectory); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("a refused manager created collaboration state: %v", err)
	}

	_, err = application.prepareAgentManagedCodingCollaboration(
		"conversation-no-git",
		root,
		1,
	)
	if !errors.Is(err, codingcollab.ErrGitUnavailable) {
		t.Fatalf("prepare without Git = %v", err)
	}
}
