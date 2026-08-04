package computercap

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"syscall"
	"time"
)

const (
	DriverVersion = "0.14.2"
	hostBundleID  = "com.milksu.app"
	runtimeRoot   = "/private/tmp/milksu-computer-use"
)

type Permissions struct {
	Accessibility   bool `json:"accessibility"`
	ScreenRecording bool `json:"screenRecording"`
}

func (value Permissions) Ready() bool {
	return value.Accessibility && value.ScreenRecording
}

type Target struct {
	Name        string `json:"name"`
	BundleID    string `json:"bundleId"`
	PID         int    `json:"pid"`
	WindowID    int64  `json:"windowId"`
	WindowTitle string `json:"windowTitle,omitempty"`
}

type TargetSelection struct {
	PID      int   `json:"pid"`
	WindowID int64 `json:"windowId"`
}

type Status struct {
	Available      bool        `json:"available"`
	Enabled        bool        `json:"enabled"`
	ConversationID string      `json:"conversationId,omitempty"`
	SessionID      string      `json:"sessionId,omitempty"`
	Phase          string      `json:"phase"`
	StartedAt      string      `json:"startedAt,omitempty"`
	DriverVersion  string      `json:"driverVersion,omitempty"`
	Target         Target      `json:"target"`
	Permissions    Permissions `json:"permissions"`
	Problem        string      `json:"problem,omitempty"`
}

type Descriptor struct {
	SessionID      string `json:"sessionId"`
	SocketPath     string `json:"socketPath"`
	TargetBundleID string `json:"targetBundleId"`
	TargetName     string `json:"targetName"`
	TargetPID      int    `json:"targetPid"`
	TargetWindowID int64  `json:"targetWindowId"`
}

type Options struct {
	BinaryPath      string
	TargetPID       int
	GOOS            string
	PermissionProbe func(prompt bool) Permissions
	PermissionOpen  func(Permissions)
	TargetProvider  func() ([]Target, error)
	CommandFactory  func(name string, args ...string) *exec.Cmd
	StartTimeout    time.Duration
}

type session struct {
	conversationID string
	sessionID      string
	socketPath     string
	directory      string
	startedAt      time.Time
	command        *exec.Cmd
	done           chan error
	phase          string
	problem        string
	stopping       bool
	target         Target
}

type Manager struct {
	mu              sync.Mutex
	binaryPath      string
	targetPID       int
	goos            string
	permissionProbe func(prompt bool) Permissions
	permissionOpen  func(Permissions)
	targetProvider  func() ([]Target, error)
	commandFactory  func(name string, args ...string) *exec.Cmd
	startTimeout    time.Duration
	active          *session
}

func New(options Options) *Manager {
	targetPID := options.TargetPID
	if targetPID <= 1 {
		targetPID = os.Getpid()
	}
	goos := strings.TrimSpace(options.GOOS)
	if goos == "" {
		goos = runtime.GOOS
	}
	permissionProbe := options.PermissionProbe
	if permissionProbe == nil {
		permissionProbe = platformPermissions
	}
	permissionOpen := options.PermissionOpen
	if permissionOpen == nil {
		permissionOpen = platformRequestPermissions
	}
	targetProvider := options.TargetProvider
	if targetProvider == nil {
		targetProvider = platformTargets
	}
	commandFactory := options.CommandFactory
	if commandFactory == nil {
		commandFactory = exec.Command
	}
	startTimeout := options.StartTimeout
	if startTimeout <= 0 {
		startTimeout = 12 * time.Second
	}
	return &Manager{
		binaryPath:      strings.TrimSpace(options.BinaryPath),
		targetPID:       targetPID,
		goos:            goos,
		permissionProbe: permissionProbe,
		permissionOpen:  permissionOpen,
		targetProvider:  targetProvider,
		commandFactory:  commandFactory,
		startTimeout:    startTimeout,
	}
}

