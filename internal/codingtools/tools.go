package codingtools

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/MilkSU-Official/milksu/internal/appdata"
)

const (
	SkillGhidraRPC    = "ghidra-rpc"
	SkillJADX         = "jadx"
	ghidraRPCRevision = "1743305487b1de754fb750486dd468ea4d3c4141"
	ghidraRPCSource   = "git+https://github.com/cellebrite-labs/ghidra-rpc.git@" + ghidraRPCRevision
	statusFound       = "found"
	statusMissing     = "missing"
	statusNeedsSetup  = "needs_setup"
	statusConfiguring = "configuring"
	statusFailed      = "failed"
)

type SkillSnapshot struct {
	Name       string `json:"name"`
	Status     string `json:"status"`
	Version    string `json:"version,omitempty"`
	Problem    string `json:"problem,omitempty"`
	CanPrepare bool   `json:"canPrepare"`
	Preparing  bool   `json:"preparing"`
}

type SetupStep struct {
	ID     string `json:"id"`
	Label  string `json:"label"`
	Status string `json:"status"`
	Detail string `json:"detail,omitempty"`
}

type SetupSnapshot struct {
	ToolID      string      `json:"toolId"`
	State       string      `json:"state"`
	Percent     int         `json:"percent"`
	Summary     string      `json:"summary"`
	Steps       []SetupStep `json:"steps"`
	Error       string      `json:"error,omitempty"`
	StartedAt   time.Time   `json:"startedAt"`
	CompletedAt *time.Time  `json:"completedAt,omitempty"`
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

type Service struct {
	root  string
	probe commandProbe
	emit  func(SetupSnapshot)

	mu     sync.RWMutex
	setups map[string]SetupSnapshot
}

func NewService(dataDirectory string, emit func(SetupSnapshot)) *Service {
	return &Service{
		root:   filepath.Join(dataDirectory, "coding-tools"),
		probe:  systemProbe{},
		emit:   emit,
		setups: make(map[string]SetupSnapshot),
	}
}

func OptionalSkillNames() []string {
	return []string{SkillGhidraRPC, SkillJADX}
}

func IsOptionalSkill(name string) bool {
	switch strings.TrimSpace(name) {
	case SkillGhidraRPC, SkillJADX:
		return true
	default:
		return false
	}
}

func (s *Service) List(ctx context.Context) []SkillSnapshot {
	return []SkillSnapshot{
		s.snapshot(ctx, SkillGhidraRPC),
		s.snapshot(ctx, SkillJADX),
	}
}

func (s *Service) Check(ctx context.Context, name string) (SkillSnapshot, error) {
	if !IsOptionalSkill(name) {
		return SkillSnapshot{}, fmt.Errorf("unknown coding skill %q", name)
	}
	return s.snapshot(ctx, name), nil
}

func (s *Service) SetupStatus(name string) (SetupSnapshot, error) {
	if !IsOptionalSkill(name) {
		return SetupSnapshot{}, fmt.Errorf("unknown coding skill %q", name)
	}
	if setup, ok := s.setup(name); ok {
		return setup, nil
	}
	return SetupSnapshot{ToolID: name, State: "idle"}, nil
}

func (s *Service) StartSetup(ctx context.Context, name string) (SetupSnapshot, error) {
	if name != SkillGhidraRPC {
		return SetupSnapshot{}, fmt.Errorf("skill %q has no prepare step", name)
	}
	if setup, ok := s.setup(name); ok && setup.State == "running" {
		return setup, nil
	}
	snapshot := SetupSnapshot{
		ToolID:    name,
		State:     "running",
		Percent:   0,
		Summary:   "正在准备 ghidra-rpc",
		StartedAt: time.Now().UTC(),
		Steps: []SetupStep{
			{ID: "detect", Label: "检测 Ghidra、Java 与 uv", Status: "pending"},
			{ID: "install", Label: "安装固定版本 ghidra-rpc", Status: "pending"},
			{ID: "verify", Label: "运行健康检查", Status: "pending"},
		},
	}
	s.setSetup(snapshot)
	go s.runGhidraSetup(context.WithoutCancel(ctx))
	return snapshot, nil
}

func (s *Service) snapshot(ctx context.Context, name string) SkillSnapshot {
	if setup, ok := s.setup(name); ok && setup.State == "running" {
		return SkillSnapshot{Name: name, Status: statusConfiguring, Preparing: true, CanPrepare: name == SkillGhidraRPC}
	}
	switch name {
	case SkillGhidraRPC:
		return s.detectGhidra(ctx)
	case SkillJADX:
		return s.detectJADX(ctx)
	default:
		return SkillSnapshot{Name: name, Status: statusMissing}
	}
}

func (s *Service) detectJADX(ctx context.Context) SkillSnapshot {
	for _, name := range []string{"jadx", "jadx-gui"} {
		command, err := s.probe.LookPath(name)
		if err != nil {
			continue
		}
		version, versionErr := s.probe.Output(ctx, command, "--version")
		if versionErr != nil || version == "" {
			version = "jadx"
		}
		return SkillSnapshot{Name: SkillJADX, Status: statusFound, Version: firstLine(version)}
	}
	return SkillSnapshot{Name: SkillJADX, Status: statusMissing, Problem: "未在 PATH 中找到 jadx"}
}

func (s *Service) detectGhidra(ctx context.Context) SkillSnapshot {
	if command := s.managedGhidraRPC(); regularExecutable(command) {
		version, err := s.probe.Output(ctx, command, "--help")
		if err != nil || version == "" {
			version = "ghidra-rpc"
		}
		return SkillSnapshot{
			Name: SkillGhidraRPC, Status: statusFound, Version: firstLine(version), CanPrepare: true,
		}
	}
	if command, err := s.probe.LookPath("ghidra-rpc"); err == nil {
		version, versionErr := s.probe.Output(ctx, command, "--help")
		if versionErr != nil || version == "" {
			version = "ghidra-rpc"
		}
		return SkillSnapshot{
			Name: SkillGhidraRPC, Status: statusFound, Version: firstLine(version), CanPrepare: true,
		}
	}
	ghidra := findGhidraInstall()
	java := findJava(s.probe)
	_, uvErr := s.probe.LookPath("uv")
	if ghidra != "" && java != "" && uvErr == nil {
		return SkillSnapshot{
			Name: SkillGhidraRPC, Status: statusNeedsSetup, CanPrepare: true,
			Problem: "已找到 Ghidra，尚未准备 ghidra-rpc",
		}
	}
	problem := "未找到 Ghidra"
	if ghidra != "" && java == "" {
		problem = "已找到 Ghidra，未找到 Java 17+"
	} else if ghidra != "" && uvErr != nil {
		problem = "已找到 Ghidra，准备 ghidra-rpc 还需要 uv"
	}
	return SkillSnapshot{Name: SkillGhidraRPC, Status: statusMissing, Problem: problem, CanPrepare: false}
}

func (s *Service) runGhidraSetup(ctx context.Context) {
	err := s.setupGhidra(ctx)
	if err == nil {
		return
	}
	setup, _ := s.setup(SkillGhidraRPC)
	setup.State = statusFailed
	setup.Error = err.Error()
	setup.Summary = "配置未完成"
	for index := range setup.Steps {
		if setup.Steps[index].Status == "running" {
			setup.Steps[index].Status = "failed"
			setup.Steps[index].Detail = err.Error()
		}
	}
	now := time.Now().UTC()
	setup.CompletedAt = &now
	s.setSetup(setup)
}

func (s *Service) setupGhidra(ctx context.Context) error {
	ghidra := findGhidraInstall()
	if ghidra == "" {
		return fmt.Errorf("未检测到 Ghidra 安装目录")
	}
	if findJava(s.probe) == "" {
		return fmt.Errorf("未检测到 Java")
	}
	uv, err := s.probe.LookPath("uv")
	if err != nil {
		return fmt.Errorf("需要先安装 uv")
	}
	s.updateStep(SkillGhidraRPC, "detect", "completed", 20, "已检测 Ghidra、Java 与 uv")

	root := filepath.Join(s.root, SkillGhidraRPC, ghidraRPCRevision)
	venv := filepath.Join(root, "venv")
	if err := os.MkdirAll(root, 0o700); err != nil {
		return fmt.Errorf("创建 ghidra-rpc 目录: %w", err)
	}
	s.updateStep(SkillGhidraRPC, "install", "running", 40, "正在安装固定版本 ghidra-rpc")
	if _, err := runSetupCommand(ctx, 4*time.Minute, uv, "venv", venv, "--python", "3.11"); err != nil {
		return fmt.Errorf("创建 ghidra-rpc Python 环境: %w", err)
	}
	python := venvPython(venv)
	if _, err := runSetupCommand(ctx, 8*time.Minute, uv, "pip", "install", "--python", python, ghidraRPCSource); err != nil {
		return fmt.Errorf("安装固定版本 ghidra-rpc: %w", err)
	}
	s.updateStep(SkillGhidraRPC, "install", "completed", 80, "固定版本 ghidra-rpc 已安装")

	command := venvCommand(venv, "ghidra-rpc")
	s.updateStep(SkillGhidraRPC, "verify", "running", 90, "正在检查 ghidra-rpc")
	if _, err := runSetupCommand(ctx, 30*time.Second, command, "--help"); err != nil {
		return fmt.Errorf("ghidra-rpc 健康检查: %w", err)
	}
	now := time.Now().UTC()
	s.setSetup(SetupSnapshot{
		ToolID: SkillGhidraRPC, State: "completed", Percent: 100,
		Summary: "ghidra-rpc 已准备", Steps: []SetupStep{
			{ID: "detect", Label: "检测 Ghidra、Java 与 uv", Status: "completed"},
			{ID: "install", Label: "安装固定版本 ghidra-rpc", Status: "completed"},
			{ID: "verify", Label: "运行健康检查", Status: "completed"},
		},
		StartedAt: now, CompletedAt: &now,
	})
	return nil
}

func (s *Service) managedGhidraRPC() string {
	return venvCommand(filepath.Join(s.root, SkillGhidraRPC, ghidraRPCRevision, "venv"), "ghidra-rpc")
}

func (s *Service) SidecarEnvironment() []string {
	var environment []string
	if command := s.managedGhidraRPC(); regularExecutable(command) {
		environment = appendPATH(environment, filepath.Dir(command))
	}
	if install := findGhidraInstall(); install != "" {
		environment = append(environment, "GHIDRA_INSTALL_DIR="+install)
	}
	if state := ghidraRPCStateDir(); state != "" {
		environment = append(environment, "GHIDRA_RPC_STATE_DIR="+state)
	}
	return environment
}

func SidecarEnvironment(dataDirectory string) []string {
	return NewService(dataDirectory, nil).SidecarEnvironment()
}

func ghidraRPCStateDir() string {
	directory, err := appdata.Directory()
	if err != nil {
		return ""
	}
	path := filepath.Join(directory, "coding-tools", "ghidra-rpc-state")
	if err := os.MkdirAll(path, 0o700); err != nil {
		return ""
	}
	return path
}

func findGhidraInstall() string {
	if value := strings.TrimSpace(os.Getenv("GHIDRA_INSTALL_DIR")); value != "" {
		if isGhidraInstall(value) {
			return filepath.Clean(value)
		}
	}
	for _, candidate := range ghidraInstallCandidates() {
		if isGhidraInstall(candidate) {
			return candidate
		}
	}
	if command, err := exec.LookPath("analyzeHeadless"); err == nil {
		return ghidraRootFromHeadless(command)
	}
	if command, err := exec.LookPath("ghidraRun"); err == nil {
		return filepath.Dir(command)
	}
	return ""
}

func ghidraInstallCandidates() []string {
	var candidates []string
	switch runtime.GOOS {
	case "darwin":
		matches, _ := filepath.Glob("/Applications/ghidra*")
		candidates = append(candidates, matches...)
		matches, _ = filepath.Glob("/Applications/Ghidra*")
		candidates = append(candidates, matches...)
		if home, err := os.UserHomeDir(); err == nil {
			matches, _ = filepath.Glob(filepath.Join(home, "Applications", "ghidra*"))
			candidates = append(candidates, matches...)
		}
	case "windows":
		for _, root := range windowsProgramRoots() {
			matches, _ := filepath.Glob(filepath.Join(root, "ghidra*"))
			candidates = append(candidates, matches...)
			matches, _ = filepath.Glob(filepath.Join(root, "Ghidra*"))
			candidates = append(candidates, matches...)
		}
	default:
		candidates = append(candidates, "/opt/ghidra", "/usr/share/ghidra")
		matches, _ := filepath.Glob("/opt/ghidra*")
		candidates = append(candidates, matches...)
	}
	sort.Sort(sort.Reverse(sort.StringSlice(candidates)))
	return candidates
}

func windowsProgramRoots() []string {
	var roots []string
	for _, key := range []string{"ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"} {
		if value := strings.TrimSpace(os.Getenv(key)); value != "" {
			roots = append(roots, value)
		}
	}
	return roots
}

func isGhidraInstall(path string) bool {
	path = filepath.Clean(strings.TrimSpace(path))
	if path == "" {
		return false
	}
	for _, relative := range []string{
		"support/analyzeHeadless",
		"support/analyzeHeadless.bat",
		"analyzeHeadless",
		"analyzeHeadless.bat",
		"ghidraRun",
		"ghidraRun.bat",
	} {
		if regularFile(filepath.Join(path, relative)) {
			return true
		}
	}
	info, err := os.Stat(path)
	if err != nil || !info.IsDir() {
		return false
	}
	if runtime.GOOS == "darwin" && strings.HasSuffix(path, ".app") {
		return isGhidraInstall(filepath.Join(path, "Contents", "Resources"))
	}
	return false
}

func ghidraRootFromHeadless(command string) string {
	dir := filepath.Dir(command)
	if filepath.Base(dir) == "support" {
		return filepath.Dir(dir)
	}
	return dir
}

func findJava(probe commandProbe) string {
	if command, err := probe.LookPath("java"); err == nil {
		return command
	}
	if home := strings.TrimSpace(os.Getenv("JAVA_HOME")); home != "" {
		command := filepath.Join(home, "bin", "java")
		if runtime.GOOS == "windows" {
			command += ".exe"
		}
		if regularExecutable(command) {
			return command
		}
	}
	return ""
}

func venvPython(venv string) string {
	if runtime.GOOS == "windows" {
		return filepath.Join(venv, "Scripts", "python.exe")
	}
	return filepath.Join(venv, "bin", "python")
}

func venvCommand(venv, name string) string {
	if runtime.GOOS == "windows" {
		return filepath.Join(venv, "Scripts", name+".exe")
	}
	return filepath.Join(venv, "bin", name)
}

func appendPATH(environment []string, directory string) []string {
	directory = strings.TrimSpace(directory)
	if directory == "" {
		return environment
	}
	current := os.Getenv("PATH")
	if current == "" {
		return append(environment, "PATH="+directory)
	}
	return append(environment, "PATH="+directory+string(os.PathListSeparator)+current)
}

func (s *Service) setup(id string) (SetupSnapshot, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	setup, ok := s.setups[id]
	return setup, ok
}

func (s *Service) setSetup(setup SetupSnapshot) {
	s.mu.Lock()
	s.setups[setup.ToolID] = setup
	emit := s.emit
	s.mu.Unlock()
	if emit != nil {
		emit(setup)
	}
}

func (s *Service) updateStep(id, step, status string, percent int, detail string) {
	setup, ok := s.setup(id)
	if !ok {
		return
	}
	setup.Percent = percent
	setup.Summary = detail
	for index := range setup.Steps {
		if setup.Steps[index].ID == step {
			setup.Steps[index].Status = status
			setup.Steps[index].Detail = detail
		}
	}
	s.setSetup(setup)
}

func runSetupCommand(ctx context.Context, timeout time.Duration, command string, args ...string) (string, error) {
	commandContext, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	cmd := exec.CommandContext(commandContext, command, args...)
	output, err := cmd.CombinedOutput()
	if err != nil {
		detail := strings.TrimSpace(string(output))
		if len(detail) > 800 {
			detail = detail[len(detail)-800:]
		}
		if detail != "" {
			return detail, fmt.Errorf("%w: %s", err, detail)
		}
		return "", err
	}
	return strings.TrimSpace(string(output)), nil
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
	if err != nil || !info.Mode().IsRegular() {
		return false
	}
	if runtime.GOOS == "windows" {
		return true
	}
	return info.Mode().Perm()&0o111 != 0
}
