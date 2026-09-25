package engine

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	goruntime "runtime"
	"strconv"
	"strings"

	"github.com/MilkSU-Official/milksu/internal/appdata"
	"github.com/MilkSU-Official/milksu/internal/codingtools"
	"github.com/MilkSU-Official/milksu/internal/config"
	"github.com/MilkSU-Official/milksu/internal/hostpath"
)

const (
	packagedSidecarDirectory    = "milksu-sidecar"
	developmentChatBridgePath   = "sidecar/pi/run-bridge.mjs"
	developmentDSHBridgePath    = "sidecar/dsh/run-bridge.mjs"
	pluginMCPCommandEnvironment = "MILKSU_PLUGIN_MCP_COMMAND"
	pluginMCPAppDataEnvironment = "MILKSU_PLUGIN_MCP_APPDATA"
	dshHomeEnvironment          = "DSH_HOME"
	dshProfileEnvironment       = "MILKSU_DSH_PROFILE"
	dshProductIpcEnvironment    = "MILKSU_DSH_IPC"
	dshHostIpcEnvironment       = "MILKSU_DSH_HOST_IPC"
	dshLLMProtocolEnvironment   = "MILKSU_DSH_LLM_PROTOCOL"
	officialDeepSeekAPIRoot     = "https://api.deepseek.com"
	tokenfluxChatCompletionsURL = "https://tokenflux.dev/v1"
)

type sidecarRuntime struct {
	node     string
	bridge   string
	packaged bool
}

func sidecarEnvironment(settings config.AppSettings) ([]string, error) {
	runtimeHome, err := sidecarRuntimeHome()
	if err != nil {
		return nil, err
	}
	pluginMCPCommand, err := canonicalCurrentExecutable()
	if err != nil {
		return nil, fmt.Errorf("resolve first-party Plugin MCP command: %w", err)
	}
	pluginMCPAppData, err := filepath.EvalSymlinks(filepath.Dir(runtimeHome))
	if err != nil {
		return nil, fmt.Errorf("resolve first-party Plugin MCP data directory: %w", err)
	}
	attachmentRoot := filepath.Join(runtimeHome, "attachments")
	collaborationRoot := filepath.Join(runtimeHome, "coding-collaboration")
	for label, directory := range map[string]string{
		"Coding attachment":    attachmentRoot,
		"Coding collaboration": collaborationRoot,
	} {
		if err := os.MkdirAll(directory, 0o700); err != nil {
			return nil, fmt.Errorf("create %s directory: %w", label, err)
		}
	}
	userHome, err := os.UserHomeDir()
	if err != nil {
		return nil, fmt.Errorf("resolve local user home: %w", err)
	}
	canonicalUserHome, err := filepath.EvalSymlinks(userHome)
	if err != nil {
		return nil, fmt.Errorf("resolve canonical local user home: %w", err)
	}
	environment := engineEnvironment(settings)
	filtered := environment[:0]
	for _, entry := range environment {
		if !strings.HasPrefix(entry, "HOME=") &&
			!strings.HasPrefix(entry, "PI_CACHE_RETENTION=") {
			filtered = append(filtered, entry)
		}
	}
	environment = append(
		filtered,
		"HOME="+runtimeHome,
		"MILKSU_PI_AGENT_DIR="+filepath.Join(runtimeHome, "pi"),
		"MILKSU_CODING_ATTACHMENT_ROOT="+attachmentRoot,
		"MILKSU_CODING_COLLABORATION_ROOT="+collaborationRoot,
		"MILKSU_VISION_CACHE="+filepath.Join(runtimeHome, "vision-cache.json"),
		// Keep Pi's provider-native prompt cache alive across normal human pauses.
		// Explicit one-off compaction requests still override this with "none".
		"PI_CACHE_RETENTION=long",
		// These two launcher-owned values are the complete Plugin MCP process
		// descriptor. The renderer and project MCP configuration never choose
		// its command, data root, arguments, or child environment.
		pluginMCPCommandEnvironment+"="+pluginMCPCommand,
		pluginMCPAppDataEnvironment+"="+pluginMCPAppData,
		// Resolve the real user home in the supervised launcher so Pi policy can
		// reject accidental broad grants without guessing from its isolated HOME.
		"MILKSU_USER_HOME="+canonicalUserHome,
	)
	if catalogPath := strings.TrimSpace(settings.RuntimeModelCatalogPath); catalogPath != "" {
		environment = append(environment, "MILKSU_MODEL_CATALOG_PATH="+catalogPath)
	}
	if encoded := config.EncodeModelContextWindows(settings); encoded != "" {
		environment = append(environment, "MILKSU_MODEL_CONTEXT_WINDOWS="+encoded)
	}
	if socket := strings.TrimSpace(os.Getenv("SSH_AUTH_SOCK")); socket != "" {
		environment = append(environment, "MILKSU_USER_SSH_AUTH_SOCK="+socket)
	}
	if dataDirectory, err := appdata.Directory(); err == nil {
		environment = mergeSidecarEnvironment(environment, codingtools.SidecarEnvironment(dataDirectory))
	}
	if agentProtectionDisabledFor(settings) {
		// 紧急关闭：内置项（含 App 本体）也不再下发，并把这个事实明确告诉侧车，
		// 否则侧车会自己派生根（derivedProtectedRoots）而继续拦人。
		environment = append(environment, protectedDisabledEnvironment+"=1")
	} else if roots := protectedRootsVariable(); roots != "" {
		environment = append(environment, roots)
	}

	return environment, nil
}

