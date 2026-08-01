package codingenv

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"unicode"
	"unicode/utf8"
)

const maxMCPConfigBytes = 1 << 20
const maxMCPServers = 64

type MCPServerSummary struct {
	Name      string `json:"name"`
	Transport string `json:"transport"`
}

type MCPConfigSnapshot struct {
	Workspace  string             `json:"workspace"`
	Configured bool               `json:"configured"`
	Path       string             `json:"path,omitempty"`
	Digest     string             `json:"digest,omitempty"`
	Servers    []MCPServerSummary `json:"servers"`
	Problem    string             `json:"problem,omitempty"`
}

// InspectMCPConfig returns only display-safe server metadata. Command
// arguments, headers, environment values and credentials never cross the
// desktop boundary.
func InspectMCPConfig(workspace string) (MCPConfigSnapshot, error) {
	resolved, err := resolveWorkspace(workspace)
	if err != nil {
		return MCPConfigSnapshot{}, err
	}
	snapshot := MCPConfigSnapshot{
		Workspace: resolved,
		Servers:   []MCPServerSummary{},
	}
	path := filepath.Join(resolved, ".mcp.json")
	info, err := os.Lstat(path)
	if errors.Is(err, os.ErrNotExist) {
		return snapshot, nil
	}
	if err != nil {
		return MCPConfigSnapshot{}, fmt.Errorf("inspect project MCP config: %w", err)
	}
	snapshot.Configured = true
	snapshot.Path = ".mcp.json"
	if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
		snapshot.Problem = ".mcp.json 必须是项目内的普通文件，不能是链接或目录。"
		return snapshot, nil
	}
	if info.Size() <= 0 || info.Size() > maxMCPConfigBytes {
		snapshot.Problem = ".mcp.json 必须在 1 字节到 1 MiB 之间。"
		return snapshot, nil
	}

	file, err := os.Open(path)
	if err != nil {
		return MCPConfigSnapshot{}, fmt.Errorf("open project MCP config: %w", err)
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, maxMCPConfigBytes+1))
	if err != nil {
		return MCPConfigSnapshot{}, fmt.Errorf("read project MCP config: %w", err)
	}
	if len(data) > maxMCPConfigBytes {
		snapshot.Problem = ".mcp.json 超过 1 MiB，MilkSU 不会加载。"
		return snapshot, nil
	}
	digest := sha256.Sum256(data)
	snapshot.Digest = hex.EncodeToString(digest[:])

	var document struct {
		Servers map[string]json.RawMessage `json:"mcpServers"`
	}
	if err := json.Unmarshal(data, &document); err != nil {
		snapshot.Problem = "无法解析 .mcp.json：" + boundedMCPProblem(err)
		return snapshot, nil
	}
	if len(document.Servers) == 0 {
		snapshot.Problem = ".mcp.json 中没有可用的 mcpServers。"
		return snapshot, nil
	}
	if len(document.Servers) > maxMCPServers {
		snapshot.Problem = fmt.Sprintf(".mcp.json 最多支持 %d 个服务器。", maxMCPServers)
		return snapshot, nil
	}

	for name, raw := range document.Servers {
		if !validMCPServerName(name) {
			snapshot.Problem = "发现无效的 MCP 服务器名称；名称必须是 1–80 个可见字符。"
			snapshot.Servers = []MCPServerSummary{}
			return snapshot, nil
		}
		var definition struct {
			Command  string `json:"command"`
			URL      string `json:"url"`
			Socket   string `json:"socket"`
			Disabled bool   `json:"disabled"`
		}
		if err := json.Unmarshal(raw, &definition); err != nil {
			snapshot.Problem = fmt.Sprintf("MCP 服务器 %q 的配置无效。", name)
			snapshot.Servers = []MCPServerSummary{}
			return snapshot, nil
		}
		if definition.Disabled {
			continue
		}
		transport := ""
		switch {
		case strings.TrimSpace(definition.Command) != "":
			transport = "本地进程"
		case strings.TrimSpace(definition.URL) != "":
			transport = "远程 HTTP"
		case strings.TrimSpace(definition.Socket) != "":
			transport = "本地 Socket"
		default:
			continue
		}
		snapshot.Servers = append(snapshot.Servers, MCPServerSummary{
			Name:      name,
			Transport: transport,
		})
	}
	sort.Slice(snapshot.Servers, func(i, j int) bool {
		return strings.ToLower(snapshot.Servers[i].Name) <
			strings.ToLower(snapshot.Servers[j].Name)
	})
	if len(snapshot.Servers) == 0 && snapshot.Problem == "" {
		snapshot.Problem = ".mcp.json 中没有已启用且可识别的服务器。"
	}
	return snapshot, nil
}

func validMCPServerName(value string) bool {
	value = strings.TrimSpace(value)
	if value == "" || len([]rune(value)) > 80 || !utf8.ValidString(value) {
		return false
	}
	return strings.IndexFunc(value, func(value rune) bool {
		return unicode.IsControl(value)
	}) < 0
}

func boundedMCPProblem(err error) string {
	value := strings.TrimSpace(err.Error())
	if len(value) > 180 {
		return value[:180] + "…"
	}
	return value
}
