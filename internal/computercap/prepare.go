package computercap

import (
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/MilkSU-Official/milksu/internal/appdata"
)

const (
	// MissingDriverProblem is shown when the packaged driver is absent. The
	// model may prepare the reviewed MilkSU driver locally; it must not run
	// Cua's public installer or a system-wide daemon.
	MissingDriverProblem = "打包的 Cua Driver 不可用。用户已请求 Computer Use 时，使用 prepare_computer_use_driver 把 MilkSU 审阅过的 Driver 放到本机；不要运行 Cua 官方安装脚本，也不要回退到系统级全局控制。"

	preparedDriverDirName = "computer-use"
	windowsBuildScript    = "scripts/build-windows-cua-driver.mjs"
)

// PrepareOptions controls whether a missing driver may be built from the
// reviewed MilkSU recipe. Start() only copies; the typed model tool may build.
type PrepareOptions struct {
	AllowBuild bool
}

// PrepareResult is the typed outcome of a local driver prepare.
type PrepareResult struct {
	Ready    bool   `json:"ready"`
	Source   string `json:"source,omitempty"`
	Path     string `json:"path,omitempty"`
	Version  string `json:"version"`
	Problem  string `json:"problem,omitempty"`
	Recipe   string `json:"recipe,omitempty"`
	NextStep string `json:"nextStep,omitempty"`
}

func preparedDriverPath(goos string) (string, error) {
	root, err := appdata.Directory()
	if err != nil {
		return "", err
	}
	return filepath.Join(root, preparedDriverDirName, driverExecutableName(goos)), nil
}

func (manager *Manager) preparedDriverCandidate() string {
	path, err := preparedDriverPath(manager.goos)
	if err != nil {
		return ""
	}
	return path
}

var driverCompanionNames = []string{
	"cua-driver-uia.exe",
	"cua_driver_sdk.dll",
	"libgcc_s_seh-1.dll",
	"libwinpthread-1.dll",
	"libstdc++-6.dll",
	"LICENSE.md",
}

func milkSUDriverRecipe(root string) string {
	if runtime.GOOS != "windows" {
		return ""
	}
	return filepath.Join(root, filepath.FromSlash(windowsBuildScript))
}

func findMilkSURepositoryRoot() string {
	workingDirectory, err := os.Getwd()
	if err != nil {
		return ""
	}
	directory := workingDirectory
	for range 8 {
		script := milkSUDriverRecipe(directory)
		patch := filepath.Join(directory, "third_party", "cua-driver")
		if script != "" {
			if _, err := os.Stat(script); err == nil {
				if info, err := os.Stat(patch); err == nil && info.IsDir() {
					return directory
				}
			}
		}
		parent := filepath.Dir(directory)
		if parent == directory {
			break
		}
		directory = parent
	}
	return ""
}

func (manager *Manager) sidecarBuildCandidate() string {
	architecture := runtime.GOARCH
	if architecture == "x86_64" {
		architecture = "amd64"
	}
	workingDirectory, err := os.Getwd()
	if err != nil {
		return ""
	}
	return filepath.Join(
		workingDirectory,
		"build",
		"sidecar",
		manager.goos+"-"+architecture,
		driverExecutableName(manager.goos),
	)
}

func (manager *Manager) sourceBuildRuntimeCandidate() string {
	root := findMilkSURepositoryRoot()
	if root == "" {
		return ""
	}
	return filepath.Join(
		root,
		"build",
		"sidecar-cache",
		"cua-windows-"+DriverVersion,
		"r",
		driverExecutableName(manager.goos),
	)
}

func inspectDriverFile(path string) bool {
	canonical, err := filepath.Abs(path)
	if err != nil {
		return false
	}
	info, err := os.Lstat(canonical)
	if err != nil ||
		info.Mode()&os.ModeSymlink != 0 ||
		!info.Mode().IsRegular() {
		return false
	}
	return true
}

func copyRegularFile(source, destination string) error {
	if err := os.MkdirAll(filepath.Dir(destination), 0o700); err != nil {
		return err
	}
	input, err := os.Open(source)
	if err != nil {
		return err
	}
	defer input.Close()
	output, err := os.OpenFile(destination, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o755)
	if err != nil {
		return err
	}
	if _, err := io.Copy(output, input); err != nil {
		output.Close()
		return err
	}
	if err := output.Close(); err != nil {
		return err
	}
	return os.Chmod(destination, 0o755)
}

