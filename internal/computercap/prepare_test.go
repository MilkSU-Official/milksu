package computercap

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestMissingDriverProblemForbidsOfficialInstaller(t *testing.T) {
	if !strings.Contains(MissingDriverProblem, "prepare_computer_use_driver") {
		t.Fatal("missing-driver problem does not point at the typed prepare tool")
	}
	if !strings.Contains(MissingDriverProblem, "不要运行 Cua 官方安装脚本") {
		t.Fatal("missing-driver problem still allows the official Cua installer")
	}
}

func TestPrepareCopiesReviewedDriverIntoUserConfig(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("reviewed driver copy uses the Windows sidecar-cache layout")
	}
	workspace := t.TempDir()
	t.Chdir(workspace)
	appdata := t.TempDir()
	t.Setenv("MILKSU_APPDATA_DIR", appdata)

	sourceDir := filepath.Join(workspace, "build", "sidecar-cache", "cua-windows-"+DriverVersion, "r")
	if err := os.MkdirAll(sourceDir, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(workspace, "scripts"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(workspace, "third_party", "cua-driver"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(workspace, "scripts", "build-windows-cua-driver.mjs"), []byte(""), 0o600); err != nil {
		t.Fatal(err)
	}
	source := filepath.Join(sourceDir, driverExecutableName(runtime.GOOS))
	if err := os.WriteFile(source, []byte("not-a-real-driver"), 0o755); err != nil {
		t.Fatal(err)
	}

	manager := New(Options{
		GOOS:            runtime.GOOS,
		PermissionProbe: func(bool) Permissions { return Permissions{true, true} },
		CommandFactory:  helperCommand,
	})
	result, err := manager.Prepare(context.Background(), PrepareOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if !result.Ready || result.Source != "copied" {
		t.Fatalf("expected copied local driver: %#v", result)
	}
	prepared, err := preparedDriverPath(runtime.GOOS)
	if err != nil {
		t.Fatal(err)
	}
	if result.Path != prepared {
		t.Fatalf("prepared path %q, want %q", result.Path, prepared)
	}
	status := manager.Status()
	if !status.Available {
		t.Fatalf("local prepared driver was not resolved: %#v", status)
	}
}

func TestPrepareWithoutSourceDoesNotRunOfficialInstaller(t *testing.T) {
	if runtime.GOOS != "windows" && runtime.GOOS != "darwin" {
		t.Skip("Computer Use prepare is macOS/Windows")
	}
	t.Chdir(t.TempDir())
	t.Setenv("MILKSU_APPDATA_DIR", t.TempDir())
	t.Setenv("MILKSU_SIDECAR_DIR", t.TempDir())
	manager := New(Options{
		GOOS:            runtime.GOOS,
		PermissionProbe: func(bool) Permissions { return Permissions{true, true} },
		CommandFactory:  helperCommand,
	})
	result, err := manager.Prepare(context.Background(), PrepareOptions{})
	if err == nil {
		t.Fatalf("expected prepare to fail without a reviewed binary: %#v", result)
	}
	if result.Ready {
		t.Fatal("prepare reported ready without a driver")
	}
	if strings.Contains(strings.ToLower(result.NextStep+" "+result.Problem), "install.ps1") ||
		strings.Contains(strings.ToLower(result.NextStep+" "+result.Problem), "cua.ai") {
		t.Fatalf("prepare pointed at the official installer: %#v", result)
	}
}

func TestUnavailableStatusAsksForTypedPrepare(t *testing.T) {
	if runtime.GOOS != "windows" && runtime.GOOS != "darwin" {
		t.Skip("Computer Use missing-driver status is macOS/Windows")
	}
	t.Chdir(t.TempDir())
	t.Setenv("MILKSU_APPDATA_DIR", t.TempDir())
	t.Setenv("MILKSU_SIDECAR_DIR", t.TempDir())
	manager := New(Options{
		GOOS:            runtime.GOOS,
		PermissionProbe: func(bool) Permissions { return Permissions{true, true} },
	})
	status := manager.Status()
	if status.Available || status.Problem != MissingDriverProblem {
		t.Fatalf("missing driver should ask for typed prepare: %#v", status)
	}
}
