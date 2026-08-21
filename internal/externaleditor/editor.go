package externaleditor

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/MilkSU-Official/milksu/internal/codingenv"
)

const DefaultID = "vscode"

// Keep IDs in sync with app/src/lib/externalEditor.ts.
type Editor struct {
	ID            string
	Label         string
	DarwinApps    []string
	WindowsExe    []string
	WindowsDirs   [][]string
	LinuxCommands []string
}

var catalog = []Editor{
	{
		ID:            "vscode",
		Label:         "VS Code",
		DarwinApps:    []string{"Visual Studio Code"},
		WindowsExe:    []string{"Code.exe", "code.cmd", "code"},
		WindowsDirs:   [][]string{{"Programs", "Microsoft VS Code"}},
		LinuxCommands: []string{"code"},
	},
	{
		ID:            "cursor",
		Label:         "Cursor",
		DarwinApps:    []string{"Cursor"},
		WindowsExe:    []string{"Cursor.exe", "cursor.cmd", "cursor"},
		WindowsDirs:   [][]string{{"Programs", "cursor"}, {"Programs", "Cursor"}},
		LinuxCommands: []string{"cursor"},
	},
	{
		ID:            "windsurf",
		Label:         "Windsurf",
		DarwinApps:    []string{"Windsurf"},
		WindowsExe:    []string{"Windsurf.exe", "windsurf.cmd", "windsurf"},
		WindowsDirs:   [][]string{{"Programs", "Windsurf"}},
		LinuxCommands: []string{"windsurf"},
	},
	{
		ID:            "zed",
		Label:         "Zed",
		DarwinApps:    []string{"Zed"},
		WindowsExe:    []string{"Zed.exe", "zed.exe", "zed"},
		WindowsDirs:   [][]string{{"Programs", "Zed"}},
		LinuxCommands: []string{"zed"},
	},
	{
		ID:            "trae",
		Label:         "Trae",
		DarwinApps:    []string{"Trae"},
		WindowsExe:    []string{"Trae.exe", "trae.exe"},
		WindowsDirs:   [][]string{{"Programs", "Trae"}},
		LinuxCommands: []string{"trae"},
	},
	{
		ID:            "vscode-insiders",
		Label:         "VS Code Insiders",
		DarwinApps:    []string{"Visual Studio Code - Insiders"},
		WindowsExe:    []string{"Code - Insiders.exe", "code-insiders.cmd", "code-insiders"},
		WindowsDirs:   [][]string{{"Programs", "Microsoft VS Code Insiders"}},
		LinuxCommands: []string{"code-insiders"},
	},
	{
		ID:            "sublime",
		Label:         "Sublime Text",
		DarwinApps:    []string{"Sublime Text"},
		WindowsExe:    []string{"sublime_text.exe", "subl.exe"},
		WindowsDirs:   [][]string{{"Programs", "Sublime Text"}, {"Programs", "Sublime Text 3"}},
		LinuxCommands: []string{"subl", "sublime_text"},
	},
	{
		ID:            "webstorm",
		Label:         "WebStorm",
		DarwinApps:    []string{"WebStorm"},
		WindowsExe:    []string{"webstorm64.exe", "webstorm.exe"},
		WindowsDirs:   [][]string{{"JetBrains", "WebStorm"}},
		LinuxCommands: []string{"webstorm"},
	},
	{
		ID:            "idea",
		Label:         "IntelliJ IDEA",
		DarwinApps:    []string{"IntelliJ IDEA", "IntelliJ IDEA CE"},
		WindowsExe:    []string{"idea64.exe", "idea.exe"},
		WindowsDirs:   [][]string{{"JetBrains", "IntelliJ IDEA"}},
		LinuxCommands: []string{"idea"},
	},
}

var byID = func() map[string]Editor {
	result := make(map[string]Editor, len(catalog))
	for _, editor := range catalog {
		result[editor.ID] = editor
	}
	return result
}()

