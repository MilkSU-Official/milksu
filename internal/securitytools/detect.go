package securitytools

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"time"
)

const (
	idaSourceRevision = "0b5f7ae4026d3c770b190ca93c0692d1b0ceab22"
	idaMCPVersion     = "2.0.0"
	capaVersion       = "v9.4.0"
	reaVersion        = "6.1.0"
	reaPackage        = "rea-agents"
)

type detection struct {
	status        Status
	statusLabel   string
	version       string
	problem       string
	action        string
	command       string
	args          []string
	profilePath   string
	idaPath       string
	userIDAPath   string
	setupPossible bool
}

type commandProbe interface {
	LookPath(name string) (string, error)
	Output(ctx context.Context, command string, args ...string) (string, error)
}

type systemProbe struct{}

func (systemProbe) LookPath(name string) (string, error) { return exec.LookPath(name) }

func (systemProbe) Output(ctx context.Context, command string, args ...string) (string, error) {
	commandContext, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	output, err := exec.CommandContext(commandContext, command, args...).CombinedOutput()
	return strings.TrimSpace(string(output)), err
}

func (s *Service) detect(ctx context.Context, id string) detection {
	switch id {
	case ToolIDA:
		return s.detectIDA(ctx)
	case ToolCapa:
		return s.detectCapa(ctx)
	case ToolCodeQL:
		return s.detectCommand(ctx, "codeql", []string{"version", "--format=terse"}, "已检测 CLI", "安装后可由 Coding 使用")
	case ToolBurp:
		return s.detectBurp(ctx)
	case ToolShannon:
		return s.detectShannon(ctx)
	case ToolRea:
		return s.detectRea(ctx)
	default:
		return detection{status: StatusUnavailable, statusLabel: "不可用", problem: "未知工具"}
	}
}

func (s *Service) detectIDA(ctx context.Context) detection {
	idaPath := findIDAApplication()
	if idaPath == "" {
		return detection{
			status: StatusMissingApp, statusLabel: "需要 IDA Pro", action: "安装 IDA Pro",
			problem: "未在 /Applications 中检测到支持 idalib 的 IDA Pro。",
		}
	}
	idaVersion := applicationVersion(ctx, s.probe, idaPath)
	command := filepath.Join(s.root, ToolIDA, idaSourceRevision, "venv", "bin", "idalib-mcp")
	profile := filepath.Join(s.root, ToolIDA, idaSourceRevision, "readonly-profile.txt")
	userIDAPath := ""
	if home, err := os.UserHomeDir(); err == nil {
		userIDAPath = filepath.Join(home, ".idapro")
	}
	if regularExecutable(command) && regularFile(profile) {
		return detection{
			status: StatusReady, statusLabel: "可用", version: idaVersion,
			command: command, profilePath: profile, idaPath: idaPath,
			userIDAPath: userIDAPath, setupPossible: true,
		}
	}
	if _, err := s.probe.LookPath("uv"); err != nil {
		return detection{
			status: StatusNeedsSetup, statusLabel: "需要 uv", version: idaVersion,
			action: "在 Coding 中配置", idaPath: idaPath,
			problem: "IDA Pro 已安装；准备 idalib MCP 前还需要 uv。",
		}
	}
	return detection{
		status: StatusNeedsSetup, statusLabel: "可准备", version: idaVersion,
		action: "准备 IDA MCP", idaPath: idaPath, userIDAPath: userIDAPath,
		setupPossible: true,
	}
}

func (s *Service) detectCapa(ctx context.Context) detection {
	return s.detectCapaFor(ctx, runtime.GOOS, runtime.GOARCH)
}

func (s *Service) detectCapaFor(ctx context.Context, goos, goarch string) detection {
	if goos != "darwin" {
		return detection{status: StatusUnavailable, statusLabel: "暂不支持", problem: "capa 当前仅支持 macOS arm64/amd64。"}
	}
	if goarch != "arm64" && goarch != "amd64" {
		return detection{status: StatusUnavailable, statusLabel: "暂不支持", problem: "capa 当前仅支持 macOS arm64/amd64。"}
	}
	managed := filepath.Join(s.root, ToolCapa, capaVersion, "capa")
	if regularExecutable(managed) {
		return detection{status: StatusReady, statusLabel: "可用", version: capaVersion, command: managed, setupPossible: true}
	}
	if command, err := s.probe.LookPath("capa"); err == nil {
		version, versionErr := s.probe.Output(ctx, command, "--version")
		if versionErr != nil || version == "" {
			version = "本机 CLI"
		}
		return detection{status: StatusReady, statusLabel: "可用", version: version, command: command, setupPossible: true}
	}
	return detection{status: StatusNeedsSetup, statusLabel: "可直接准备", version: capaVersion, action: "准备 capa", setupPossible: true}
}

func (s *Service) detectCommand(ctx context.Context, name string, args []string, readyLabel, action string) detection {
	command, err := s.probe.LookPath(name)
	if err != nil {
		return detection{status: StatusNeedsSetup, statusLabel: "未配置", action: action, problem: fmt.Sprintf("未在 PATH 中检测到 %s。", name)}
	}
	version, versionErr := s.probe.Output(ctx, command, args...)
	if versionErr != nil || version == "" {
		version = "本机 CLI"
	}
	return detection{status: StatusDetected, statusLabel: readyLabel, version: firstLine(version), command: command}
}