func copyDriverBundle(sourceBinary, destinationBinary string) error {
	if err := copyRegularFile(sourceBinary, destinationBinary); err != nil {
		return err
	}
	sourceDir := filepath.Dir(sourceBinary)
	destinationDir := filepath.Dir(destinationBinary)
	for _, name := range driverCompanionNames {
		source := filepath.Join(sourceDir, name)
		if !inspectDriverFile(source) {
			continue
		}
		if err := copyRegularFile(source, filepath.Join(destinationDir, name)); err != nil {
			return err
		}
	}
	return nil
}

func rustcLooksUsable() bool {
	command := exec.Command("rustc", "--version")
	command.Env = os.Environ()
	output, err := command.Output()
	if err != nil {
		return false
	}
	return strings.HasPrefix(strings.TrimSpace(string(output)), "rustc 1.97.")
}

func (manager *Manager) runReviewedWindowsBuild(ctx context.Context, root string) error {
	script := milkSUDriverRecipe(root)
	if script == "" {
		return fmt.Errorf("MilkSU Windows Driver 构建脚本不可用")
	}
	node := "node"
	if sidecar := strings.TrimSpace(os.Getenv("MILKSU_SIDECAR_DIR")); sidecar != "" {
		if candidate := filepath.Join(sidecar, "node.exe"); inspectDriverFile(candidate) {
			node = candidate
		} else if candidate := filepath.Join(sidecar, "node"); inspectDriverFile(candidate) {
			node = candidate
		}
	}
	buildCtx, cancel := context.WithTimeout(ctx, 12*time.Minute)
	defer cancel()
	command := exec.CommandContext(buildCtx, node, script)
	command.Dir = root
	command.Env = append(os.Environ(), "CUA_DRIVER_RS_TELEMETRY_ENABLED=false")
	output, err := command.CombinedOutput()
	if err != nil {
		detail := strings.TrimSpace(string(output))
		if detail == "" {
			detail = err.Error()
		}
		if len(detail) > 2000 {
			detail = detail[len(detail)-2000:]
		}
		return fmt.Errorf("MilkSU 审阅过的 Windows Driver 构建失败：%s", detail)
	}
	return nil
}

func (manager *Manager) prepareCopySources() []string {
	sources := []string{}
	if sidecarDirectory := strings.TrimSpace(os.Getenv("MILKSU_SIDECAR_DIR")); sidecarDirectory != "" {
		sources = append(sources, filepath.Join(sidecarDirectory, driverExecutableName(manager.goos)))
	}
	if executable, err := os.Executable(); err == nil {
		sources = append(
			sources,
			filepath.Join(filepath.Dir(executable), driverExecutableName(manager.goos)),
			filepath.Join(filepath.Dir(executable), "resources", "milksu-sidecar", driverExecutableName(manager.goos)),
			filepath.Join(filepath.Dir(executable), "..", "Resources", "milksu-sidecar", driverExecutableName(manager.goos)),
		)
	}
	if candidate := manager.sidecarBuildCandidate(); candidate != "" {
		sources = append(sources, candidate)
	}
	if candidate := manager.sourceBuildRuntimeCandidate(); candidate != "" {
		sources = append(sources, candidate)
	}
	return sources
}

func (manager *Manager) installPreparedDriver(source string) (string, error) {
	destination, err := preparedDriverPath(manager.goos)
	if err != nil {
		return "", err
	}
	if err := copyDriverBundle(source, destination); err != nil {
		return "", err
	}
	if err := manager.verifyBinaryLocked(destination); err != nil {
		return "", err
	}
	manager.binaryPath = destination
	return destination, nil
}

