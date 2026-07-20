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

func sidecarEnvironment(settings config.AppSettings, workspace string) []string {
	environment := engineEnvironment(settings)
	filtered := environment[:0]
	for _, entry := range environment {
		if !strings.HasPrefix(entry, "HOME=") {
			filtered = append(filtered, entry)
		}
	}
	return append(filtered, "HOME="+workspace)
}

func newSidecarCommand(packagedBridge, sourceBridge string) (*exec.Cmd, error) {
	runtime, err := resolveSidecarRuntime(packagedBridge, sourceBridge)
	if err != nil {
		return nil, err
	}
	workspace, err := sidecarWorkspace()
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
			"--allow-fs-write=" + workspace,
			runtime.bridge,
		}
	}
	command := exec.Command(runtime.node, arguments...)
	command.Dir = workspace
	return command, nil
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