func (manager *Manager) Status() Status {
	manager.mu.Lock()
	defer manager.mu.Unlock()
	return manager.statusLocked(manager.permissionProbe(false))
}

func (manager *Manager) RequestPermissions() Status {
	manager.mu.Lock()
	permissions := manager.permissionProbe(false)
	status := manager.statusLocked(permissions)
	permissionOpen := manager.permissionOpen
	goos := manager.goos
	manager.mu.Unlock()
	if !permissions.Ready() && goos == "darwin" {
		permissionOpen(permissions)
	}
	return status
}

func (manager *Manager) Targets() ([]Target, error) {
	if manager.goos != "darwin" {
		return nil, fmt.Errorf("Computer Use is currently available only on macOS")
	}
	targets, err := manager.targetProvider()
	if err != nil {
		return nil, err
	}
	return filterValidTargets(targets), nil
}

func (manager *Manager) Start(
	ctx context.Context,
	conversationID string,
	selection TargetSelection,
) (Status, error) {
	conversationID = strings.TrimSpace(conversationID)
	if !validConversationID(conversationID) {
		return Status{}, fmt.Errorf("invalid Coding conversation id")
	}
	manager.mu.Lock()
	if manager.active != nil {
		status := manager.statusLocked(manager.permissionProbe(false))
		if manager.active.conversationID == conversationID && manager.active.phase == "ready" {
			manager.mu.Unlock()
			return status, nil
		}
		manager.mu.Unlock()
		return status, fmt.Errorf(
			"Computer Use is already attached to another visible Coding task",
		)
	}
	if manager.goos != "darwin" {
		status := manager.statusLocked(manager.permissionProbe(false))
		manager.mu.Unlock()
		return status, fmt.Errorf("Computer Use is currently available only on macOS")
	}
	permissions := manager.permissionProbe(false)
	if !permissions.Ready() {
		status := manager.statusLocked(permissions)
		manager.mu.Unlock()
		return status, fmt.Errorf(
			"请先明确授予 MilkSU 辅助功能与屏幕录制权限，再启动可见会话",
		)
	}
	target, err := manager.resolveTargetLocked(selection)
	if err != nil {
		status := manager.statusLocked(permissions)
		manager.mu.Unlock()
		return status, err
	}
	binaryPath, err := manager.resolveBinaryLocked()
	if err != nil {
		status := manager.statusLocked(permissions)
		manager.mu.Unlock()
		return status, err
	}
	if err := manager.verifyBinaryLocked(binaryPath); err != nil {
		status := manager.statusLocked(permissions)
		manager.mu.Unlock()
		return status, err
	}
	sessionID, err := newSessionID()
	if err != nil {
		manager.mu.Unlock()
		return Status{}, fmt.Errorf("create Computer Use session id: %w", err)
	}
	directory := filepath.Join(runtimeRoot, sessionID)
	if err := createRuntimeDirectory(directory); err != nil {
		manager.mu.Unlock()
		return Status{}, err
	}
	manifestPath := filepath.Join(directory, "session-policy.yaml")
	if err := os.WriteFile(manifestPath, []byte(sessionManifest(target.BundleID)), 0o600); err != nil {
		_ = cleanupRuntimeDirectory(directory)
		manager.mu.Unlock()
		return Status{}, fmt.Errorf("write Computer Use bounded policy: %w", err)
	}
	socketPath := filepath.Join(directory, "driver.sock")
	command := manager.commandFactory(
		binaryPath,
		"serve",
		"--embedded",
		"--host-bundle-id",
		hostBundleID,
		"--socket",
		socketPath,
		"--permission-mode",
		"bounded",
		"--session-policy",
		manifestPath,
		"--approve-session-policy",
	)
	command.Env = driverEnvironment(directory)
	command.Stdout = io.Discard
	command.Stderr = newLimitedBuffer(8 << 10)
	command.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	if err := command.Start(); err != nil {
		_ = cleanupRuntimeDirectory(directory)
		manager.mu.Unlock()
		return Status{}, fmt.Errorf("start embedded Computer Use driver: %w", err)
	}
	active := &session{
		conversationID: conversationID,
		sessionID:      sessionID,
		socketPath:     socketPath,
		directory:      directory,
		startedAt:      time.Now().UTC(),
		command:        command,
		done:           make(chan error, 1),
		phase:          "starting",
		target:         target,
	}
	manager.active = active
	go manager.wait(active)
	manager.mu.Unlock()

	waitContext, cancel := context.WithTimeout(ctx, manager.startTimeout)
	defer cancel()
	if err := waitForSocket(waitContext, socketPath, active.done); err != nil {
		_, _ = manager.Stop(conversationID)
		return manager.Status(), fmt.Errorf("start Computer Use private driver: %w", err)
	}
	manager.mu.Lock()
	if manager.active == active && active.phase == "starting" {
		active.phase = "ready"
	}
	status := manager.statusLocked(manager.permissionProbe(false))
	manager.mu.Unlock()
	return status, nil
}

