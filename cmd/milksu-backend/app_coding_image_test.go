package main

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func writeWorkspacePNG(t *testing.T, workspace, name string) {
	t.Helper()
	png := []byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n', 0, 0, 0, 0}
	if err := os.WriteFile(filepath.Join(workspace, name), png, 0o600); err != nil {
		t.Fatal(err)
	}
}

func TestCopyCodingImageSendsTheWorkspaceFileToTheClipboard(t *testing.T) {
	workspace := t.TempDir()
	writeWorkspacePNG(t, workspace, "milk-cat.png")
	host := &stubDesktopHost{}
	app := &App{ctx: context.Background(), host: host}

	if err := app.CopyCodingImage(workspace, "milk-cat.png"); err != nil {
		t.Fatal(err)
	}
	if len(host.calls) != 1 || host.calls[0] != "clipboard.writeImage" {
		t.Fatalf("host calls = %#v", host.calls)
	}
	payload, _ := host.payload.(map[string]string)
	want, err := filepath.EvalSymlinks(filepath.Join(workspace, "milk-cat.png"))
	if err != nil {
		t.Fatal(err)
	}
	if payload["path"] != want {
		t.Fatalf("clipboard path = %#v", host.payload)
	}
}

func TestCodingImageActionsRefusePathsOutsideTheWorkspace(t *testing.T) {
	workspace := t.TempDir()
	host := &stubDesktopHost{}
	app := &App{ctx: context.Background(), host: host}
	for _, path := range []string{"../milk-cat.png", "/tmp/milk-cat.png", "notes.md"} {
		if err := app.CopyCodingImage(workspace, path); err == nil {
			t.Fatalf("expected %q to be refused", path)
		}
		if err := app.RevealCodingImage(workspace, path); err == nil {
			t.Fatalf("expected reveal %q to be refused", path)
		}
	}
	if len(host.calls) != 0 {
		t.Fatalf("refused paths must not reach the desktop host: %#v", host.calls)
	}
}

func TestRevealCodingImageSelectsTheWorkspaceFile(t *testing.T) {
	workspace := t.TempDir()
	writeWorkspacePNG(t, workspace, "milk-cat.png")
	host := &stubDesktopHost{}
	app := &App{ctx: context.Background(), host: host}

	if err := app.RevealCodingImage(workspace, "milk-cat.png"); err != nil {
		t.Fatal(err)
	}
	if len(host.calls) != 1 || host.calls[0] != "shell.showItemInFolder" {
		t.Fatalf("host calls = %#v", host.calls)
	}
}

func TestSaveCodingImageCopiesAfterTheDialogAndSkipsCancel(t *testing.T) {
	workspace := t.TempDir()
	writeWorkspacePNG(t, workspace, "milk-cat.png")
	destination := filepath.Join(t.TempDir(), "saved.png")
	host := &stubDesktopHost{result: destination}
	app := &App{ctx: context.Background(), host: host}

	if err := app.SaveCodingImage(workspace, "milk-cat.png"); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(destination)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) == 0 {
		t.Fatal("saved file is empty")
	}

	host.result = ""
	host.calls = nil
	cancelled := filepath.Join(t.TempDir(), "not-written.png")
	if err := app.SaveCodingImage(workspace, "milk-cat.png"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(cancelled); !os.IsNotExist(err) {
		t.Fatalf("cancel wrote a file: %v", err)
	}
}
