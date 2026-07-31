package labmanager

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/MilkSU-Official/milksu/internal/securitypolicy"
	"github.com/MilkSU-Official/milksu/labs"
)

const JuiceShopPackageID = "owasp.juice-shop"

type Definition struct {
	ID          string   `json:"id"`
	Title       string   `json:"title"`
	Version     string   `json:"version"`
	Role        string   `json:"role"`
	Categories  []string `json:"categories"`
	Description string   `json:"description"`
	License     string   `json:"license"`
}

type State struct {
	PackageID string                    `json:"packageId"`
	Phase     string                    `json:"phase"`
	Endpoint  string                    `json:"endpoint,omitempty"`
	Port      int                       `json:"port,omitempty"`
	Message   string                    `json:"message"`
	UpdatedAt time.Time                 `json:"updatedAt"`
	Scope     securitypolicy.ScopeGrant `json:"scope"`
}

type commandRunner interface {
	Run(context.Context, string, []string, []string, string) ([]byte, error)
}

type execRunner struct{}

func (execRunner) Run(ctx context.Context, executable string, args, environment []string, directory string) ([]byte, error) {
	command := exec.CommandContext(ctx, executable, args...)
	command.Dir = directory
	command.Env = environment
	return command.CombinedOutput()
}

type Manager struct {
	mu        sync.Mutex
	root      string
	statePath string
	runner    commandRunner
	state     State
}

func New(root string) (*Manager, error) {
	return newManager(root, execRunner{})
}

func newManager(root string, runner commandRunner) (*Manager, error) {
	if runner == nil {
		return nil, fmt.Errorf("lab command runner is required")
	}
	root = filepath.Join(root, "labs")
	if err := os.MkdirAll(root, 0o700); err != nil {
		return nil, fmt.Errorf("create lab manager root: %w", err)
	}
	manager := &Manager{root: root, statePath: filepath.Join(root, "state.json"), runner: runner}
	if err := manager.installFixedFixtures(); err != nil {
		return nil, err
	}
	data, err := os.ReadFile(manager.statePath)
	if err == nil {
		_ = json.Unmarshal(data, &manager.state)
	} else if !errors.Is(err, os.ErrNotExist) {
		return nil, fmt.Errorf("read lab state: %w", err)
	}
	return manager, nil
}

func (m *Manager) Catalog() []Definition {
	return []Definition{{
		ID: JuiceShopPackageID, Title: "OWASP Juice Shop", Version: "v20.1.1", Role: "ctf",
		Categories: []string{"web"}, License: "MIT",
		Description: "固定镜像、回环端口、可自动获取/启动/重置/停止的 Web 安全训练环境。",
	}}
}

func (m *Manager) Status() State {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.state
}

func (m *Manager) Start(ctx context.Context, packageID string) (State, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if packageID != JuiceShopPackageID {
		return State{}, fmt.Errorf("unknown managed lab %q", packageID)
	}
	if m.state.PackageID == packageID && m.state.Phase == "ready" {
		return m.state, nil
	}
	port, err := availablePort()
	if err != nil {
		return State{}, err
	}
	grant, err := securitypolicy.NewGrant("managed-lab:"+packageID, "ctf training", []securitypolicy.Target{
		{Kind: securitypolicy.TargetLab, Value: packageID},
		{Kind: securitypolicy.TargetOrigin, Value: fmt.Sprintf("http://127.0.0.1:%d", port)},
	}, 12*time.Hour)
	if err != nil {
		return State{}, err
	}
	m.state = State{PackageID: packageID, Phase: "acquiring", Port: port, Message: "正在校验并获取固定镜像", UpdatedAt: time.Now().UTC(), Scope: grant}
	if err := m.persistLocked(); err != nil {
		return m.state, fmt.Errorf("persist acquiring lab state: %w", err)
	}
	directory := m.juiceShopDirectory()
	environment := commandEnvironment(port)
	if output, runErr := m.runner.Run(ctx, filepath.Join(directory, "lab.sh"), []string{"pull"}, environment, directory); runErr != nil {
		return m.failLocked("获取固定镜像失败", output, runErr)
	}
	m.state.Phase = "starting"
	m.state.Message = "正在启动并等待健康检查"
	m.state.UpdatedAt = time.Now().UTC()
	if err := m.persistLocked(); err != nil {
		return m.state, fmt.Errorf("persist starting lab state: %w", err)
	}
	output, runErr := m.runner.Run(ctx, filepath.Join(directory, "lab.sh"), []string{"start"}, environment, directory)
	if runErr != nil {
		return m.failLocked("启动训练环境失败", output, runErr)
	}
	m.state.Phase = "ready"
	m.state.Endpoint = fmt.Sprintf("http://127.0.0.1:%d", port)
	m.state.Message = strings.TrimSpace(string(output))
	m.state.UpdatedAt = time.Now().UTC()
	return m.state, m.persistLocked()
}

func (m *Manager) Reset(ctx context.Context) (State, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.state.PackageID != JuiceShopPackageID || m.state.Port == 0 {
		return State{}, fmt.Errorf("Juice Shop lab has not been started")
	}
	decision := securitypolicy.Decide(m.state.Scope, securitypolicy.EffectRequest{
		Class: "modify", Target: securitypolicy.Target{Kind: securitypolicy.TargetLab, Value: JuiceShopPackageID}, Approved: true,
	}, time.Now())
	if !decision.Allowed {
		return State{}, fmt.Errorf("lab reset denied: %s", decision.Reason)
	}
	m.state.Phase = "resetting"
	m.state.Message = "正在重建隔离环境"
	m.state.UpdatedAt = time.Now().UTC()
	if err := m.persistLocked(); err != nil {
		return m.state, fmt.Errorf("persist resetting lab state: %w", err)
	}
	directory := m.juiceShopDirectory()
	environment := commandEnvironment(m.state.Port)
	output, err := m.runner.Run(ctx, filepath.Join(directory, "lab.sh"), []string{"reset"}, environment, directory)
	if err != nil {
		return m.failLocked("重置训练环境失败", output, err)
	}
	m.state.Phase = "ready"
	m.state.Message = strings.TrimSpace(string(output))
	m.state.UpdatedAt = time.Now().UTC()
	return m.state, m.persistLocked()
}

