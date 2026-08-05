package codingenv

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"unicode"
	"unicode/utf8"
)

const maxMCPConfigBytes = 1 << 20
const maxMCPServers = 64
const maxMCPReviewTools = 64

type MCPServerSummary struct {
	Name             string   `json:"name"`
	Transport        string   `json:"transport"`
	Source           string   `json:"source,omitempty"`
	Version          string   `json:"version,omitempty"`
	TaskScope        string   `json:"taskScope,omitempty"`
	Tools            []string `json:"tools"`
	FileAccess       string   `json:"fileAccess"`
	NetworkAccess    string   `json:"networkAccess"`
	CredentialAccess string   `json:"credentialAccess"`
	ReviewReady      bool     `json:"reviewReady"`
	ReviewProblem    string   `json:"reviewProblem,omitempty"`
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
			Command      string                     `json:"command"`
			URL          string                     `json:"url"`
			Socket       string                     `json:"socket"`
			Disabled     bool                       `json:"disabled"`
			Env          map[string]json.RawMessage `json:"env"`
			Headers      map[string]json.RawMessage `json:"headers"`
			BearerToken  json.RawMessage            `json:"bearerToken"`
			IncludeTools []string                   `json:"includeTools"`
			Review       struct {
				Source    string `json:"source"`
				Version   string `json:"version"`
				TaskScope string `json:"taskScope"`
			} `json:"milksu"`
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
		fileAccess := ""
		networkAccess := ""
		switch {
		case strings.TrimSpace(definition.Command) != "":
			transport = "本地进程"
			fileAccess = "项目读写 + 私有运行目录"
			networkAccess = "任意出站网络"
		case strings.TrimSpace(definition.URL) != "":
			transport = "远程 HTTP"
			fileAccess = "不直接授予本机文件"
			networkAccess = reviewedRemoteOrigin(definition.URL)
		case strings.TrimSpace(definition.Socket) != "":
			transport = "本地 Socket"
			fileAccess = "由本地 Socket 服务自身权限决定"
			networkAccess = "仅连接配置的本地 Socket"
		default:
			continue
		}
		credentialAccess := "不注入；Provider Credential 保持隔离"
		if len(definition.Env) > 0 || len(definition.Headers) > 0 ||
			len(definition.BearerToken) > 0 {
			credentialAccess = "使用项目专用配置；Provider Credential 保持隔离"
		}
		source := strings.TrimSpace(definition.Review.Source)
		version := strings.TrimSpace(definition.Review.Version)
		taskScope := strings.TrimSpace(definition.Review.TaskScope)
		tools := reviewedToolSurface(definition.IncludeTools)
		reviewProblem := reviewedMCPProblem(
			definition.Review.Source,
			definition.Review.Version,
			definition.Review.TaskScope,
			tools,
		)
		snapshot.Servers = append(snapshot.Servers, MCPServerSummary{
			Name:             name,
			Transport:        transport,
			Source:           source,
			Version:          version,
			TaskScope:        taskScope,
			Tools:            tools,
			FileAccess:       fileAccess,
			NetworkAccess:    networkAccess,
			CredentialAccess: credentialAccess,
			ReviewReady:      reviewProblem == "",
			ReviewProblem:    reviewProblem,
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

func reviewedRemoteOrigin(value string) string {
	parsed, err := url.Parse(strings.TrimSpace(value))
	if err != nil || parsed.Host == "" ||
		(parsed.Scheme != "http" && parsed.Scheme != "https") {
		return "远程地址无效"
	}
	return "仅连接 " + parsed.Scheme + "://" + parsed.Host
}

func reviewedToolSurface(values []string) []string {
	if len(values) == 0 || len(values) > maxMCPReviewTools {
		return []string{}
	}
	seen := map[string]struct{}{}
	result := make([]string, 0, len(values))
	for _, raw := range values {
		value := strings.TrimSpace(raw)
		if raw != value || !validMCPReviewText(value, 100) {
			return []string{}
		}
		if _, exists := seen[value]; exists {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	sort.Strings(result)
	return result
}

func reviewedMCPProblem(source, version, taskScope string, tools []string) string {
	switch {
	case !validMCPReviewText(source, 160):
		return "缺少可审阅的来源；请在 milksu.source 中声明固定来源。"
	case !validMCPVersion(version):
		return "缺少固定版本；milksu.version 不能使用 latest、next 或通配符。"
	case !validMCPReviewText(taskScope, 240):
		return "缺少任务范围；请在 milksu.taskScope 中说明用途。"
	case len(tools) == 0:
		return "缺少工具白名单；请用 includeTools 声明本任务可见工具。"
	default:
		return ""
	}
}

func validMCPVersion(value string) bool {
	if !validMCPReviewText(value, 80) ||
		strings.ContainsAny(value, " \t\r\n*^~<>=|,") {
		return false
	}
	lower := strings.ToLower(value)
	for _, segment := range strings.FieldsFunc(lower, func(value rune) bool {
		return strings.ContainsRune("._/-", value)
	}) {
		if segment == "x" {
			return false
		}
	}
	switch lower {
	case "latest", "next", "canary", "main", "master", "head":
		return false
	default:
		return true
	}
}

func validMCPReviewText(value string, limit int) bool {
	return value != "" && value == strings.TrimSpace(value) &&
		utf8.ValidString(value) && len([]rune(value)) <= limit &&
		strings.IndexFunc(value, unicode.IsControl) < 0
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
