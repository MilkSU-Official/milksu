package engine

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/MilkSU-Official/milksu/internal/appdata"
	"github.com/MilkSU-Official/milksu/internal/config"
)

const packagedSidecarDirectory = "milksu-sidecar"

type sidecarRuntime struct {
	node     string
	bridge   string
	packaged bool
}

func sidecarEnvironment(settings config.AppSettings) ([]string, error) {
	runtimeHome, err := sidecarRuntimeHome()
	if err != nil {
		return nil, err
	}
	userHome, err := os.UserHomeDir()
	if err != nil {
		return nil, fmt.Errorf("resolve local user home: %w", err)
	}
	environment := engineEnvironment(settings)
	filtered := environment[:0]
	for _, entry := range environment {
		if !strings.HasPrefix(entry, "HOME=") {
			filtered = append(filtered, entry)
		}
	}
	environment = append(
		filtered,
		"HOME="+runtimeHome,
		"MILKSU_PI_AGENT_DIR="+filepath.Join(runtimeHome, "pi"),
		"MILKSU_USER_HOME="+userHome,
	)
	if socket := strings.TrimSpace(os.Getenv("SSH_AUTH_SOCK")); socket != "" {
		environment = append(environment, "MILKSU_USER_SSH_AUTH_SOCK="+socket)
	}
	return environment, nil
}

func newSidecarCommand(packagedBridge, sourceBridge string) (*exec.Cmd, error) {
	workspace, err := sidecarWorkspace()
	if err != nil {
		return nil, err
	}
	return newSidecarCommandAt(packagedBridge, sourceBridge, workspace, false)
}

func newSidecarCommandAt(
	packagedBridge,
	sourceBridge,
	workspace string,
	allowChildProcess bool,
) (*exec.Cmd, error) {
	runtime, err := resolveSidecarRuntime(packagedBridge, sourceBridge)
	if err != nil {
		return nil, err
	}
	workspace, err = resolveAgentWorkspace(workspace)
	if err != nil {
		return nil, err
	}
	runtimeHome, err := sidecarRuntimeHome()
	if err != nil {
		return nil, err
	}

	arguments := []string{runtime.bridge}
	if runtime.packaged {
		sidecarDirectory := filepath.Dir(runtime.bridge)
		arguments = []string{
			"--permission",
			"--allow-fs-read=" + sidecarDirectory,
			"--allow-fs-read=" + workspace,
			"--allow-fs-read=" + runtimeHome,
			"--allow-fs-write=" + workspace,
			"--allow-fs-write=" + runtimeHome,
		}
		if allowChildProcess {
			arguments = append(
				arguments,
				"--allow-child-process",
				"--allow-fs-read=/bin/bash",
				"--allow-fs-read=/bin/sh",
				"--allow-fs-read=/usr/bin/env",
				"--allow-fs-read=/usr/bin/sandbox-exec",
			)
		}
		arguments = append(arguments, runtime.bridge)
	}
	command := exec.Command(runtime.node, arguments...)
	command.Dir = workspace
	return command, nil
}

func withWorkspaceTemporaryDirectory(environment []string, workspace string) ([]string, error) {
	temporaryDirectory := filepath.Join(workspace, ".milksu", "tmp")
	if err := os.MkdirAll(temporaryDirectory, 0o700); err != nil {
		return nil, fmt.Errorf("create Sidecar workspace temp directory: %w", err)
	}
	filtered := environment[:0]
	for _, entry := range environment {
		if !strings.HasPrefix(entry, "TMPDIR=") {
			filtered = append(filtered, entry)
		}
	}
	return append(filtered, "TMPDIR="+temporaryDirectory), nil
}

