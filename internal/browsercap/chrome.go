package browsercap

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
)

func findChrome() (string, error) {
	return findChromeWith(runtime.GOOS, os.Getenv, exec.LookPath, regularFile)
}

// FindChrome locates a Chromium-family browser for Browser Use.
func FindChrome() (string, error) {
	return findChrome()
}

type BrowserUseRuntime struct {
	Found    bool   `json:"found"`
	Name     string `json:"name,omitempty"`
	Problem  string `json:"problem,omitempty"`
	NextStep string `json:"nextStep,omitempty"`
}

func BrowserUseRuntimeStatus() BrowserUseRuntime {
	return browserUseRuntimeStatus(runtime.GOOS, findChrome)
}

func browserUseRuntimeStatus(goos string, locate func() (string, error)) BrowserUseRuntime {
	path, err := locate()
	if err != nil {
		return BrowserUseRuntime{
			Problem:  "没有找到 Chrome、Chromium 或 Edge。",
			NextStep: browserUseNextStep(goos),
		}
	}
	return BrowserUseRuntime{
		Found: true,
		Name:  browserUseDisplayName(path),
	}
}

func browserUseDisplayName(path string) string {
	base := strings.ToLower(filepath.Base(path))
	switch {
	case strings.Contains(base, "msedge") || strings.Contains(base, "microsoft-edge"):
		return "Microsoft Edge"
	case strings.Contains(base, "brave"):
		return "Brave"
	case strings.Contains(base, "google-chrome") || base == "chrome" || base == "chrome.exe":
		return "Google Chrome"
	default:
		return "Chromium"
	}
}

func browserUseNextStep(goos string) string {
	switch goos {
	case "darwin":
		return "安装 Google Chrome 或 Microsoft Edge，然后重新检测。"
	case "windows":
		return "安装 Google Chrome 或 Microsoft Edge，然后重新检测。"
	default:
		return "从系统软件源安装 Chromium，然后重新检测。Omarchy 默认已有 Chromium。"
	}
}

func regularFile(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.Mode().IsRegular()
}

func findChromeWith(
	goos string,
	getenv func(string) string,
	lookPath func(string) (string, error),
	exists func(string) bool,
) (string, error) {
	if override := strings.TrimSpace(getenv("MILKSU_CHROME_PATH")); override != "" {
		if exists(override) {
			return override, nil
		}
		return "", fmt.Errorf("MILKSU_CHROME_PATH is not an executable file")
	}
	seen := map[string]bool{}
	for _, candidate := range chromeFixedCandidates(goos, getenv) {
		if candidate == "" || seen[candidate] || !exists(candidate) {
			continue
		}
		seen[candidate] = true
		return candidate, nil
	}
	for _, name := range chromePathNames() {
		path, err := lookPath(name)
		if err != nil || path == "" || seen[path] {
			continue
		}
		seen[path] = true
		return path, nil
	}
	for _, candidate := range chromeDesktopExecutables(getenv, exists) {
		if candidate == "" || seen[candidate] || !exists(candidate) {
			continue
		}
		return candidate, nil
	}
	return "", fmt.Errorf("a Chromium-family browser is required for Managed Browser")
}

func chromePathNames() []string {
	if runtime.GOOS == "windows" {
		return []string{"chrome.exe", "msedge.exe", "brave.exe"}
	}
	return []string{
		"google-chrome-stable",
		"google-chrome",
		"chromium",
		"chromium-browser",
		"microsoft-edge-stable",
		"microsoft-edge",
		"brave-browser",
	}
}

func chromeFixedCandidates(goos string, getenv func(string) string) []string {
	home := strings.TrimSpace(getenv("HOME"))
	switch goos {
	case "darwin":
		return []string{
			"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
			"/Applications/Chromium.app/Contents/MacOS/Chromium",
			"/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
		}
	case "windows":
		programFiles := strings.TrimSpace(getenv("ProgramFiles"))
		programFilesX86 := strings.TrimSpace(getenv("ProgramFiles(x86)"))
		localAppData := strings.TrimSpace(getenv("LOCALAPPDATA"))
		var candidates []string
		for _, root := range []string{programFiles, programFilesX86} {
			if root == "" {
				continue
			}
			candidates = append(candidates,
				filepath.Join(root, "Google", "Chrome", "Application", "chrome.exe"),
				filepath.Join(root, "Microsoft", "Edge", "Application", "msedge.exe"),
			)
		}
		if localAppData != "" {
			candidates = append(candidates,
				filepath.Join(localAppData, "Google", "Chrome", "Application", "chrome.exe"),
			)
		}
		return candidates
	default:
		candidates := []string{
			"/usr/bin/google-chrome-stable",
			"/usr/bin/google-chrome",
			"/usr/bin/chromium",
			"/usr/bin/chromium-browser",
			"/usr/bin/microsoft-edge-stable",
			"/usr/bin/microsoft-edge",
			"/usr/bin/brave-browser",
			"/run/current-system/sw/bin/chromium",
			"/run/current-system/sw/bin/google-chrome-stable",
			"/run/current-system/sw/bin/microsoft-edge",
		}
		if home != "" {
			candidates = append(candidates,
				filepath.Join(home, ".nix-profile", "bin", "chromium"),
				filepath.Join(home, ".nix-profile", "bin", "google-chrome-stable"),
			)
		}
		return candidates
	}
}

func chromeDesktopExecutables(getenv func(string) string, exists func(string) bool) []string {
	var directories []string
	if home := strings.TrimSpace(getenv("HOME")); home != "" {
		dataHome := strings.TrimSpace(getenv("XDG_DATA_HOME"))
		if dataHome == "" {
			dataHome = filepath.Join(home, ".local", "share")
		}
		directories = append(directories, filepath.Join(dataHome, "applications"))
	}
	dataDirs := strings.TrimSpace(getenv("XDG_DATA_DIRS"))
	if dataDirs == "" {
		dataDirs = "/usr/local/share:/usr/share"
	}
	for _, directory := range strings.Split(dataDirs, ":") {
		directory = strings.TrimSpace(directory)
		if directory == "" {
			continue
		}
		directories = append(directories, filepath.Join(directory, "applications"))
	}
	names := []string{
		"google-chrome.desktop",
		"google-chrome-stable.desktop",
		"chromium.desktop",
		"chromium-browser.desktop",
		"org.chromium.Chromium.desktop",
		"microsoft-edge.desktop",
		"microsoft-edge-stable.desktop",
		"brave-browser.desktop",
	}
	var found []string
	for _, directory := range directories {
		for _, name := range names {
			path := filepath.Join(directory, name)
			if !exists(path) {
				continue
			}
			body, err := os.ReadFile(path)
			if err != nil {
				continue
			}
			if executable := desktopExecPath(string(body)); executable != "" {
				found = append(found, executable)
			}
		}
	}
	return found
}

func desktopExecPath(body string) string {
	for _, line := range strings.Split(body, "\n") {
		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, "Exec=") {
			continue
		}
		value := strings.TrimSpace(strings.TrimPrefix(line, "Exec="))
		if value == "" {
			continue
		}
		fields := strings.Fields(value)
		if len(fields) == 0 {
			continue
		}
		executable := strings.Trim(fields[0], `"'`)
		if executable == "" || strings.HasPrefix(executable, "%") {
			continue
		}
		return executable
	}
	return ""
}
