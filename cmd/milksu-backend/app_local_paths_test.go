package main

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestRevealLocalDataDirectoryDelegatesToDesktopHost(t *testing.T) {
	host := &stubDesktopHost{}
	directory := filepath.Join(t.TempDir(), "local data")
	app := &App{ctx: context.Background(), host: host, dataDirectory: directory}

	if err := app.RevealLocalDataDirectory(); err != nil {
		t.Fatalf("reveal local data directory: %v", err)
	}
	assertOpenPathCall(t, host, directory)
}

func TestRevealUserArtifactDirectoryEnsuresAndDelegatesToDesktopHost(t *testing.T) {
	host := &stubDesktopHost{}
	directory := filepath.Join(t.TempDir(), "Documents", "MilkSU")
	app := &App{ctx: context.Background(), host: host, artifactDirectory: directory}

	if err := app.RevealUserArtifactDirectory(); err != nil {
		t.Fatalf("reveal user artifact directory: %v", err)
	}
	if info, err := os.Stat(directory); err != nil || !info.IsDir() {
		t.Fatalf("artifact directory was not ensured: %v", err)
	}
	assertOpenPathCall(t, host, directory)
}

func TestRevealLocalDataDirectorySurfacesHostFailure(t *testing.T) {
	host := &stubDesktopHost{err: errors.New("shell unavailable")}
	app := &App{
		ctx: context.Background(), host: host,
		dataDirectory: filepath.Join(t.TempDir(), "local data"),
	}

	if err := app.RevealLocalDataDirectory(); err == nil || err.Error() != "shell unavailable" {
		t.Fatalf("expected host failure, got %v", err)
	}
}

func assertOpenPathCall(t *testing.T, host *stubDesktopHost, want string) {
	t.Helper()
	if len(host.calls) != 1 || host.calls[0] != "shell.openPath" {
		t.Fatalf("unexpected host calls: %#v", host.calls)
	}
	payload, ok := host.payload.(map[string]string)
	if !ok || payload["path"] != want {
		t.Fatalf("unexpected open path payload: %#v", host.payload)
	}
}