func withDSHSidecarEnvironment(environment []string) []string {
	suffix := strconv.Itoa(os.Getpid())
	extra := []string{
		dshProfileEnvironment + "=acp",
		dshProductIpcEnvironment + "=" + hostpath.DSHProductIpc(goruntime.GOOS, "p"+suffix),
		dshHostIpcEnvironment + "=" + hostpath.DSHProductIpc(goruntime.GOOS, "h"+suffix),
	}
	runtimeHome, err := sidecarRuntimeHome()
	if err == nil {
		dshHome := filepath.Join(runtimeHome, "dsh")
		if err := os.MkdirAll(dshHome, 0o700); err == nil {
			extra = append(extra, dshHomeEnvironment+"="+dshHome)
		}
	}
	return mergeSidecarEnvironment(environment, extra)
}

func withDSHProviderEnvironment(environment []string, settings config.AppSettings) []string {
	connection, ok := dshDeepSeekConnection(settings)
	if !ok {
		return environment
	}
	extra := []string{"DEEPSEEK_API_KEY=" + connection.Key}
	if connection.BaseURL != "" {
		extra = append(extra, "DEEPSEEK_BASE_URL="+connection.BaseURL)
	}
	if connection.Protocol != "" {
		extra = append(extra, dshLLMProtocolEnvironment+"="+connection.Protocol)
	}
	return mergeSidecarEnvironment(environment, extra)
}

type dshProviderConnection struct {
	Key      string
	BaseURL  string
	Protocol string
}

func dshOfficialDeepSeekAPI(baseURL string) bool {
	trimmed := strings.TrimRight(strings.ToLower(strings.TrimSpace(baseURL)), "/")
	switch trimmed {
	case officialDeepSeekAPIRoot,
		officialDeepSeekAPIRoot + "/v1",
		officialDeepSeekAPIRoot + "/anthropic":
		return true
	default:
		return false
	}
}