func (manager *Manager) Stop(conversationID string) (Status, error) {
	conversationID = strings.TrimSpace(conversationID)
	manager.mu.Lock()
	active := manager.active
	if active == nil {
		status := manager.statusLocked(manager.permissionProbe(false))
		manager.mu.Unlock()
		return status, nil
	}
	if active.conversationID != conversationID {
		status := manager.statusLocked(manager.permissionProbe(false))
		manager.mu.Unlock()
		return status, fmt.Errorf("Computer Use session belongs to another Coding task")
	}
	active.stopping = true
	active.phase = "stopping"
	manager.mu.Unlock()

	stopProcess(active.command)
	select {
	case <-active.done:
	case <-time.After(3 * time.Second):
		killProcess(active.command)
		select {
		case <-active.done:
		case <-time.After(time.Second):
		}
	}
	if err := cleanupRuntimeDirectory(active.directory); err != nil {
		return manager.Status(), err
	}
	manager.mu.Lock()
	if manager.active == active {
		manager.active = nil
	}
	status := manager.statusLocked(manager.permissionProbe(false))
	manager.mu.Unlock()
	return status, nil
}

func (manager *Manager) Descriptor(conversationID string) (Descriptor, bool) {
	manager.mu.Lock()
	defer manager.mu.Unlock()
	active := manager.active
	if active == nil ||
		active.phase != "ready" ||
		active.conversationID != strings.TrimSpace(conversationID) {
		return Descriptor{}, false
	}
	return Descriptor{
		SessionID:      active.sessionID,
		SocketPath:     active.socketPath,
		TargetBundleID: active.target.BundleID,
		TargetName:     active.target.Name,
		TargetPID:      active.target.PID,
		TargetWindowID: active.target.WindowID,
	}, true
}

func (manager *Manager) OwnsConversation(conversationID string) bool {
	manager.mu.Lock()
	defer manager.mu.Unlock()
	return manager.active != nil &&
		manager.active.conversationID == strings.TrimSpace(conversationID)
}

func (manager *Manager) Close() {
	manager.mu.Lock()
	active := manager.active
	manager.mu.Unlock()
	if active != nil {
		_, _ = manager.Stop(active.conversationID)
	}
}

func (manager *Manager) wait(active *session) {
	err := active.command.Wait()
	active.done <- err
	close(active.done)
	manager.mu.Lock()
	defer manager.mu.Unlock()
	if manager.active != active {
		return
	}
	if active.stopping {
		active.phase = "stopped"
		return
	}
	active.phase = "failed"
	active.problem = "嵌入式 Computer Use Driver 已意外停止；旧会话不会自动重放操作。"
}

