package browsercap

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestFindChromePrefersNixAndDesktopEntriesOnLinux(t *testing.T) {
	root := t.TempDir()
	nixBin := filepath.Join(root, ".nix-profile", "bin", "chromium")
	if err := os.MkdirAll(filepath.Dir(nixBin), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(nixBin, []byte("#!/bin/sh\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	applications := filepath.Join(root, "share", "applications")
	if err := os.MkdirAll(applications, 0o755); err != nil {
		t.Fatal(err)
	}
	desktop := filepath.Join(applications, "chromium.desktop")
	desktopExec := filepath.Join(root, "opt", "chromium")
	if err := os.MkdirAll(filepath.Dir(desktopExec), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(desktopExec, []byte("#!/bin/sh\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(desktop, []byte("[Desktop Entry]\nExec="+desktopExec+" %U\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	t.Run("nix profile", func(t *testing.T) {
		got, err := findChromeWith("linux", func(name string) string {
			if name == "HOME" {
				return root
			}
			return ""
		}, func(string) (string, error) {
			return "", errors.New("not on PATH")
		}, regularFile)
		if err != nil {
			t.Fatal(err)
		}
		if got != nixBin {
			t.Fatalf("got %q, want nix profile chromium %q", got, nixBin)
		}
	})

	t.Run("desktop entry", func(t *testing.T) {
		got, err := findChromeWith("linux", func(name string) string {
			switch name {
			case "HOME":
				return filepath.Join(root, "empty-home")
			case "XDG_DATA_DIRS":
				return filepath.Join(root, "share")
			default:
				return ""
			}
		}, func(string) (string, error) {
			return "", errors.New("not on PATH")
		}, regularFile)
		if err != nil {
			t.Fatal(err)
		}
		if got != desktopExec {
			t.Fatalf("got %q, want desktop Exec %q", got, desktopExec)
		}
	})
}

func TestDesktopExecPathReadsFirstCommand(t *testing.T) {
	got := desktopExecPath("[Desktop Entry]\nName=Chromium\nExec=/usr/bin/chromium --password-store=basic %U\n")
	if got != "/usr/bin/chromium" {
		t.Fatalf("got %q", got)
	}
}