func withSidecarRuntimePath(environment []string, nodeBinary string) []string {
	runtimeDirectory := filepath.Dir(nodeBinary)
	pathValue := ""
	filtered := environment[:0]
	for _, entry := range environment {
		if strings.HasPrefix(entry, "PATH=") {
			pathValue = strings.TrimPrefix(entry, "PATH=")
			continue
		}
		filtered = append(filtered, entry)
	}
	if pathValue == "" {
		pathValue = os.Getenv("PATH")
	}
	if pathValue == "" {
		return append(filtered, "PATH="+runtimeDirectory)
	}
	return append(
		filtered,
		"PATH="+runtimeDirectory+string(os.PathListSeparator)+pathValue,
	)
}

func resolveSidecarRuntime(packagedBridge, sourceBridge string) (sidecarRuntime, error) {
	if override := os.Getenv("MILKSU_SIDECAR_DIR"); override != "" {
		if runtime, ok := packagedRuntimeAt(override, packagedBridge); ok {
			return runtime, nil
		}
		return sidecarRuntime{}, fmt.Errorf("MILKSU_SIDECAR_DIR does not contain a complete runtime: %s", override)
	}

	if executable, err := os.Executable(); err == nil {
		resources := filepath.Join(filepath.Dir(executable), "..", "Resources", packagedSidecarDirectory)
		if runtime, ok := packagedRuntimeAt(resources, packagedBridge); ok {
			return runtime, nil
		}
	}

	root, err := findProjectRoot()
	if err != nil {
		return sidecarRuntime{}, fmt.Errorf("find packaged or development Sidecar: %w", err)
	}
	node, err := exec.LookPath("node")
	if err != nil {
		return sidecarRuntime{}, fmt.Errorf("development Sidecar requires Node.js: %w", err)
	}
	return sidecarRuntime{node: node, bridge: filepath.Join(root, sourceBridge)}, nil
}

func packagedRuntimeAt(directory, bridgeName string) (sidecarRuntime, bool) {
	node := filepath.Join(directory, "node")
	bridge := filepath.Join(directory, bridgeName)
	if !regularFile(node) || !regularFile(bridge) {
		return sidecarRuntime{}, false
	}
	return sidecarRuntime{node: node, bridge: bridge, packaged: true}, true
}

func regularFile(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.Mode().IsRegular()
}

func sidecarWorkspace() (string, error) {
	directory, err := appdata.Ensure()
	if err != nil {
		return "", err
	}
	workspace := filepath.Join(directory, "agent-workspace")
	if err := os.MkdirAll(workspace, 0o700); err != nil {
		return "", fmt.Errorf("create Sidecar workspace: %w", err)
	}
	// Pi discovers repository-scoped resources by walking ancestors even when
	// Skills and extensions are disabled. This empty boundary marker stops that
	// walk inside MilkSU's isolated workspace instead of granting parent reads.
	if err := os.MkdirAll(filepath.Join(workspace, ".git"), 0o700); err != nil {
		return "", fmt.Errorf("create Sidecar discovery boundary: %w", err)
	}
	return workspace, nil
}

func sidecarRuntimeHome() (string, error) {
	directory, err := appdata.Ensure()
	if err != nil {
		return "", err
	}
	runtimeHome := filepath.Join(directory, "agent-home")
	if err := os.MkdirAll(runtimeHome, 0o700); err != nil {
		return "", fmt.Errorf("create Sidecar runtime home: %w", err)
	}
	return runtimeHome, nil
}

func resolveAgentWorkspace(value string) (string, error) {
	workspace := strings.TrimSpace(value)
	if workspace == "" {
		return sidecarWorkspace()
	}
	absolute, err := filepath.Abs(workspace)
	if err != nil {
		return "", fmt.Errorf("resolve Agent workspace: %w", err)
	}
	resolved, err := filepath.EvalSymlinks(absolute)
	if err != nil {
		return "", fmt.Errorf("resolve Agent workspace links: %w", err)
	}
	info, err := os.Stat(resolved)
	if err != nil {
		return "", fmt.Errorf("open Agent workspace: %w", err)
	}
	if !info.IsDir() {
		return "", fmt.Errorf("Agent workspace is not a directory: %s", resolved)
	}
	return filepath.Clean(resolved), nil
}
