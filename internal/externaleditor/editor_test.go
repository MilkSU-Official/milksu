package externaleditor

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestNormalizeUnknownFallsBackToVSCode(t *testing.T) {
	if Normalize("") != DefaultID || Normalize("notepad") != DefaultID {
		t.Fatalf("expected default vscode, got %q / %q", Normalize(""), Normalize("notepad"))
	}
	if Normalize(" Cursor ") != "cursor" {
		t.Fatalf("expected cursor, got %q", Normalize(" Cursor "))
	}
}

func TestOpenLaunchesPreferredEditorWithWorkspaceFile(t *testing.T) {
	workspace := t.TempDir()
	relative := filepath.Join("app", "src", "App.vue")
	absolute := filepath.Join(workspace, relative)
	if err := os.MkdirAll(filepath.Dir(absolute), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(absolute, []byte("export {}\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	var gotCommand string
	var gotArgs []string
	var gotWait bool
	launch = func(command string, args []string, wait bool) error {
		gotCommand = command
		gotArgs = append([]string(nil), args...)
		gotWait = wait
		return nil
	}
	lookPath = func(name string) (string, error) { return name, nil }
	t.Cleanup(func() {
		launch = launchProcess
		lookPath = exec.LookPath
	})

	if err := Open(workspace, "app/src/App.vue", "vscode"); err != nil {
		t.Fatal(err)
	}
	want, err := filepath.EvalSymlinks(absolute)
	if err != nil {
		t.Fatal(err)
	}
	if runtime.GOOS == "darwin" {
		if gotCommand != "open" || len(gotArgs) != 3 || gotArgs[0] != "-a" || gotArgs[1] != "Visual Studio Code" {
			t.Fatalf("unexpected darwin launch: %s %q", gotCommand, gotArgs)
		}
		if !gotWait {
			t.Fatal("darwin open -a must wait for the handoff")
		}
		if gotArgs[2] != want {
			t.Fatalf("opened %q, want %q", gotArgs[2], want)
		}
		return
	}
	if len(gotArgs) != 1 || gotArgs[0] != want {
		t.Fatalf("unexpected launch args: %s %q", gotCommand, gotArgs)
	}
}

func TestOpenRejectsPathEscape(t *testing.T) {
	workspace := t.TempDir()
	launch = func(string, []string, bool) error {
		t.Fatal("launch must not run for escaped paths")
		return nil
	}
	t.Cleanup(func() { launch = launchProcess })

	err := Open(workspace, "../secret.txt", "vscode")
	if err == nil || !strings.Contains(err.Error(), "leaves the project workspace") {
		t.Fatalf("expected workspace confinement, got %v", err)
	}
}

func TestOpenMissingFileOpensParentDirectory(t *testing.T) {
	workspace := t.TempDir()
	relative := filepath.Join("removed", "gone.ts")
	parent := filepath.Join(workspace, "removed")
	if err := os.MkdirAll(parent, 0o755); err != nil {
		t.Fatal(err)
	}

	var opened string
	launch = func(_ string, args []string, _ bool) error {
		opened = args[len(args)-1]
		return nil
	}
	lookPath = func(name string) (string, error) { return name, nil }
	t.Cleanup(func() {
		launch = launchProcess
		lookPath = exec.LookPath
	})

	if err := Open(workspace, filepath.ToSlash(relative), "cursor"); err != nil {
		t.Fatal(err)
	}
	want, err := filepath.EvalSymlinks(parent)
	if err != nil {
		t.Fatal(err)
	}
	if opened != want {
		t.Fatalf("opened %q, want parent %q", opened, want)
	}
}

func TestOpenMapsLaunchFailureToMissingEditor(t *testing.T) {
	workspace := t.TempDir()
	file := filepath.Join(workspace, "main.go")
	if err := os.WriteFile(file, []byte("package main\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	launch = func(string, []string, bool) error {
		return os.ErrNotExist
	}
	t.Cleanup(func() { launch = launchProcess })

	err := Open(workspace, "main.go", "vscode")
	if err == nil || err.Error() != "找不到 VS Code" {
		t.Fatalf("got %v", err)
	}
}
