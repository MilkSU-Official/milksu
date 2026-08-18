//go:build windows

package main

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/MilkSU-Official/milksu/internal/appdata"
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
		t.Fatal("Windows must not initialize the macOS-only Coding collaboration manager")
	}
	collaborationDirectory := filepath.Join(root, "appdata", "agent-home", "coding-collaboration")
	if _, err := os.Stat(collaborationDirectory); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("Windows must not create the macOS-only Coding collaboration runtime: %v", err)
	}
}