func dshDeepSeekConnection(settings config.AppSettings) (dshProviderConnection, bool) {
	providerID := strings.TrimSpace(settings.ActiveProvider)
	provider, exists := settings.Providers[providerID]
	key := ""
	if exists {
		key = strings.TrimSpace(provider.APIKey)
	}
	if key == "" {
		for _, fallbackID := range []string{"deepseek", "custom-relay-deepseek"} {
			fallback, found := settings.Providers[fallbackID]
			fallbackKey := strings.TrimSpace(fallback.APIKey)
			if !found || fallbackKey == "" {
				continue
			}
			providerID = fallbackID
			provider = fallback
			key = fallbackKey
			exists = true
			break
		}
	}
	if key == "" {
		if relay := settings.Relay; relay != nil && relay.Enabled && strings.TrimSpace(relay.Key) != "" {
			baseURL := strings.TrimSpace(relay.URL)
			if baseURL == "" {
				baseURL = tokenfluxChatCompletionsURL
			}
			return dshProviderConnection{
				Key:      strings.TrimSpace(relay.Key),
				BaseURL:  baseURL,
				Protocol: "chat-completions",
			}, true
		}
	}
	if !exists || key == "" {
		return dshProviderConnection{}, false
	}
	baseURL := ""
	if provider.BaseURL != nil {
		baseURL = strings.TrimSpace(*provider.BaseURL)
	}
	if providerID == "tokenflux" && baseURL == "" {
		baseURL = tokenfluxChatCompletionsURL
	}
	if providerID == "deepseek" || providerID == "custom-relay-deepseek" || dshOfficialDeepSeekAPI(baseURL) {
		// DSH 0.1.6 Messages default is https://api.deepseek.com/anthropic.
		// Copying the Chat Completions root makes /v1/messages 404.
		return dshProviderConnection{Key: key, Protocol: "messages"}, true
	}
	if providerID == "tokenflux" || provider.Custom {
		return dshProviderConnection{
			Key:      key,
			BaseURL:  baseURL,
			Protocol: "chat-completions",
		}, true
	}
	return dshProviderConnection{}, false
}

func canonicalCurrentExecutable() (string, error) {
	executable, err := os.Executable()
	if err != nil {
		return "", err
	}
	executable, err = filepath.Abs(executable)
	if err != nil {
		return "", err
	}
	executable, err = filepath.EvalSymlinks(executable)
	if err != nil {
		return "", err
	}
	info, err := os.Lstat(executable)
	if err != nil {
		return "", err
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
		return "", fmt.Errorf("current executable is not a regular file")
	}
	return filepath.Clean(executable), nil
}

func mergeSidecarEnvironment(environment, extra []string) []string {
	if len(extra) == 0 {
		return environment
	}
	replaced := make(map[string]bool, len(extra))
	for _, entry := range extra {
		name, _, found := strings.Cut(entry, "=")
		if found {
			replaced[name] = true
		}
	}
	result := make([]string, 0, len(environment)+len(extra))
	for _, entry := range environment {
		name, _, found := strings.Cut(entry, "=")
		if found && replaced[name] {
			continue
		}
		result = append(result, entry)
	}
	return append(result, extra...)
}

func newSidecarCommand(packagedBridge, sourceBridge string) (*exec.Cmd, error) {
	workspace, err := sidecarWorkspace()
	if err != nil {
		return nil, err
	}
	return newSidecarCommandAt(packagedBridge, sourceBridge, workspace, false)
}

func newSidecarCommandAt(
	packagedBridge,
	sourceBridge,
	workspace string,
	allowChildProcess bool,
) (*exec.Cmd, error) {
	return newSidecarCommandAtWithDirectory(
		packagedBridge,
		sourceBridge,
		workspace,
		allowChildProcess,
		"",
	)
}

func newSidecarCommandAtWithDirectory(
	packagedBridge,
	sourceBridge,
	workspace string,
	allowChildProcess bool,
	sidecarDirectory string,
) (*exec.Cmd, error) {
	runtime, err := resolveSidecarRuntimeWithDirectory(
		packagedBridge,
		sourceBridge,
		sidecarDirectory,
	)
	if err != nil {
		return nil, err
	}
	workspace, err = resolveAgentWorkspace(workspace)
	if err != nil {
		return nil, err
	}
	arguments := []string{runtime.bridge}
	command := exec.Command(runtime.node, arguments...)
	command.Dir = workspace
	return command, nil
}