func (manager *Manager) statusLocked(permissions Permissions) Status {
	status := Status{
		Available:     manager.driverAvailableLocked(),
		Phase:         "disabled",
		DriverVersion: DriverVersion,
		Target:        defaultTarget(manager.targetPID),
		Permissions:   permissions,
	}
	if manager.goos != "darwin" {
		status.Available = false
		status.Phase = "unavailable"
		status.Problem = "Computer Use 当前仅支持 macOS。"
		return status
	}
	if !status.Available {
		status.Phase = "unavailable"
		status.Problem = "打包的 Cua Driver 不可用；MilkSU 不会回退到系统级全局控制。"
	}
	if manager.active == nil {
		return status
	}
	status.Enabled = manager.active.phase == "ready"
	status.ConversationID = manager.active.conversationID
	status.SessionID = manager.active.sessionID
	status.Phase = manager.active.phase
	status.StartedAt = manager.active.startedAt.Format(time.RFC3339Nano)
	status.Target = manager.active.target
	status.Problem = manager.active.problem
	return status
}

func (manager *Manager) resolveTargetLocked(selection TargetSelection) (Target, error) {
	if selection.PID <= 1 || selection.WindowID <= 0 {
		return Target{}, fmt.Errorf("请选择一个当前可见的 App 窗口")
	}
	targets, err := manager.targetProvider()
	if err != nil {
		return Target{}, fmt.Errorf("list visible Computer Use targets: %w", err)
	}
	for _, target := range filterValidTargets(targets) {
		if target.PID == selection.PID && target.WindowID == selection.WindowID {
			return target, nil
		}
	}
	return Target{}, fmt.Errorf("选择的 App 窗口已不可见，请刷新后重新选择")
}

func (manager *Manager) resolveBinaryLocked() (string, error) {
	candidates := []string{manager.binaryPath}
	if executable, err := os.Executable(); err == nil {
		candidates = append(
			candidates,
			filepath.Join(
				filepath.Dir(executable),
				"..",
				"Resources",
				"milksu-sidecar",
				"cua-driver",
			),
		)
	}
	// A packaged app must always prefer its sealed Resources copy. The
	// environment override remains a development fallback for `wails dev`, but
	// cannot shadow the driver that shipped inside MilkSU.app.
	if sidecarDirectory := strings.TrimSpace(os.Getenv("MILKSU_SIDECAR_DIR")); sidecarDirectory != "" {
		candidates = append(candidates, filepath.Join(sidecarDirectory, "cua-driver"))
	}
	architecture := runtime.GOARCH
	if architecture == "x86_64" {
		architecture = "amd64"
	}
	if workingDirectory, err := os.Getwd(); err == nil {
		candidates = append(
			candidates,
			filepath.Join(
				workingDirectory,
				"build",
				"sidecar",
				"darwin-"+architecture,
				"cua-driver",
			),
		)
	}
	for _, candidate := range candidates {
		if candidate == "" {
			continue
		}
		canonical, err := filepath.Abs(candidate)
		if err != nil {
			continue
		}
		info, err := os.Lstat(canonical)
		if err != nil ||
			info.Mode()&os.ModeSymlink != 0 ||
			!info.Mode().IsRegular() ||
			info.Mode().Perm()&0o111 == 0 {
			continue
		}
		manager.binaryPath = filepath.Clean(canonical)
		return manager.binaryPath, nil
	}
	return "", fmt.Errorf("MilkSU packaged Cua Driver %s is unavailable", DriverVersion)
}

func (manager *Manager) driverAvailableLocked() bool {
	_, err := manager.resolveBinaryLocked()
	return err == nil
}