func Normalize(id string) string {
	trimmed := strings.ToLower(strings.TrimSpace(id))
	if _, ok := byID[trimmed]; ok {
		return trimmed
	}
	return DefaultID
}

func Lookup(id string) Editor {
	return byID[Normalize(id)]
}

// launch and lookPath are replaced in tests.
var launch = launchProcess
var lookPath = exec.LookPath

func launchProcess(command string, args []string, wait bool) error {
	cmd := exec.Command(command, args...)
	configureLaunch(cmd)
	if wait {
		output, err := cmd.CombinedOutput()
		if err != nil {
			detail := strings.TrimSpace(string(output))
			if detail == "" {
				return err
			}
			return fmt.Errorf("%w: %s", err, detail)
		}
		return nil
	}
	return cmd.Start()
}

func Open(workspace, relativePath, editorID string) error {
	absolute, err := codingenv.ResolveWorkspaceFile(workspace, relativePath)
	if err != nil {
		return err
	}
	target, err := openTarget(absolute)
	if err != nil {
		return err
	}
	editor := Lookup(editorID)
	if err := launchEditor(editor, target); err != nil {
		return fmt.Errorf("找不到 %s", editor.Label)
	}
	return nil
}

func openTarget(absolute string) (string, error) {
	info, err := os.Stat(absolute)
	if err == nil {
		if info.Mode()&os.ModeType != 0 && !info.IsDir() {
			return "", fmt.Errorf("local path is not a file or directory")
		}
		return absolute, nil
	}
	if !os.IsNotExist(err) {
		return "", fmt.Errorf("open workspace file: %w", err)
	}
	parent := filepath.Dir(absolute)
	parentInfo, parentErr := os.Stat(parent)
	if parentErr != nil || !parentInfo.IsDir() {
		return "", fmt.Errorf("workspace file is unavailable")
	}
	return parent, nil
}

func launchEditor(editor Editor, target string) error {
	switch runtime.GOOS {
	case "darwin":
		return launchDarwin(editor, target)
	case "windows":
		return launchWindows(editor, target)
	default:
		return launchUnix(editor, target)
	}
}

func launchDarwin(editor Editor, target string) error {
	var last error
	for _, name := range editor.DarwinApps {
		last = launch("open", []string{"-a", name, target}, true)
		if last == nil {
			return nil
		}
	}
	if last == nil {
		return fmt.Errorf("missing application")
	}
	return last
}

func launchUnix(editor Editor, target string) error {
	var last error
	for _, name := range editor.LinuxCommands {
		resolved, err := lookPath(name)
		if err != nil {
			last = err
			continue
		}
		last = launch(resolved, []string{target}, false)
		if last == nil {
			return nil
		}
	}
	if last == nil {
		return fmt.Errorf("missing application")
	}
	return last
}

func launchWindows(editor Editor, target string) error {
	for _, candidate := range windowsCandidates(editor) {
		if _, err := os.Stat(candidate); err != nil {
			continue
		}
		if err := launch(candidate, []string{target}, false); err == nil {
			return nil
		}
	}
	var last error
	for _, name := range editor.WindowsExe {
		resolved, err := lookPath(name)
		if err != nil {
			last = err
			continue
		}
		last = launch(resolved, []string{target}, false)
		if last == nil {
			return nil
		}
	}
	if last == nil {
		return fmt.Errorf("missing application")
	}
	return last
}

func windowsCandidates(editor Editor) []string {
	roots := []string{
		os.Getenv("LOCALAPPDATA"),
		os.Getenv("ProgramFiles"),
		os.Getenv("ProgramFiles(x86)"),
	}
	var candidates []string
	for _, root := range roots {
		root = strings.TrimSpace(root)
		if root == "" {
			continue
		}
		for _, dir := range editor.WindowsDirs {
			base := filepath.Join(append([]string{root}, dir...)...)
			for _, exe := range editor.WindowsExe {
				if !strings.HasSuffix(strings.ToLower(exe), ".exe") {
					continue
				}
				candidates = append(candidates, filepath.Join(base, exe))
			}
		}
	}
	return candidates
}