func withWorkspaceTemporaryDirectory(environment []string, workspace string) ([]string, error) {
	runtimeHome, err := sidecarRuntimeHome()
	if err != nil {
		return nil, err
	}
	runtimeDirectory, err := workspaceRuntimeDirectory(runtimeHome, workspace)
	if err != nil {
		return nil, err
	}
	temporaryDirectory := filepath.Join(runtimeDirectory, "tmp")
	backgroundTasksDirectory := filepath.Join(runtimeDirectory, "background-tasks")
	for _, directory := range []string{
		filepath.Join(runtimeDirectory, "home"),
		temporaryDirectory,
		filepath.Join(runtimeDirectory, "runtime-bin"),
		backgroundTasksDirectory,
	} {
		if err := os.MkdirAll(directory, 0o700); err != nil {
			return nil, fmt.Errorf("create Sidecar workspace runtime directory: %w", err)
		}
	}
	filtered := environment[:0]
	for _, entry := range environment {
		if !strings.HasPrefix(entry, "TMPDIR=") &&
			!strings.HasPrefix(entry, "MILKSU_WORKSPACE_RUNTIME=") &&
			!strings.HasPrefix(entry, "MILKSU_BACKGROUND_TASKS_DIR=") &&
			!strings.HasPrefix(entry, "MILKSU_AGENT_WORKSPACE=") {
			filtered = append(filtered, entry)
		}
	}
	return append(
		filtered,
		"TMPDIR="+temporaryDirectory,
		"MILKSU_WORKSPACE_RUNTIME="+runtimeDirectory,
		"MILKSU_BACKGROUND_TASKS_DIR="+backgroundTasksDirectory,
		"MILKSU_AGENT_WORKSPACE="+workspace,
	), nil
}

func workspaceRuntimeDirectory(runtimeHome, workspace string) (string, error) {
	resolved, err := resolveAgentWorkspace(workspace)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256([]byte(resolved))
	key := hex.EncodeToString(sum[:12])
	return filepath.Join(runtimeHome, "workspaces", key), nil
}

func withSidecarRuntimePath(environment []string, nodeBinary string) []string {
	runtimeDirectory := filepath.Dir(nodeBinary)
	pathValue := ""
	filtered := environment[:0]
	for _, entry := range environment {
		if strings.HasPrefix(entry, "PATH=") {
			pathValue = strings.TrimPrefix(entry, "PATH=")
			continue
		}
		filtered = append(filtered, entry)
	}
	if pathValue == "" {
		pathValue = os.Getenv("PATH")
	}
	if pathValue == "" {
		return append(filtered, "PATH="+runtimeDirectory)
	}
	return append(
		filtered,
		"PATH="+runtimeDirectory+string(os.PathListSeparator)+pathValue,
	)
}

func resolveSidecarRuntime(packagedBridge, sourceBridge string) (sidecarRuntime, error) {
	return resolveSidecarRuntimeWithDirectory(packagedBridge, sourceBridge, "")
}

func resolveSidecarRuntimeWithDirectory(
	packagedBridge,
	sourceBridge,
	sidecarDirectory string,
) (sidecarRuntime, error) {
	if directory := strings.TrimSpace(sidecarDirectory); directory != "" {
		if runtime, ok := packagedRuntimeAt(directory, packagedBridge); ok {
			return runtime, nil
		}
		return sidecarRuntime{}, fmt.Errorf(
			"selected Sidecar directory does not contain a complete runtime: %s",
			directory,
		)
	}
	if override := os.Getenv("MILKSU_SIDECAR_DIR"); override != "" {
		if runtime, ok := packagedRuntimeAt(override, packagedBridge); ok {
			return runtime, nil
		}
		return sidecarRuntime{}, fmt.Errorf("MILKSU_SIDECAR_DIR does not contain a complete runtime: %s", override)
	}

	if executable, err := os.Executable(); err == nil {
		if runtime, ok := packagedRuntimeBesideExecutable(executable, packagedBridge); ok {
			return runtime, nil
		}
	}

	root, err := findProjectRoot()
	if err != nil {
		return sidecarRuntime{}, fmt.Errorf("find packaged or development Sidecar: %w", err)
	}
	node, err := exec.LookPath("node")
	if err != nil {
		return sidecarRuntime{}, fmt.Errorf("development Sidecar requires Node.js: %w", err)
	}
	return sidecarRuntime{node: node, bridge: filepath.Join(root, sourceBridge)}, nil
}

