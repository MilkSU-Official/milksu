package engine

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
)

// agentKernelPackages maps the product kernel ids to the sidecar packages whose
// installed versions the runtime picker surfaces.
var agentKernelPackages = map[string]string{
	"pi":  "@earendil-works/pi-coding-agent",
	"dsh": "@deepseek-ai/dsh",
}

// RuntimeVersions reads the installed agent kernel package versions from the
// resolved Sidecar package roots (packaged layout or development tree, same
// candidates the Sidecar runtime uses). A package that is not installed is
// absent from the map; the values are public metadata, never credentials.
func RuntimeVersions() map[string]string {
	roots := sidecarPackageRoots()
	if len(roots) == 0 {
		return nil
	}
	versions := make(map[string]string, len(agentKernelPackages))
	for name, pkg := range agentKernelPackages {
		for _, root := range roots {
			data, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(pkg), "package.json"))
			if err != nil {
				continue
			}
			var document struct {
				Version string `json:"version"`
			}
			if json.Unmarshal(data, &document) != nil {
				continue
			}
			if version := strings.TrimSpace(document.Version); version != "" {
				versions[name] = version
				break
			}
		}
	}
	if len(versions) == 0 {
		return nil
	}
	return versions
}

// sidecarPackageRoots lists candidate node_modules roots in resolution order:
// the explicit override, the packaged runtime beside the executable, then the
// development checkout.
func sidecarPackageRoots() []string {
	var roots []string
	if override := strings.TrimSpace(os.Getenv("MILKSU_SIDECAR_DIR")); override != "" {
		roots = append(roots, filepath.Join(override, "node_modules"))
	}
	if executable, err := os.Executable(); err == nil {
		roots = append(roots, filepath.Join(filepath.Dir(executable), packagedSidecarDirectory, "node_modules"))
	}
	if root, err := findProjectRoot(); err == nil {
		roots = append(roots, filepath.Join(root, "node_modules"))
	}
	return roots
}