// Prepare places the reviewed MilkSU Cua Driver on the local lookup path.
// It never runs Cua's public installer and never starts a system-wide daemon.
func (manager *Manager) Prepare(ctx context.Context, options PrepareOptions) (PrepareResult, error) {
	if manager.goos == "linux" {
		if manager.linuxPortal() {
			return PrepareResult{
				Ready:    true,
				Source:   "xdg-desktop-portal",
				Version:  DriverVersion,
				NextStep: "启动 Computer Use 时，GNOME 会弹出桌面共享授权。",
			}, nil
		}
		problem := linuxUnavailableProblem(manager.linuxEnv)
		if problem == "" {
			problem = linuxComputerUseProblem
		}
		return PrepareResult{
			Version:  DriverVersion,
			Problem:  problem,
			NextStep: "在 GNOME Wayland 上使用系统桌面共享；Hyprland 仍不可用。",
		}, fmt.Errorf("%s", problem)
	}
	if manager.goos != "darwin" && manager.goos != "windows" {
		return PrepareResult{
			Version:  DriverVersion,
			Problem:  linuxComputerUseProblem,
			NextStep: "在 macOS、Windows 或 GNOME Wayland 上使用 Computer Use。",
		}, fmt.Errorf("%s", linuxComputerUseProblem)
	}
	manager.mu.Lock()
	if path, err := manager.resolveBinaryLocked(); err == nil {
		result := PrepareResult{
			Ready:   true,
			Source:  "already",
			Path:    path,
			Version: DriverVersion,
		}
		manager.mu.Unlock()
		return result, nil
	}
	manager.mu.Unlock()

	for _, source := range manager.prepareCopySources() {
		if !inspectDriverFile(source) {
			continue
		}
		manager.mu.Lock()
		path, err := manager.installPreparedDriver(source)
		manager.mu.Unlock()
		if err != nil {
			continue
		}
		return PrepareResult{
			Ready:   true,
			Source:  "copied",
			Path:    path,
			Version: DriverVersion,
		}, nil
	}

	root := findMilkSURepositoryRoot()
	recipe := ""
	if root != "" {
		recipe = milkSUDriverRecipe(root)
	}
	if !options.AllowBuild || manager.goos != "windows" || recipe == "" {
		next := "请重装带 Sidecar 的 MilkSU，让安装包自带审阅过的 Cua Driver。"
		if recipe != "" {
			next = "在 MilkSU 仓库里运行 node scripts/build-windows-cua-driver.mjs，再重试 prepare_computer_use_driver。不要运行 Cua 官方 install.ps1。"
		}
		return PrepareResult{
			Version:  DriverVersion,
			Problem:  MissingDriverProblem,
			Recipe:   recipe,
			NextStep: next,
		}, fmt.Errorf("%s", MissingDriverProblem)
	}
	if !rustcLooksUsable() {
		return PrepareResult{
			Version:  DriverVersion,
			Problem:  MissingDriverProblem,
			Recipe:   recipe,
			NextStep: "本机缺少 rustc 1.97。先安装该工具链，再调用 prepare_computer_use_driver。不要运行 Cua 官方安装脚本。",
		}, fmt.Errorf("本机缺少 rustc 1.97，无法构建 MilkSU 审阅过的 Windows Driver")
	}
	if err := manager.runReviewedWindowsBuild(ctx, root); err != nil {
		return PrepareResult{
			Version:  DriverVersion,
			Problem:  err.Error(),
			Recipe:   recipe,
			NextStep: "根据构建错误补齐 Visual Studio C++ 或 MinGW 后重试 prepare_computer_use_driver。不要运行 Cua 官方安装脚本。",
		}, err
	}
	source := manager.sourceBuildRuntimeCandidate()
	if !inspectDriverFile(source) {
		source = manager.sidecarBuildCandidate()
	}
	if !inspectDriverFile(source) {
		return PrepareResult{
			Version:  DriverVersion,
			Problem:  MissingDriverProblem,
			Recipe:   recipe,
			NextStep: "构建完成但未找到 cua-driver.exe。检查 build/sidecar-cache 后重试。",
		}, fmt.Errorf("reviewed Windows Driver build did not produce a binary")
	}
	manager.mu.Lock()
	path, err := manager.installPreparedDriver(source)
	manager.mu.Unlock()
	if err != nil {
		return PrepareResult{
			Version:  DriverVersion,
			Problem:  err.Error(),
			Recipe:   recipe,
			NextStep: "构建产物无法写入本机 Driver 目录。检查用户配置目录权限后重试。",
		}, err
	}
	return PrepareResult{
		Ready:   true,
		Source:  "built",
		Path:    path,
		Version: DriverVersion,
	}, nil
}