func packagedRuntimeBesideExecutable(executable, bridgeName string) (sidecarRuntime, bool) {
	return packagedRuntimeAt(
		filepath.Join(filepath.Dir(executable), packagedSidecarDirectory),
		bridgeName,
	)
}

func packagedRuntimeAt(directory, bridgeName string) (sidecarRuntime, bool) {
	nodeName := "node"
	if goruntime.GOOS == "windows" {
		nodeName = "node.exe"
	}
	node := filepath.Join(directory, nodeName)
	bridge := filepath.Join(directory, bridgeName)
	if !regularFile(node) || !regularFile(bridge) {
		return sidecarRuntime{}, false
	}
	return sidecarRuntime{node: node, bridge: bridge, packaged: true}, true
}

func regularFile(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.Mode().IsRegular()
}

func sidecarWorkspace() (string, error) {
	directory, err := appdata.Ensure()
	if err != nil {
		return "", err
	}
	workspace := filepath.Join(directory, "agent-workspace")
	if err := os.MkdirAll(workspace, 0o700); err != nil {
		return "", fmt.Errorf("create Sidecar workspace: %w", err)
	}
	// Pi discovers repository-scoped resources by walking ancestors even when
	// Skills and extensions are disabled. This empty boundary marker stops that
	// walk inside MilkSU's isolated workspace instead of granting parent reads.
	if err := os.MkdirAll(filepath.Join(workspace, ".git"), 0o700); err != nil {
		return "", fmt.Errorf("create Sidecar discovery boundary: %w", err)
	}
	return workspace, nil
}

func sidecarRuntimeHome() (string, error) {
	directory, err := appdata.Ensure()
	if err != nil {
		return "", err
	}
	runtimeHome := filepath.Join(directory, "agent-home")
	if err := os.MkdirAll(runtimeHome, 0o700); err != nil {
		return "", fmt.Errorf("create Sidecar runtime home: %w", err)
	}
	return runtimeHome, nil
}

func codingCollaborationRoot() (string, error) {
	runtimeHome, err := sidecarRuntimeHome()
	if err != nil {
		return "", err
	}
	root := filepath.Join(runtimeHome, "coding-collaboration")
	if err := os.MkdirAll(root, 0o700); err != nil {
		return "", fmt.Errorf("create Coding collaboration runtime directory: %w", err)
	}
	return root, nil
}

func resolveAgentWorkspace(value string) (string, error) {
	workspace := strings.TrimSpace(value)
	if workspace == "" {
		return sidecarWorkspace()
	}
	absolute, err := filepath.Abs(workspace)
	if err != nil {
		return "", fmt.Errorf("resolve Agent workspace: %w", err)
	}
	resolved, err := filepath.EvalSymlinks(absolute)
	if err != nil {
		return "", fmt.Errorf("resolve Agent workspace links: %w", err)
	}
	info, err := os.Stat(resolved)
	if err != nil {
		return "", fmt.Errorf("open Agent workspace: %w", err)
	}
	if !info.IsDir() {
		return "", fmt.Errorf("Agent workspace is not a directory: %s", resolved)
	}
	return filepath.Clean(resolved), nil
}

// —— B1：beta 渠道豁免的叶子件（纯函数，便于用假路径断言 ✓）——
// protectedRoot is one absolute path an agent may never write to, with the label the audit
// log uses. The list is passed to the sidecar at spawn because that is where the tools run.
type protectedRoot struct {
	Path  string `json:"path"`
	Label string `json:"label"`
}

func appBundleRoot() string {
	executable, err := os.Executable()
	if err != nil {
		return ""
	}
	directory := filepath.Dir(executable)
	for range 6 {
		if strings.HasSuffix(directory, ".app") {
			return directory
		}
		parent := filepath.Dir(directory)
		if parent == directory {
			break
		}
		directory = parent
	}
	return ""
}