func (manager *Manager) verifyBinaryLocked(binaryPath string) error {
	command := manager.commandFactory(binaryPath, "--version")
	command.Env = driverEnvironment(filepath.Dir(binaryPath))
	var output bytes.Buffer
	command.Stdout = &output
	command.Stderr = &output
	done := make(chan error, 1)
	if err := command.Start(); err != nil {
		return fmt.Errorf("inspect packaged Cua Driver: %w", err)
	}
	go func() { done <- command.Wait() }()
	select {
	case err := <-done:
		if err != nil {
			return fmt.Errorf("inspect packaged Cua Driver: %w", err)
		}
	case <-time.After(3 * time.Second):
		killProcess(command)
		return fmt.Errorf("inspect packaged Cua Driver: timed out")
	}
	if strings.TrimSpace(output.String()) != "cua-driver "+DriverVersion {
		return fmt.Errorf(
			"unexpected Cua Driver version; MilkSU requires %s",
			DriverVersion,
		)
	}
	return nil
}

func sessionManifest(bundleID string) string {
	bundleID = strings.TrimSpace(bundleID)
	if !validBundleID(bundleID) {
		bundleID = hostBundleID
	}
	return fmt.Sprintf(`version: 2
mode: bounded
expires_after: 8h
idle_timeout: 30m
resources:
  apps:
    - bundle_id: %s
      launch: false
      windows: all
      terminate: deny
allow:
  tools:
    - check_permissions
    - start_session
    - get_session_state
    - end_session
    - list_windows
    - get_window_state
    - click
    - type_text
    - press_key
    - scroll
deny:
  tools:
    - get_desktop_state
    - launch_app
    - hotkey
    - drag
    - page
    - browser_prepare
    - escalate_session
    - start_recording
`, bundleID)
}

func driverEnvironment(directory string) []string {
	environment := []string{
		"HOME=" + filepath.Join(directory, "home"),
		"TMPDIR=" + filepath.Join(directory, "tmp"),
		"PATH=/usr/bin:/bin:/usr/sbin:/sbin",
		"LANG=en_US.UTF-8",
		"CUA_DRIVER_EMBEDDED=1",
		"CUA_DRIVER_HOST_BUNDLE_ID=" + hostBundleID,
		"CUA_DRIVER_PERMISSION_MODE=bounded",
		"CUA_DRIVER_RS_TELEMETRY_ENABLED=false",
		"CUA_LOG=warn",
	}
	for _, directory := range []string{
		filepath.Join(directory, "home"),
		filepath.Join(directory, "tmp"),
	} {
		_ = os.MkdirAll(directory, 0o700)
	}
	return environment
}

func filterValidTargets(targets []Target) []Target {
	filtered := make([]Target, 0, len(targets))
	seen := map[string]bool{}
	for _, target := range targets {
		target.Name = strings.TrimSpace(target.Name)
		target.BundleID = strings.TrimSpace(target.BundleID)
		target.WindowTitle = strings.TrimSpace(target.WindowTitle)
		if target.PID <= 1 ||
			target.WindowID <= 0 ||
			target.Name == "" ||
			!validBundleID(target.BundleID) {
			continue
		}
		key := fmt.Sprintf("%d/%d", target.PID, target.WindowID)
		if seen[key] {
			continue
		}
		seen[key] = true
		filtered = append(filtered, target)
	}
	return filtered
}

func defaultTarget(pid int) Target {
	if pid <= 1 {
		pid = os.Getpid()
	}
	return Target{Name: "MilkSU", BundleID: hostBundleID, PID: pid}
}

func validBundleID(value string) bool {
	if value == "" || len(value) > 256 {
		return false
	}
	for _, character := range value {
		if character >= 'a' && character <= 'z' ||
			character >= 'A' && character <= 'Z' ||
			character >= '0' && character <= '9' ||
			character == '.' ||
			character == '-' {
			continue
		}
		return false
	}
	return true
}

func waitForSocket(ctx context.Context, path string, exited <-chan error) error {
	ticker := time.NewTicker(40 * time.Millisecond)
	defer ticker.Stop()
	for {
		connection, err := net.DialTimeout("unix", path, 80*time.Millisecond)
		if err == nil {
			_ = connection.Close()
			return nil
		}
		select {
		case processError, open := <-exited:
			if !open || processError == nil {
				return fmt.Errorf("driver stopped before opening its private socket")
			}
			return processError
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
		}
	}
}