func (m *Manager) Stop(ctx context.Context) (State, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.state.PackageID == "" {
		return m.state, nil
	}
	directory := m.juiceShopDirectory()
	environment := commandEnvironment(m.state.Port)
	output, err := m.runner.Run(ctx, filepath.Join(directory, "lab.sh"), []string{"stop"}, environment, directory)
	if err != nil {
		return m.failLocked("停止训练环境失败", output, err)
	}
	m.state.Phase = "stopped"
	m.state.Message = "训练环境已停止，可再次启动"
	m.state.UpdatedAt = time.Now().UTC()
	return m.state, m.persistLocked()
}

func (m *Manager) Clean(ctx context.Context) (State, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.state.PackageID == "" {
		return m.state, nil
	}
	if m.state.PackageID != JuiceShopPackageID {
		return State{}, fmt.Errorf("unknown managed lab %q", m.state.PackageID)
	}
	if !m.state.Scope.ExpiresAt.IsZero() {
		decision := securitypolicy.Decide(m.state.Scope, securitypolicy.EffectRequest{
			Class: "modify", Target: securitypolicy.Target{
				Kind: securitypolicy.TargetLab, Value: JuiceShopPackageID,
			}, Approved: true,
		}, time.Now())
		if !decision.Allowed {
			return State{}, fmt.Errorf("lab cleanup denied: %s", decision.Reason)
		}
	}
	directory := m.juiceShopDirectory()
	environment := commandEnvironment(m.state.Port)
	output, err := m.runner.Run(ctx, filepath.Join(directory, "lab.sh"), []string{"clean"}, environment, directory)
	if err != nil {
		return m.failLocked("清理训练环境失败", output, err)
	}
	m.state = State{
		PackageID: JuiceShopPackageID,
		Phase:     "cleaned",
		Message:   "训练环境、容器和卷已清理",
		UpdatedAt: time.Now().UTC(),
	}
	return m.state, m.persistLocked()
}

func (m *Manager) installFixedFixtures() error {
	if err := fs.WalkDir(labs.Assets, "ctf/juice-shop", func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		destination := filepath.Join(m.root, path)
		if entry.IsDir() {
			return os.MkdirAll(destination, 0o700)
		}
		data, err := labs.Assets.ReadFile(path)
		if err != nil {
			return err
		}
		mode := os.FileMode(0o600)
		if filepath.Base(path) == "lab.sh" {
			mode = 0o700
		}
		return os.WriteFile(destination, data, mode)
	}); err != nil {
		return fmt.Errorf("install fixed lab fixtures: %w", err)
	}
	compose, err := os.ReadFile(filepath.Join(m.juiceShopDirectory(), "compose.yaml"))
	if err != nil {
		return err
	}
	text := string(compose)
	for _, required := range []string{"127.0.0.1:", "cap_drop:", "no-new-privileges:true", "pids_limit:", "@sha256:"} {
		if !strings.Contains(text, required) {
			return fmt.Errorf("fixed Juice Shop compose is missing security invariant %q", required)
		}
	}
	return nil
}

func (m *Manager) juiceShopDirectory() string {
	return filepath.Join(m.root, "ctf", "juice-shop")
}

func (m *Manager) failLocked(prefix string, output []byte, err error) (State, error) {
	m.state.Phase = "failed"
	m.state.Message = prefix + ": " + strings.TrimSpace(string(output))
	m.state.UpdatedAt = time.Now().UTC()
	_ = m.persistLocked()
	return m.state, fmt.Errorf("%s: %w", prefix, err)
}

func (m *Manager) persistLocked() error {
	data, err := json.MarshalIndent(m.state, "", "  ")
	if err != nil {
		return err
	}
	temporary, err := os.CreateTemp(m.root, ".lab-state-*")
	if err != nil {
		return err
	}
	name := temporary.Name()
	defer os.Remove(name)
	if err := temporary.Chmod(0o600); err != nil {
		_ = temporary.Close()
		return err
	}
	if _, err := temporary.Write(data); err != nil {
		_ = temporary.Close()
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	return os.Rename(name, m.statePath)
}

func availablePort() (int, error) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, fmt.Errorf("reserve loopback lab port: %w", err)
	}
	defer listener.Close()
	return listener.Addr().(*net.TCPAddr).Port, nil
}

func commandEnvironment(port int) []string {
	// Lab commands need Docker discovery and the selected local port, but must
	// not inherit model/provider credentials or unrelated application secrets.
	allowed := []string{
		"PATH", "HOME", "TMPDIR", "LANG", "LC_ALL",
		"DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_CONFIG", "XDG_RUNTIME_DIR",
	}
	environment := make([]string, 0, len(allowed)+1)
	for _, name := range allowed {
		if value, ok := os.LookupEnv(name); ok {
			environment = append(environment, name+"="+value)
		}
	}
	return append(environment, fmt.Sprintf("MILKSU_CTF_PORT=%d", port))
}