// bundleWritableByAgent 报告当前渠道是否允许 agent 更新 App 本体本身。
// 只有 beta 测试渠道放行：那里的包本来就是这个 agent 一天装五六次的东西，
// 让读者每次手动替换是多余的。stable 渠道照旧保护；数据位置不受本开关影响。
func bundleWritableByAgent() bool {
	return strings.EqualFold(strings.TrimSpace(os.Getenv("MILKSU_CHANNEL")), "beta")
}

// appBundleRoot walks up from the running executable to the packaging root. Empty in
// development, where the project root covers the source tree instead.
// appBundleProtectedRoot 决定“这个包本体要不要当受保护路径”。
// 拆成纯函数（路径传入）是为了能真测：测试二进制不在 .app 里，appBundleRoot() 永远为空，
// 直接在 protectedRootsVariable 上断言会得到一条永远为真的假守卫。
func appBundleProtectedRoot(bundle string) (protectedRoot, bool) {
	if strings.TrimSpace(bundle) == "" || bundleWritableByAgent() {
		return protectedRoot{}, false
	}
	return protectedRoot{Path: bundle, Label: "app-bundle"}, true
}

// —— B2：读者的「紧急关闭」两条叶子通道（环境变量 / 数据目录标记文件）+ 合并设置开关 ——
const (
	protectedDisabledEnvironment = "MILKSU_PROTECTED_DISABLED"
	protectionDisabledMarker     = "agent-protection-off"
)

// protectedRootsVariable renders MILKSU_PROTECTED_ROOTS. Empty when nothing could be
// resolved, so the sidecar falls back to its own derived roots instead of failing to start.
// agentProtectionDisabled 报告读者的「紧急关闭」是否生效。
// 只在两处读：环境变量（进程级）与数据目录下的标记文件（读者自己就能建，界面坏掉也行）。
func agentProtectionDisabled() bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv(protectedDisabledEnvironment))) {
	case "1", "true", "yes", "on":
		return true
	}
	directory, err := appdata.Directory()
	if err != nil || directory == "" {
		return false
	}
	info, err := os.Stat(filepath.Join(directory, protectionDisabledMarker))
	return err == nil && !info.IsDir()
}

// agentProtectionDisabledFor 合并读者的两条关闭通道：设置界面里的紧急开关，以及不依赖界面
// 的环境变量 / 标记文件（界面坏掉时用）。任一条生效即整套保护关闭。
func agentProtectionDisabledFor(settings config.AppSettings) bool {
	return agentProtectionDisabled() || config.AgentProtectionDisabled(settings)
}

// —— B3：把受保护根下发给侧车（运行时数据 / 会话记录 / App 本体 / 源码）——
const (
	protectedRootsEnvironment = "MILKSU_PROTECTED_ROOTS"
)

func protectedRootsVariable() string {
	if agentProtectionDisabled() {
		return ""
	}
	roots := make([]protectedRoot, 0, 4)
	if dataDirectory, err := appdata.Directory(); err == nil && dataDirectory != "" {
		// Covers settings.json, conversations/**, credentials.db and the scratch workspaces.
		roots = append(roots, protectedRoot{Path: dataDirectory, Label: "runtime-data"})
		if runtimeHome, err := sidecarRuntimeHome(); err == nil && runtimeHome != "" {
			roots = append(roots, protectedRoot{
				Path:  filepath.Join(runtimeHome, "pi", "sessions"),
				Label: "pi-sessions",
			})
		}
	}
	// 测试渠道例外：beta 的包本体就是 agent 反复安装的产物（读者要求：不要在装机这一步
	// 每次都卡住它）。正式渠道以及下面所有数据位置（runtime-data / pi-sessions）
	// **任何渠道**都照旧保护。
	if root, ok := appBundleProtectedRoot(appBundleRoot()); ok {
		roots = append(roots, root)
	}
	if projectRoot, err := findProjectRoot(); err == nil && projectRoot != "" {
		roots = append(roots, protectedRoot{Path: projectRoot, Label: "app-sources"})
	}
	if len(roots) == 0 {
		return ""
	}
	encoded, err := json.Marshal(roots)
	if err != nil {
		return ""
	}
	return protectedRootsEnvironment + "=" + string(encoded)
}
