package securitytools

import (
	"archive/zip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

const idaReadonlyProfile = `# MilkSU reviewed read-only profile for ida-pro-mcp
server_health
list_funcs
list_globals
imports
imports_query
lookup_funcs
func_query
entity_query
int_convert
find_regex
decompile
disasm
func_profile
analyze_batch
xrefs_to
xref_query
xrefs_to_field
callees
basic_blocks
find_bytes
find
insn_query
export_funcs
callgraph
analyze_function
analyze_component
trace_data_flow
read_struct
type_query
get_bytes
get_int
get_string
get_global_value
stack_frame
`

func initialSetup(id string) SetupSnapshot {
	steps := []SetupStep{}
	summary := "正在准备工具"
	switch id {
	case ToolIDA:
		summary = "正在准备 IDA Pro MCP"
		steps = []SetupStep{
			{ID: "detect", Label: "检测 IDA Pro 与 uv", Status: "pending"},
			{ID: "activate", Label: "激活 idalib", Status: "pending"},
			{ID: "install", Label: "安装固定版本 MCP", Status: "pending"},
			{ID: "verify", Label: "运行健康检查", Status: "pending"},
		}
	case ToolCapa:
		summary = "正在准备 capa"
		steps = []SetupStep{
			{ID: "detect", Label: "检测系统架构", Status: "pending"},
			{ID: "download", Label: "下载官方固定版本", Status: "pending"},
			{ID: "verify", Label: "校验并运行首次检查", Status: "pending"},
		}
	}
	return SetupSnapshot{
		ToolID: id, State: "running", Percent: 0,
		Summary: summary, Steps: steps, StartedAt: time.Now().UTC(),
	}
}

func (s *Service) runSetup(ctx context.Context, id string) {
	var err error
	switch id {
	case ToolIDA:
		err = s.setupIDA(ctx)
	case ToolCapa:
		err = s.setupCapa(ctx)
	}
	if err != nil {
		setup, _ := s.setup(id)
		setup.State = "failed"
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
}

func (s *Service) setupIDA(ctx context.Context) error {
	detected := s.detectIDA(ctx)
	if detected.idaPath == "" {
		return fmt.Errorf("未检测到支持 idalib 的 IDA Pro")
	}
	uv, err := s.probe.LookPath("uv")
	if err != nil {
		return fmt.Errorf("需要先安装 uv；可使用“在 Coding 中配置”完成")
	}
	s.updateStep(ToolIDA, "detect", "completed", 15, "已检测 IDA Pro 与 uv")

	activate := filepath.Join(detected.idaPath, "Contents", "MacOS", "idalib", "python", "py-activate-idalib.py")
	s.updateStep(ToolIDA, "activate", "running", 25, "正在写入当前用户的 idalib 安装路径")
	if _, err := runSetupCommand(ctx, 2*time.Minute, uv, "run", activate); err != nil {
		return fmt.Errorf("激活 idalib: %w", err)
	}
	s.updateStep(ToolIDA, "activate", "completed", 40, "idalib 已激活")

	root := filepath.Join(s.root, ToolIDA, idaSourceRevision)
	venv := filepath.Join(root, "venv")
	if err := os.MkdirAll(root, 0o700); err != nil {
		return fmt.Errorf("创建 IDA MCP 目录: %w", err)
	}
	profile := filepath.Join(root, "readonly-profile.txt")
	if err := os.WriteFile(profile, []byte(idaReadonlyProfile), 0o600); err != nil {
		return fmt.Errorf("写入 IDA 只读工具配置: %w", err)
	}
	s.updateStep(ToolIDA, "install", "running", 55, "正在安装 ida-pro-mcp 2.0.0")
	if _, err := runSetupCommand(ctx, 4*time.Minute, uv, "venv", venv, "--python", "3.11"); err != nil {
		return fmt.Errorf("创建 IDA MCP Python 环境: %w", err)
	}
	python := filepath.Join(venv, "bin", "python")
	source := "git+https://github.com/mrexodia/ida-pro-mcp.git@" + idaSourceRevision
	if _, err := runSetupCommand(ctx, 8*time.Minute, uv, "pip", "install", "--python", python, source); err != nil {
		return fmt.Errorf("安装固定版本 IDA MCP: %w", err)
	}
	s.updateStep(ToolIDA, "install", "completed", 85, "固定版本 MCP 已安装")

	command := filepath.Join(venv, "bin", "idalib-mcp")
	s.updateStep(ToolIDA, "verify", "running", 90, "正在检查 MCP 启动入口")
	if _, err := runSetupCommand(ctx, 30*time.Second, command, "--help"); err != nil {
		return fmt.Errorf("IDA MCP 健康检查: %w", err)
	}
	s.completeSetup(ToolIDA, "IDA Pro MCP 已可由 Coding 自动调用")
	return nil
}

func (s *Service) setupCapa(ctx context.Context) error {
	asset, checksum, err := capaAsset()
	if err != nil {
		return err
	}
	s.updateStep(ToolCapa, "detect", "completed", 15, runtime.GOOS+"/"+runtime.GOARCH)
	root := filepath.Join(s.root, ToolCapa, capaVersion)
	if err := os.MkdirAll(root, 0o700); err != nil {
		return fmt.Errorf("创建 capa 目录: %w", err)
	}
	temporary, err := os.CreateTemp(root, ".capa-*.zip")
	if err != nil {
		return fmt.Errorf("创建 capa 下载文件: %w", err)
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	s.updateStep(ToolCapa, "download", "running", 30, "正在从 mandiant/capa 下载 "+capaVersion)
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, asset, nil)
	if err != nil {
		temporary.Close()
		return err
	}
	client := &http.Client{Timeout: 5 * time.Minute}
	response, err := client.Do(request)
	if err != nil {
		temporary.Close()
		return fmt.Errorf("下载 capa: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		temporary.Close()
		return fmt.Errorf("下载 capa: HTTP %d", response.StatusCode)
	}
	hash := sha256.New()
	if _, err := io.Copy(io.MultiWriter(temporary, hash), io.LimitReader(response.Body, 128<<20)); err != nil {
		temporary.Close()
		return fmt.Errorf("保存 capa: %w", err)
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	if actual := hex.EncodeToString(hash.Sum(nil)); actual != checksum {
		return fmt.Errorf("capa 下载校验失败")
	}
	s.updateStep(ToolCapa, "download", "completed", 75, "官方发布包校验通过")
	s.updateStep(ToolCapa, "verify", "running", 85, "正在解包并运行版本检查")
	command := filepath.Join(root, "capa")
	if err := extractSingleZipFile(temporaryPath, "capa", command); err != nil {
		return fmt.Errorf("解包 capa: %w", err)
	}
	if err := os.Chmod(command, 0o700); err != nil {
		return err
	}
	if _, err := runSetupCommand(ctx, 30*time.Second, command, "--version"); err != nil {
		return fmt.Errorf("capa 健康检查: %w", err)
	}
	s.completeSetup(ToolCapa, "capa 已可由 Coding 自动调用")
	return nil
}

func capaAsset() (string, string, error) {
	base := "https://github.com/mandiant/capa/releases/download/v9.4.0/"
	switch runtime.GOARCH {
	case "arm64":
		return base + "capa-v9.4.0-macos-arm64.zip", "119964afc348c80fff93ad8830124a0c55630f179906acb796636c0f8d410672", nil
	case "amd64":
		return base + "capa-v9.4.0-macos.zip", "4f45921c756e55dc912ff100ad46427ebb087b88ca6b493f50b015c11ed892e4", nil
	default:
		return "", "", fmt.Errorf("当前系统架构没有已审阅的 capa 发布包")
	}
}

func extractSingleZipFile(archivePath, name, destination string) error {
	archive, err := zip.OpenReader(archivePath)
	if err != nil {
		return err
	}
	defer archive.Close()
	for _, file := range archive.File {
		if file.Name != name || file.FileInfo().IsDir() {
			continue
		}
		reader, err := file.Open()
		if err != nil {
			return err
		}
		defer reader.Close()
		temporary, err := os.CreateTemp(filepath.Dir(destination), ".capa-bin-*")
		if err != nil {
			return err
		}
		temporaryPath := temporary.Name()
		defer os.Remove(temporaryPath)
		if _, err := io.Copy(temporary, io.LimitReader(reader, 96<<20)); err != nil {
			temporary.Close()
			return err
		}
		if err := temporary.Chmod(0o700); err != nil {
			temporary.Close()
			return err
		}
		if err := temporary.Close(); err != nil {
			return err
		}
		return os.Rename(temporaryPath, destination)
	}
	return fmt.Errorf("发布包中没有 capa 可执行文件")
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

func (s *Service) updateStep(toolID, stepID, status string, percent int, detail string) {
	setup, _ := s.setup(toolID)
	for index := range setup.Steps {
		if setup.Steps[index].ID == stepID {
			setup.Steps[index].Status = status
			setup.Steps[index].Detail = detail
		}
	}
	setup.Percent = percent
	s.setSetup(setup)
}

func (s *Service) completeSetup(toolID, summary string) {
	setup, _ := s.setup(toolID)
	for index := range setup.Steps {
		setup.Steps[index].Status = "completed"
	}
	setup.State = "completed"
	setup.Percent = 100
	setup.Summary = summary
	now := time.Now().UTC()
	setup.CompletedAt = &now
	s.setSetup(setup)
}