func (s *Service) detectBurp(ctx context.Context) detection {
	candidates := []string{
		"/Applications/Burp Suite Professional.app",
		"/Applications/Burp Suite Community Edition.app",
	}
	for _, candidate := range candidates {
		if info, err := os.Stat(candidate); err == nil && info.IsDir() {
			return detection{
				status: StatusDetected, statusLabel: "检测到软件",
				version: applicationVersion(ctx, s.probe, candidate),
				problem: "Burp 已安装；专用读取 Adapter 尚未进入本批生产链。",
			}
		}
	}
	return detection{status: StatusMissingApp, statusLabel: "未安装", action: "安装 Burp Suite", problem: "未在 /Applications 中检测到 Burp Suite。"}
}

func (s *Service) detectShannon(ctx context.Context) detection {
	docker, err := s.probe.LookPath("docker")
	if err != nil {
		return detection{status: StatusNeedsSetup, statusLabel: "需要 Docker", problem: "未检测到 Docker CLI。"}
	}
	version, versionErr := s.probe.Output(ctx, docker, "version", "--format", "{{.Server.Version}}")
	if versionErr != nil || version == "" {
		return detection{status: StatusNeedsSetup, statusLabel: "Docker 未运行", problem: "检测到 Docker CLI，但 Docker Engine 当前不可用。"}
	}
	return detection{
		status: StatusDetected, statusLabel: "前提已就绪", version: "Docker " + firstLine(version),
		problem: "Docker 可用；Shannon Worker 与任务回执 Adapter 尚未进入本批生产链。",
	}
}

// reaInstallDir is the pinned, version-scoped install location for the
// rea-agents npm package. The layout mirrors capa: one directory per reviewed
// version under the security-tools service root.
func reaInstallDir(root string) string {
	return filepath.Join(root, ToolRea, reaVersion)
}

func reaEntryScript(root string) string {
	return filepath.Join(reaInstallDir(root), "node_modules", reaPackage, "scripts", "rea.mjs")
}

// nodeMeetsReaEngines implements the rea-agents engines constraint
// (^22.19.0 || ^24.11.0 || >=26.0.0) from its package.json.
func nodeMeetsReaEngines(major, minor int) bool {
	if major == 22 {
		return minor >= 19
	}
	if major == 24 {
		return minor >= 11
	}
	return major >= 26
}

func parseNodeVersion(output string) (major, minor int, ok bool) {
	value := strings.TrimPrefix(strings.TrimSpace(firstLine(output)), "v")
	parts := strings.SplitN(value, ".", 3)
	if len(parts) < 2 {
		return 0, 0, false
	}
	major, errMajor := strconv.Atoi(parts[0])
	minor, errMinor := strconv.Atoi(parts[1])
	if errMajor != nil || errMinor != nil {
		return 0, 0, false
	}
	return major, minor, true
}

func (s *Service) detectRea(ctx context.Context) detection {
	nodePath, err := s.probe.LookPath("node")
	if err != nil {
		return detection{
			status: StatusMissingApp, statusLabel: "需要 Node.js",
			problem: "未检测到 Node.js。REA 需要 Node 22.19+、24.11+ 或 26+，请先安装 Node.js。",
			action:  "安装 Node.js",
		}
	}
	versionOutput, versionErr := s.probe.Output(ctx, nodePath, "--version")
	major, minor, ok := parseNodeVersion(versionOutput)
	if versionErr != nil || !ok {
		return detection{
			status: StatusMissingApp, statusLabel: "Node 版本无法确认",
			problem: "无法读取 Node 版本；REA 需要 Node 22.19+、24.11+ 或 26+。",
			action:  "检查 Node.js 安装",
		}
	}
	if !nodeMeetsReaEngines(major, minor) {
		return detection{
			status: StatusMissingApp, statusLabel: "需要更高版本 Node.js",
			problem: fmt.Sprintf(
				"当前 Node %d.%d 不满足 REA %s 的运行要求（22.19+、24.11+ 或 26+）。",
				major, minor, reaVersion,
			),
			action: "升级 Node.js",
		}
	}
	entry := reaEntryScript(s.root)
	if regularFile(entry) {
		return detection{
			status: StatusReady, statusLabel: "可用", version: reaVersion,
			command: nodePath, args: []string{entry, "mcp"},
			setupPossible: true,
		}
	}
	if _, err := s.probe.LookPath("npm"); err != nil {
		return detection{
			status: StatusNeedsSetup, statusLabel: "需要 npm",
			problem: fmt.Sprintf("Node %d.%d 已就绪；准备 REA 还需要随 Node 附带的 npm。", major, minor),
		}
	}
	return detection{
		status: StatusNeedsSetup, statusLabel: "可准备", version: reaVersion,
		action: "准备 REA", setupPossible: true,
	}
}

func findIDAApplication() string {
	matches, _ := filepath.Glob("/Applications/IDA Professional*.app")
	sort.Sort(sort.Reverse(sort.StringSlice(matches)))
	for _, candidate := range matches {
		script := filepath.Join(candidate, "Contents", "MacOS", "idalib", "python", "py-activate-idalib.py")
		if regularFile(script) {
			return candidate
		}
	}
	return ""
}

func applicationVersion(ctx context.Context, probe commandProbe, application string) string {
	infoPath := filepath.Join(application, "Contents", "Info.plist")
	value, err := probe.Output(ctx, "/usr/bin/plutil", "-extract", "CFBundleShortVersionString", "raw", "-o", "-", infoPath)
	if err != nil || value == "" {
		return "已安装"
	}
	return firstLine(value)
}

func firstLine(value string) string {
	if line, _, found := strings.Cut(strings.TrimSpace(value), "\n"); found {
		return strings.TrimSpace(line)
	}
	return strings.TrimSpace(value)
}

func regularFile(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.Mode().IsRegular()
}

func regularExecutable(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.Mode().IsRegular() && info.Mode().Perm()&0o111 != 0
}
