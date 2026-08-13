package securitytools

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"time"
)

const (
	idaSourceRevision = "0b5f7ae4026d3c770b190ca93c0692d1b0ceab22"
	idaMCPVersion     = "2.0.0"
	capaVersion       = "v9.4.0"
)

type detection struct {
	status        Status
	statusLabel   string
	version       string
	problem       string
	action        string
	command       string
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
	if runtime.GOOS != "darwin" || (runtime.GOARCH != "arm64" && runtime.GOARCH != "amd64") {
		return detection{status: StatusUnavailable, statusLabel: "暂不支持", problem: "内置 capa 准备当前支持 macOS arm64/amd64。"}
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