func newSessionID() (string, error) {
	var value [16]byte
	if _, err := rand.Read(value[:]); err != nil {
		return "", err
	}
	return "computer_" + hex.EncodeToString(value[:]), nil
}

func validConversationID(value string) bool {
	if value == "" || len(value) > 128 {
		return false
	}
	for _, character := range value {
		if character >= 'a' && character <= 'z' ||
			character >= 'A' && character <= 'Z' ||
			character >= '0' && character <= '9' ||
			character == '_' ||
			character == '-' {
			continue
		}
		return false
	}
	return true
}

func createRuntimeDirectory(directory string) error {
	clean := filepath.Clean(directory)
	if filepath.Dir(clean) != runtimeRoot ||
		!strings.HasPrefix(filepath.Base(clean), "computer_") {
		return fmt.Errorf("refusing to create an invalid Computer Use runtime directory")
	}
	if err := os.MkdirAll(runtimeRoot, 0o700); err != nil {
		return fmt.Errorf("create Computer Use runtime root: %w", err)
	}
	rootInfo, err := os.Lstat(runtimeRoot)
	if err != nil {
		return fmt.Errorf("inspect Computer Use runtime root: %w", err)
	}
	rootStat, ownerKnown := rootInfo.Sys().(*syscall.Stat_t)
	if rootInfo.Mode()&os.ModeSymlink != 0 ||
		!rootInfo.IsDir() ||
		(ownerKnown && int(rootStat.Uid) != os.Getuid()) {
		return fmt.Errorf("Computer Use runtime root is not a private app-owned directory")
	}
	if err := os.Chmod(runtimeRoot, 0o700); err != nil {
		return fmt.Errorf("protect Computer Use runtime root: %w", err)
	}
	if err := os.Mkdir(clean, 0o700); err != nil {
		return fmt.Errorf("create Computer Use runtime directory: %w", err)
	}
	if err := os.Chmod(clean, 0o700); err != nil {
		_ = cleanupRuntimeDirectory(clean)
		return fmt.Errorf("protect Computer Use runtime directory: %w", err)
	}
	return nil
}

func cleanupRuntimeDirectory(directory string) error {
	clean := filepath.Clean(directory)
	if filepath.Dir(clean) != runtimeRoot ||
		!strings.HasPrefix(filepath.Base(clean), "computer_") {
		return fmt.Errorf("refusing to clean an invalid Computer Use runtime directory")
	}
	if err := os.RemoveAll(clean); err != nil {
		return fmt.Errorf("clean Computer Use runtime directory: %w", err)
	}
	return nil
}

func stopProcess(command *exec.Cmd) {
	if command == nil || command.Process == nil {
		return
	}
	if err := syscall.Kill(-command.Process.Pid, syscall.SIGTERM); err != nil {
		_ = command.Process.Signal(syscall.SIGTERM)
	}
}

func killProcess(command *exec.Cmd) {
	if command == nil || command.Process == nil {
		return
	}
	if err := syscall.Kill(-command.Process.Pid, syscall.SIGKILL); err != nil {
		_ = command.Process.Kill()
	}
}

type limitedBuffer struct {
	mu    sync.Mutex
	limit int
	data  []byte
}

func newLimitedBuffer(limit int) *limitedBuffer {
	return &limitedBuffer{limit: limit}
}

func (buffer *limitedBuffer) Write(data []byte) (int, error) {
	buffer.mu.Lock()
	defer buffer.mu.Unlock()
	remaining := buffer.limit - len(buffer.data)
	if remaining > 0 {
		buffer.data = append(buffer.data, data[:min(len(data), remaining)]...)
	}
	return len(data), nil
}

var _ io.Writer = (*limitedBuffer)(nil)
