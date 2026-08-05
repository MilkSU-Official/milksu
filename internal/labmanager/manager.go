package labmanager

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/MilkSU-Official/milksu/internal/securitypolicy"
	"github.com/MilkSU-Official/milksu/internal/securityruntime"
	"github.com/MilkSU-Official/milksu/labs"
	"github.com/google/uuid"
	"gopkg.in/yaml.v3"
)

const (
	JuiceShopPackageID = "owasp.juice-shop"
	WebGoatPackageID   = "owasp.webgoat"
	stateSchemaVersion = 1
	maxAccessBytes     = 8 * 1024
	maxJudgeBytes      = 1024 * 1024
)

type Definition struct {
	ID          string   `json:"id"`
	Title       string   `json:"title"`
	Version     string   `json:"version"`
	Role        string   `json:"role"`
	Categories  []string `json:"categories"`
	Description string   `json:"description"`
	License     string   `json:"license"`
	Challenge   string   `json:"challenge"`
	JudgeType   string   `json:"judgeType"`
	LaunchPath  string   `json:"launchPath"`
	AccessType  string   `json:"accessType,omitempty"`
}

type State struct {
	InstanceID      string                    `json:"instanceId"`
	PackageID       string                    `json:"packageId"`
	ProjectName     string                    `json:"projectName"`
	Phase           string                    `json:"phase"`
	Endpoint        string                    `json:"endpoint,omitempty"`
	Port            int                       `json:"port,omitempty"`
	Message         string                    `json:"message"`
	UpdatedAt       time.Time                 `json:"updatedAt"`
	Scope           securitypolicy.ScopeGrant `json:"scope"`
	PackageVersion  string                    `json:"packageVersion"`
	ImageDigest     string                    `json:"imageDigest"`
	RecoveryPending bool                      `json:"recoveryPending,omitempty"`
}

type JudgeResult struct {
	InstanceID    string    `json:"instanceId"`
	PackageID     string    `json:"packageId"`
	JudgeType     string    `json:"judgeType"`
	Challenge     string    `json:"challenge"`
	Completed     bool      `json:"completed"`
	Solved        bool      `json:"solved"`
	Summary       string    `json:"summary"`
	Reference     string    `json:"reference"`
	ReceiptSHA256 string    `json:"receiptSha256,omitempty"`
	CheckedAt     time.Time `json:"checkedAt"`
}

type Access struct {
	InstanceID string `json:"instanceId"`
	Type       string `json:"type"`
	Username   string `json:"username"`
	Password   string `json:"password"`
	LoginURL   string `json:"loginUrl"`
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

type installedPackage struct {
	manifest  securityruntime.LabPackage
	directory string
	script    string
}

type persistedState struct {
	Schema    int              `json:"schema"`
	Instances map[string]State `json:"instances"`
}

type Manager struct {
	mu        sync.Mutex
	root      string
	statePath string
	runner    commandRunner
	packages  map[string]installedPackage
	instances map[string]State
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
	manager := &Manager{
		root:      root,
		statePath: filepath.Join(root, "state.json"),
		runner:    runner,
		packages:  make(map[string]installedPackage),
		instances: make(map[string]State),
	}
	if err := manager.installFixedFixtures(); err != nil {
		return nil, err
	}
	changed, err := manager.loadState()
	if err != nil {
		return nil, err
	}
	if changed {
		if err := manager.persistLocked(); err != nil {
			return nil, fmt.Errorf("persist recovered lab state: %w", err)
		}
	}
	return manager, nil
}

func (m *Manager) Catalog() []Definition {
	m.mu.Lock()
	defer m.mu.Unlock()
	values := make([]Definition, 0, len(m.packages))
	for _, installed := range m.packages {
		manifest := installed.manifest
		values = append(values, Definition{
			ID:          manifest.Metadata.ID,
			Title:       manifest.Metadata.Title,
			Version:     manifest.Metadata.Version,
			Role:        manifest.Spec.Role,
			Categories:  append([]string{}, manifest.Spec.Categories...),
			Description: strings.Join(manifest.Spec.Learning.Objectives, "；"),
			License:     manifest.Metadata.License,
			Challenge:   manifest.Spec.Judge.Challenge,
			JudgeType:   manifest.Spec.Judge.Type,
			LaunchPath:  manifest.Spec.Runtime.Endpoints[0].LaunchPath,
			AccessType:  manifest.Spec.Access.Type,
		})
	}
	sort.Slice(values, func(i, j int) bool { return values[i].ID < values[j].ID })
	return values
}

func (m *Manager) ListInstances() []State {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.listInstancesLocked()
}

func (m *Manager) listInstancesLocked() []State {
	values := make([]State, 0, len(m.instances))
	for _, state := range m.instances {
		values = append(values, cloneState(state))
	}
	sort.Slice(values, func(i, j int) bool {
		if values[i].UpdatedAt.Equal(values[j].UpdatedAt) {
			return values[i].InstanceID < values[j].InstanceID
		}
		return values[i].UpdatedAt.After(values[j].UpdatedAt)
	})
	return values
}

func (m *Manager) Reconcile(ctx context.Context) ([]State, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	instanceIDs := make([]string, 0, len(m.instances))
	for instanceID := range m.instances {
		instanceIDs = append(instanceIDs, instanceID)
	}
	sort.Strings(instanceIDs)

	changed := false
	for _, instanceID := range instanceIDs {
		state := m.instances[instanceID]
		if state.Phase != "orphaned" || !state.RecoveryPending {
			continue
		}
		installed, exists := m.packages[state.PackageID]
		if !exists {
			continue
		}
		expectedEndpoint, _, endpointErr := publishedEndpoint(installed.manifest, state.Port)
		if endpointErr != nil ||
			!validProjectName(state.ProjectName) ||
			state.Port < 1024 || state.Port > 65535 ||
			state.Endpoint != expectedEndpoint ||
			state.PackageVersion != installed.manifest.Metadata.Version ||
			state.ImageDigest != installed.manifest.Metadata.Source.Digest {
			state.Message = "遗留训练环境身份信息不完整或与当前训练包不匹配；请清理后重新创建"
			state.UpdatedAt = time.Now().UTC()
			m.instances[instanceID] = state
			changed = true
			continue
		}
		if err := m.validateInstanceStateDirectory(state.InstanceID); err != nil {
			state.Message = "遗留训练环境的实例私有状态不可用；可停止或清理: " + err.Error()
			state.UpdatedAt = time.Now().UTC()
			m.instances[instanceID] = state
			changed = true
			continue
		}
		if err := m.validatePackageAccess(state, installed); err != nil {
			state.Message = "遗留训练环境的登录状态不可用；可停止或清理: " + err.Error()
			state.UpdatedAt = time.Now().UTC()
			m.instances[instanceID] = state
			changed = true
			continue
		}

		environment := m.commandEnvironment(state)
		statusOutput, statusErr := m.runLifecycle(ctx, installed, "status", environment)
		healthOutput := []byte(nil)
		healthErr := error(nil)
		if statusErr == nil && strings.TrimSpace(string(statusOutput)) != "" {
			healthOutput, healthErr = m.runLifecycle(ctx, installed, "health", environment)
		}
		state.UpdatedAt = time.Now().UTC()
		if statusErr == nil && strings.TrimSpace(string(statusOutput)) != "" && healthErr == nil {
			state.Phase = "ready"
			state.RecoveryPending = false
			state.Message = strings.TrimSpace(string(healthOutput))
			if state.Message == "" {
				state.Message = "已恢复并确认训练环境健康"
			}
		} else {
			detail := strings.TrimSpace(string(healthOutput))
			if statusErr != nil || strings.TrimSpace(string(statusOutput)) == "" {
				detail = strings.TrimSpace(string(statusOutput))
			}
			state.Message = "遗留训练环境未通过状态与健康检查；可停止或清理"
			if detail != "" {
				state.Message += ": " + detail
			}
		}
		m.instances[instanceID] = state
		changed = true
	}
	if changed {
		if err := m.persistLocked(); err != nil {
			return m.listInstancesLocked(), fmt.Errorf("persist reconciled lab state: %w", err)
		}
	}
	return m.listInstancesLocked(), nil
}

func (m *Manager) Status(instanceID string) (State, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	state, exists := m.instances[instanceID]
	if !exists {
		return State{}, fmt.Errorf("unknown managed lab instance %q", instanceID)
	}
	return cloneState(state), nil
}

func (m *Manager) Start(ctx context.Context, packageID string) (State, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	installed, exists := m.packages[packageID]
	if !exists {
		return State{}, fmt.Errorf("unknown managed lab %q", packageID)
	}
	port, err := availablePort()
	if err != nil {
		return State{}, err
	}
	instanceID := uuid.NewString()
	projectName := projectNameFor(instanceID)
	endpoint, target, err := publishedEndpoint(installed.manifest, port)
	if err != nil {
		return State{}, err
	}
	grant, err := securitypolicy.NewGrant("managed-lab:"+instanceID, "ctf training", []securitypolicy.Target{
		{Kind: securitypolicy.TargetLab, Value: instanceID},
		target,
	}, 12*time.Hour)
	if err != nil {
		return State{}, err
	}
	state := State{
		InstanceID:     instanceID,
		PackageID:      packageID,
		ProjectName:    projectName,
		Phase:          "acquiring",
		Port:           port,
		Message:        "正在校验并获取固定镜像",
		UpdatedAt:      time.Now().UTC(),
		Scope:          grant,
		PackageVersion: installed.manifest.Metadata.Version,
		ImageDigest:    installed.manifest.Metadata.Source.Digest,
	}
	if err := m.prepareInstanceStateDirectory(instanceID); err != nil {
		return State{}, fmt.Errorf("prepare managed lab private state: %w", err)
	}
	m.instances[instanceID] = state
	if err := m.persistLocked(); err != nil {
		return cloneState(state), fmt.Errorf("persist acquiring lab state: %w", err)
	}

	environment := m.commandEnvironment(state)
	if output, runErr := m.runLifecycle(ctx, installed, "pull", environment); runErr != nil {
		return m.failLocked(instanceID, "获取固定镜像失败", output, runErr)
	}
	state = m.instances[instanceID]
	state.Phase = "starting"
	state.Message = "正在启动并等待健康检查"
	state.UpdatedAt = time.Now().UTC()
	m.instances[instanceID] = state
	if err := m.persistLocked(); err != nil {
		return cloneState(state), fmt.Errorf("persist starting lab state: %w", err)
	}

	output, runErr := m.runLifecycle(ctx, installed, "start", environment)
	if runErr != nil {
		return m.failLocked(instanceID, "启动训练环境失败", output, runErr)
	}
	if err := m.validatePackageAccess(state, installed); err != nil {
		return m.failLocked(instanceID, "初始化训练环境登录状态失败", nil, err)
	}
	state = m.instances[instanceID]
	state.Phase = "ready"
	state.Endpoint = endpoint
	state.Message = strings.TrimSpace(string(output))
	state.UpdatedAt = time.Now().UTC()
	state.RecoveryPending = false
	m.instances[instanceID] = state
	if err := m.persistLocked(); err != nil {
		return cloneState(state), err
	}
	return cloneState(state), nil
}

func (m *Manager) Reset(ctx context.Context, instanceID string) (State, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	state, installed, err := m.resolveInstance(instanceID)
	if err != nil {
		return State{}, err
	}
	if state.Phase != "ready" {
		return State{}, fmt.Errorf("managed lab instance %q is not ready", instanceID)
	}
	decision := securitypolicy.Decide(state.Scope, securitypolicy.EffectRequest{
		Class: "modify", Target: securitypolicy.Target{Kind: securitypolicy.TargetLab, Value: instanceID}, Approved: true,
	}, time.Now())
	if !decision.Allowed {
		return State{}, fmt.Errorf("lab reset denied: %s", decision.Reason)
	}
	state.Phase = "resetting"
	state.Message = "正在重建隔离环境"
	state.UpdatedAt = time.Now().UTC()
	m.instances[instanceID] = state
	if err := m.persistLocked(); err != nil {
		return cloneState(state), fmt.Errorf("persist resetting lab state: %w", err)
	}
	if err := m.resetInstanceStateDirectory(instanceID); err != nil {
		return m.failLocked(instanceID, "重置实例私有状态失败", nil, err)
	}
	output, runErr := m.runLifecycle(ctx, installed, "reset", m.commandEnvironment(state))
	if runErr != nil {
		return m.failLocked(instanceID, "重置训练环境失败", output, runErr)
	}
	if err := m.validatePackageAccess(state, installed); err != nil {
		return m.failLocked(instanceID, "重置训练环境登录状态失败", nil, err)
	}
	state = m.instances[instanceID]
	state.Phase = "ready"
	state.Message = strings.TrimSpace(string(output))
	state.UpdatedAt = time.Now().UTC()
	state.RecoveryPending = false
	m.instances[instanceID] = state
	if err := m.persistLocked(); err != nil {
		return cloneState(state), err
	}
	return cloneState(state), nil
}

func (m *Manager) Judge(ctx context.Context, instanceID string) (JudgeResult, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	state, installed, err := m.resolveInstance(instanceID)
	if err != nil {
		return JudgeResult{}, err
	}
	if state.Phase != "ready" {
		return JudgeResult{}, fmt.Errorf("managed lab instance %q is not ready", instanceID)
	}
	decision := securitypolicy.Decide(state.Scope, securitypolicy.EffectRequest{
		Class: "read_local", Target: securitypolicy.Target{Kind: securitypolicy.TargetOrigin, Value: state.Endpoint},
	}, time.Now())
	if !decision.Allowed {
		return JudgeResult{}, fmt.Errorf("lab judge denied: %s", decision.Reason)
	}

	judge := installed.manifest.Spec.Judge
	result := JudgeResult{
		InstanceID: instanceID,
		PackageID:  state.PackageID,
		JudgeType:  judge.Type,
		Challenge:  judge.Challenge,
		Reference:  strings.TrimRight(state.Endpoint, "/") + judge.Endpoint,
		CheckedAt:  time.Now().UTC(),
	}
	switch judge.Type {
	case "application-oracle":
		if judge.ResponseContract == "json-assignment-set" {
			solved, summary, receiptSHA256, judgeErr := m.judgeAssignmentSet(ctx, state, installed)
			if judgeErr != nil {
				return result, judgeErr
			}
			result.Completed = true
			result.Solved = solved
			result.Summary = summary
			result.ReceiptSHA256 = receiptSHA256
			return result, nil
		}
		output, runErr := m.runLifecycle(ctx, installed, "judge", m.commandEnvironment(state), judge.Challenge)
		result.Summary = strings.TrimSpace(string(output))
		if runErr == nil {
			result.Completed = true
			result.Solved = true
			if result.Summary == "" {
				result.Summary = "题目已通过应用内权威状态确认"
			}
			return result, nil
		}
		var exitStatus interface{ ExitCode() int }
		if errors.As(runErr, &exitStatus) && exitStatus.ExitCode() == 1 {
			result.Completed = true
			result.Solved = false
			if result.Summary == "" {
				result.Summary = "题目尚未完成"
			}
			return result, nil
		}
		return result, fmt.Errorf("run lab judge: %w", runErr)
	default:
		return result, fmt.Errorf("unsupported managed lab judge type %q", judge.Type)
	}
}

func (m *Manager) Stop(ctx context.Context, instanceID string) (State, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	state, installed, err := m.resolveInstance(instanceID)
	if err != nil {
		return State{}, err
	}
	if state.Phase == "stopped" || state.Phase == "cleaned" {
		return cloneState(state), nil
	}
	recovering := state.RecoveryPending || state.Phase == "orphaned"
	state.Phase = "stopping"
	state.Message = "正在停止训练环境"
	state.UpdatedAt = time.Now().UTC()
	m.instances[instanceID] = state
	if err := m.persistLocked(); err != nil {
		return cloneState(state), fmt.Errorf("persist stopping lab state: %w", err)
	}
	output, runErr := m.runLifecycle(ctx, installed, "stop", m.commandEnvironment(state))
	if runErr != nil {
		return m.failLocked(instanceID, "停止训练环境失败", output, runErr)
	}
	state = m.instances[instanceID]
	state.Phase = "stopped"
	state.Message = "训练环境已停止"
	state.UpdatedAt = time.Now().UTC()
	state.RecoveryPending = recovering
	m.instances[instanceID] = state
	if err := m.persistLocked(); err != nil {
		return cloneState(state), err
	}
	return cloneState(state), nil
}

func (m *Manager) Clean(ctx context.Context, instanceID string) (State, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	state, installed, err := m.resolveInstance(instanceID)
	if err != nil {
		return State{}, err
	}
	if state.Phase == "cleaned" {
		if err := m.removeInstanceStateDirectory(instanceID); err != nil {
			return cloneState(state), fmt.Errorf("remove cleaned lab private state: %w", err)
		}
		return cloneState(state), nil
	}
	state.Phase = "cleaning"
	state.Message = "正在清理训练环境、容器和卷"
	state.UpdatedAt = time.Now().UTC()
	m.instances[instanceID] = state
	if err := m.persistLocked(); err != nil {
		return cloneState(state), fmt.Errorf("persist cleaning lab state: %w", err)
	}
	output, runErr := m.runLifecycle(ctx, installed, "clean", m.commandEnvironment(state))
	if runErr != nil {
		return m.failLocked(instanceID, "清理训练环境失败", output, runErr)
	}
	if err := m.removeInstanceStateDirectory(instanceID); err != nil {
		return m.failLocked(instanceID, "清理实例私有状态失败", nil, err)
	}
	state = m.instances[instanceID]
	state.Phase = "cleaned"
	state.Endpoint = ""
	state.Port = 0
	state.Message = "训练环境、容器和卷已清理"
	state.UpdatedAt = time.Now().UTC()
	state.Scope = securitypolicy.ScopeGrant{}
	state.RecoveryPending = false
	m.instances[instanceID] = state
	if err := m.persistLocked(); err != nil {
		return cloneState(state), err
	}
	return cloneState(state), nil
}

func (m *Manager) Access(instanceID string) (Access, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	state, installed, err := m.resolveInstance(instanceID)
	if err != nil {
		return Access{}, err
	}
	if state.Phase != "ready" {
		return Access{}, fmt.Errorf("managed lab instance %q is not ready", instanceID)
	}
	credentials, err := m.readAccessCredentials(state, installed)
	if err != nil {
		return Access{}, err
	}
	return Access{
		InstanceID: state.InstanceID,
		Type:       installed.manifest.Spec.Access.Type,
		Username:   credentials.Username,
		Password:   credentials.Password,
		LoginURL:   strings.TrimRight(state.Endpoint, "/") + installed.manifest.Spec.Access.LoginPath,
	}, nil
}

func (m *Manager) LaunchURL(instanceID string) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	state, installed, err := m.resolveInstance(instanceID)
	if err != nil {
		return "", err
	}
	if state.Phase != "ready" {
		return "", fmt.Errorf("managed lab instance %q is not ready", instanceID)
	}
	base, err := url.Parse(state.Endpoint)
	if err != nil {
		return "", fmt.Errorf("parse managed lab endpoint: %w", err)
	}
	launchPath := installed.manifest.Spec.Runtime.Endpoints[0].LaunchPath
	if launchPath == "" {
		launchPath = "/"
	}
	relative, err := url.Parse(launchPath)
	if err != nil {
		return "", fmt.Errorf("parse managed lab launch path: %w", err)
	}
	return base.ResolveReference(relative).String(), nil
}

func (m *Manager) installFixedFixtures() error {
	for _, fixtureRoot := range []string{"ctf/juice-shop", "ctf/webgoat"} {
		if err := fs.WalkDir(labs.Assets, fixtureRoot, func(sourcePath string, entry fs.DirEntry, walkErr error) error {
			if walkErr != nil {
				return walkErr
			}
			destination := filepath.Join(m.root, sourcePath)
			if entry.IsDir() {
				return os.MkdirAll(destination, 0o700)
			}
			data, err := labs.Assets.ReadFile(sourcePath)
			if err != nil {
				return err
			}
			mode := os.FileMode(0o600)
			if filepath.Base(sourcePath) == "lab.sh" {
				mode = 0o700
			}
			return os.WriteFile(destination, data, mode)
		}); err != nil {
			return fmt.Errorf("install fixed lab fixture %q: %w", fixtureRoot, err)
		}
		if err := m.registerPackage(filepath.Join(m.root, fixtureRoot)); err != nil {
			return err
		}
	}
	return nil
}

func (m *Manager) registerPackage(directory string) error {
	manifestData, err := os.ReadFile(filepath.Join(directory, "lab.yaml"))
	if err != nil {
		return fmt.Errorf("read managed lab package: %w", err)
	}
	manifest, err := securityruntime.ParseLabPackage(manifestData)
	if err != nil {
		return fmt.Errorf("validate managed lab package: %w", err)
	}
	entryPath := filepath.Join(directory, filepath.FromSlash(manifest.Spec.Runtime.Entry))
	compose, err := os.ReadFile(entryPath)
	if err != nil {
		return fmt.Errorf("read managed lab runtime entry: %w", err)
	}
	if err := verifyComposeContract(manifest, string(compose)); err != nil {
		return err
	}
	script := filepath.Join(directory, "lab.sh")
	info, err := os.Stat(script)
	if err != nil || info.Mode()&0o111 == 0 {
		return fmt.Errorf("managed lab lifecycle script is missing or not executable")
	}
	if _, exists := m.packages[manifest.Metadata.ID]; exists {
		return fmt.Errorf("duplicate managed lab package %q", manifest.Metadata.ID)
	}
	m.packages[manifest.Metadata.ID] = installedPackage{manifest: manifest, directory: directory, script: script}
	return nil
}

func verifyComposeContract(manifest securityruntime.LabPackage, compose string) error {
	type serviceContract struct {
		Image       string   `yaml:"image"`
		Privileged  bool     `yaml:"privileged"`
		NetworkMode string   `yaml:"network_mode"`
		Ports       []string `yaml:"ports"`
		Volumes     []string `yaml:"volumes"`
		CapDrop     []string `yaml:"cap_drop"`
		SecurityOpt []string `yaml:"security_opt"`
		PidsLimit   int      `yaml:"pids_limit"`
		Networks    []string `yaml:"networks"`
	}
	type networkContract struct {
		Internal bool `yaml:"internal"`
	}
	var contract struct {
		Services map[string]serviceContract `yaml:"services"`
		Networks map[string]networkContract `yaml:"networks"`
	}
	if err := yaml.Unmarshal([]byte(compose), &contract); err != nil {
		return fmt.Errorf("decode managed lab compose: %w", err)
	}
	if len(manifest.Spec.Runtime.Endpoints) != 1 {
		return fmt.Errorf("v1alpha1 manager requires exactly one published endpoint")
	}
	endpoint := manifest.Spec.Runtime.Endpoints[0]
	if _, exists := contract.Services[endpoint.Service]; !exists {
		return fmt.Errorf("managed lab compose is missing published service %q", endpoint.Service)
	}
	pinnedImage := manifest.Metadata.Source.Image + "@" + manifest.Metadata.Source.Digest
	for name, service := range contract.Services {
		if service.Image != pinnedImage {
			return fmt.Errorf("managed lab service %q does not use the contract-pinned image", name)
		}
		if service.Privileged || service.NetworkMode == "host" || len(service.Volumes) != 0 {
			return fmt.Errorf("managed lab service %q requests forbidden runtime access", name)
		}
		if !containsString(service.CapDrop, "ALL") || !containsString(service.SecurityOpt, "no-new-privileges:true") || service.PidsLimit < 1 {
			return fmt.Errorf("managed lab service %q is missing containment limits", name)
		}

		internalNetwork := false
		externalNetwork := false
		for _, networkName := range service.Networks {
			network, exists := contract.Networks[networkName]
			if !exists {
				return fmt.Errorf("managed lab service %q references unknown network %q", name, networkName)
			}
			if network.Internal {
				internalNetwork = true
			} else {
				externalNetwork = true
			}
		}
		if !internalNetwork {
			return fmt.Errorf("managed lab service %q is not attached to an internal network", name)
		}
		if name == endpoint.Service {
			wantPort := fmt.Sprintf("127.0.0.1:${MILKSU_CTF_PORT:-3000}:%d", endpoint.TargetPort)
			if len(service.Ports) != 1 || service.Ports[0] != wantPort {
				return fmt.Errorf("managed lab published service must use one loopback port")
			}
		} else if len(service.Ports) != 0 || externalNetwork {
			return fmt.Errorf("managed lab workload service %q must remain internal and unpublished", name)
		}
	}
	return nil
}

func containsString(values []string, wanted string) bool {
	for _, value := range values {
		if value == wanted {
			return true
		}
	}
	return false
}

func (m *Manager) loadState() (bool, error) {
	data, err := os.ReadFile(m.statePath)
	if errors.Is(err, os.ErrNotExist) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("read lab state: %w", err)
	}

	var stored persistedState
	if err := json.Unmarshal(data, &stored); err != nil {
		return false, fmt.Errorf("decode lab state: %w", err)
	}
	changed := false
	if stored.Schema == stateSchemaVersion && stored.Instances != nil {
		for key, state := range stored.Instances {
			if state.InstanceID == "" {
				state.InstanceID = key
				changed = true
			}
			if state.InstanceID != key {
				return false, fmt.Errorf("lab state key does not match instance id %q", key)
			}
			if _, err := uuid.Parse(state.InstanceID); err != nil {
				return false, fmt.Errorf("lab state contains invalid instance id %q", state.InstanceID)
			}
			if _, exists := m.packages[state.PackageID]; !exists {
				state.Phase = "orphaned"
				state.Message = "本地训练包不可用；需清理遗留运行时"
				state.RecoveryPending = true
				changed = true
			}
			if phaseNeedsRecovery(state.Phase) {
				state.Phase = "orphaned"
				state.Message = "检测到上次运行遗留的训练环境；请先停止或清理"
				state.RecoveryPending = true
				state.UpdatedAt = time.Now().UTC()
				changed = true
			}
			m.instances[key] = state
		}
		return changed, nil
	}

	// Migrate the pre-v1 single-instance state file without losing the local
	// project that may still own a Docker container.
	var legacy State
	if err := json.Unmarshal(data, &legacy); err != nil || legacy.PackageID == "" {
		return false, fmt.Errorf("unsupported lab state schema")
	}
	if legacy.InstanceID == "" {
		legacy.InstanceID = uuid.NewString()
	}
	if legacy.ProjectName == "" {
		legacy.ProjectName = "milksu-ctf-juice-shop"
	}
	if installed, exists := m.packages[legacy.PackageID]; exists {
		if legacy.PackageVersion == "" {
			legacy.PackageVersion = installed.manifest.Metadata.Version
		}
		if legacy.ImageDigest == "" {
			legacy.ImageDigest = installed.manifest.Metadata.Source.Digest
		}
	}
	legacy.Phase = "orphaned"
	legacy.Message = "已迁移旧训练环境状态；请先停止或清理"
	legacy.RecoveryPending = true
	legacy.UpdatedAt = time.Now().UTC()
	m.instances[legacy.InstanceID] = legacy
	return true, nil
}

func phaseNeedsRecovery(phase string) bool {
	switch phase {
	case "acquiring", "starting", "ready", "resetting", "stopping", "cleaning":
		return true
	default:
		return false
	}
}

func (m *Manager) resolveInstance(instanceID string) (State, installedPackage, error) {
	state, exists := m.instances[instanceID]
	if !exists {
		return State{}, installedPackage{}, fmt.Errorf("unknown managed lab instance %q", instanceID)
	}
	installed, exists := m.packages[state.PackageID]
	if !exists {
		return State{}, installedPackage{}, fmt.Errorf("managed lab package %q is unavailable", state.PackageID)
	}
	if state.ProjectName == "" {
		return State{}, installedPackage{}, fmt.Errorf("managed lab instance %q has no isolated project", instanceID)
	}
	return state, installed, nil
}

func (m *Manager) runLifecycle(ctx context.Context, installed installedPackage, action string, environment []string, arguments ...string) ([]byte, error) {
	commandArguments := append([]string{action}, arguments...)
	return m.runner.Run(ctx, installed.script, commandArguments, environment, installed.directory)
}

func (m *Manager) failLocked(instanceID, prefix string, output []byte, runErr error) (State, error) {
	state := m.instances[instanceID]
	state.Phase = "failed"
	state.Message = prefix
	if detail := strings.TrimSpace(string(output)); detail != "" {
		state.Message += ": " + detail
	}
	state.UpdatedAt = time.Now().UTC()
	state.RecoveryPending = true
	m.instances[instanceID] = state
	_ = m.persistLocked()
	return cloneState(state), fmt.Errorf("%s: %w", prefix, runErr)
}

func (m *Manager) persistLocked() error {
	data, err := json.MarshalIndent(persistedState{Schema: stateSchemaVersion, Instances: m.instances}, "", "  ")
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
	if err := temporary.Sync(); err != nil {
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

func projectNameFor(instanceID string) string {
	compact := strings.ReplaceAll(instanceID, "-", "")
	if len(compact) > 12 {
		compact = compact[:12]
	}
	return "milksu-lab-" + strings.ToLower(compact)
}

func validProjectName(value string) bool {
	if value == "" || len(value) > 63 {
		return false
	}
	for index, character := range value {
		if character >= 'a' && character <= 'z' || character >= '0' && character <= '9' ||
			index > 0 && (character == '_' || character == '-') {
			continue
		}
		return false
	}
	return true
}

func publishedEndpoint(manifest securityruntime.LabPackage, port int) (string, securitypolicy.Target, error) {
	if len(manifest.Spec.Runtime.Endpoints) != 1 {
		return "", securitypolicy.Target{}, fmt.Errorf("v1alpha1 manager requires exactly one published endpoint")
	}
	endpoint := manifest.Spec.Runtime.Endpoints[0]
	switch endpoint.Protocol {
	case "http", "https":
		value := fmt.Sprintf("%s://127.0.0.1:%d", endpoint.Protocol, port)
		return value, securitypolicy.Target{Kind: securitypolicy.TargetOrigin, Value: value}, nil
	case "tcp":
		value := net.JoinHostPort("127.0.0.1", fmt.Sprint(port))
		return value, securitypolicy.Target{Kind: securitypolicy.TargetSocket, Value: value}, nil
	default:
		return "", securitypolicy.Target{}, fmt.Errorf("unsupported published endpoint protocol %q", endpoint.Protocol)
	}
}

func (m *Manager) commandEnvironment(state State) []string {
	// Lab commands need Docker discovery and the selected local port/project,
	// but must not inherit model/provider credentials or application secrets.
	allowed := []string{
		"PATH", "HOME", "TMPDIR", "LANG", "LC_ALL",
		"DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_CONFIG", "XDG_RUNTIME_DIR",
	}
	environment := make([]string, 0, len(allowed)+3)
	for _, name := range allowed {
		if value, ok := os.LookupEnv(name); ok {
			environment = append(environment, name+"="+value)
		}
	}
	environment = append(environment, fmt.Sprintf("MILKSU_CTF_PORT=%d", state.Port))
	environment = append(environment, "MILKSU_LAB_PROJECT_ID="+state.ProjectName)
	return append(environment, "MILKSU_LAB_STATE_DIR="+m.instanceStateDirectory(state.InstanceID))
}

type accessCredentials struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

func (m *Manager) validatePackageAccess(state State, installed installedPackage) error {
	if installed.manifest.Spec.Access.Type == "" {
		return nil
	}
	_, err := m.readAccessCredentials(state, installed)
	return err
}

func (m *Manager) readAccessCredentials(
	state State,
	installed installedPackage,
) (accessCredentials, error) {
	access := installed.manifest.Spec.Access
	if access.Type == "" {
		return accessCredentials{}, fmt.Errorf("managed lab does not require a login")
	}
	path := filepath.Join(m.instanceStateDirectory(state.InstanceID), access.StateFile)
	file, err := os.Open(path)
	if err != nil {
		return accessCredentials{}, fmt.Errorf("read managed lab access: %w", err)
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, maxAccessBytes+1))
	if err != nil {
		return accessCredentials{}, fmt.Errorf("read managed lab access: %w", err)
	}
	if len(data) > maxAccessBytes {
		return accessCredentials{}, fmt.Errorf("managed lab access file is too large")
	}
	info, err := file.Stat()
	if err != nil {
		return accessCredentials{}, err
	}
	if info.Mode().Perm() != 0o600 {
		return accessCredentials{}, fmt.Errorf("managed lab access file permissions are %04o, want 0600", info.Mode().Perm())
	}
	decoder := json.NewDecoder(strings.NewReader(string(data)))
	decoder.DisallowUnknownFields()
	var credentials accessCredentials
	if err := decoder.Decode(&credentials); err != nil {
		return accessCredentials{}, fmt.Errorf("decode managed lab access: %w", err)
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		return accessCredentials{}, fmt.Errorf("managed lab access must contain one JSON object")
	}
	if !validEphemeralCredential(credentials.Username, 64) ||
		!validEphemeralCredential(credentials.Password, 128) {
		return accessCredentials{}, fmt.Errorf("managed lab access contains invalid credentials")
	}
	return credentials, nil
}

func validEphemeralCredential(value string, maxLength int) bool {
	if value == "" || len(value) > maxLength {
		return false
	}
	for _, character := range value {
		if character >= 'a' && character <= 'z' ||
			character >= 'A' && character <= 'Z' ||
			character >= '0' && character <= '9' ||
			character == '_' || character == '-' {
			continue
		}
		return false
	}
	return true
}

func (m *Manager) judgeAssignmentSet(
	ctx context.Context,
	state State,
	installed installedPackage,
) (bool, string, string, error) {
	credentials, err := m.readAccessCredentials(state, installed)
	if err != nil {
		return false, "", "", err
	}
	origin, err := url.Parse(state.Endpoint)
	if err != nil || origin.Scheme != "http" || origin.Hostname() != "127.0.0.1" || origin.Port() == "" {
		return false, "", "", fmt.Errorf("managed lab judge requires an exact loopback HTTP origin")
	}
	jar, err := cookiejar.New(nil)
	if err != nil {
		return false, "", "", err
	}
	dialer := &net.Dialer{Timeout: 10 * time.Second}
	transport := &http.Transport{
		Proxy: nil,
		DialContext: func(dialContext context.Context, network, address string) (net.Conn, error) {
			if address != origin.Host {
				return nil, fmt.Errorf("managed lab judge denied non-origin address %q", address)
			}
			return dialer.DialContext(dialContext, "tcp", address)
		},
	}
	defer transport.CloseIdleConnections()
	client := &http.Client{
		Transport: transport,
		Jar:       jar,
		Timeout:   30 * time.Second,
		CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}

	loginURL := strings.TrimRight(state.Endpoint, "/") + installed.manifest.Spec.Access.LoginPath
	form := url.Values{
		"username": []string{credentials.Username},
		"password": []string{credentials.Password},
	}
	loginRequest, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		loginURL,
		strings.NewReader(form.Encode()),
	)
	if err != nil {
		return false, "", "", err
	}
	loginRequest.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	loginResponse, err := client.Do(loginRequest)
	if err != nil {
		return false, "", "", fmt.Errorf("managed lab judge login: %w", err)
	}
	_, loginReadErr := readBoundedHTTPBody(loginResponse, 64*1024)
	loginResponse.Body.Close()
	if loginReadErr != nil {
		return false, "", "", loginReadErr
	}
	if loginResponse.StatusCode != http.StatusFound && loginResponse.StatusCode != http.StatusSeeOther {
		return false, "", "", fmt.Errorf("managed lab judge login returned HTTP %d", loginResponse.StatusCode)
	}

	judgeURL := strings.TrimRight(state.Endpoint, "/") + installed.manifest.Spec.Judge.Endpoint
	judgeRequest, err := http.NewRequestWithContext(ctx, http.MethodGet, judgeURL, nil)
	if err != nil {
		return false, "", "", err
	}
	judgeRequest.Header.Set("Accept", "application/json")
	judgeResponse, err := client.Do(judgeRequest)
	if err != nil {
		return false, "", "", fmt.Errorf("managed lab judge request: %w", err)
	}
	body, bodyErr := readBoundedHTTPBody(judgeResponse, maxJudgeBytes)
	judgeResponse.Body.Close()
	if bodyErr != nil {
		return false, "", "", bodyErr
	}
	if judgeResponse.StatusCode != http.StatusOK {
		return false, "", "", fmt.Errorf("managed lab judge returned HTTP %d", judgeResponse.StatusCode)
	}

	var receipt []struct {
		Assignment struct {
			Name string `json:"name"`
		} `json:"assignment"`
		Solved bool `json:"solved"`
	}
	if err := json.Unmarshal(body, &receipt); err != nil {
		return false, "", "", fmt.Errorf("decode managed lab judge receipt: %w", err)
	}
	expected := installed.manifest.Spec.Judge.ExpectedAssignments
	if len(receipt) != len(expected) {
		return false, "", "", fmt.Errorf(
			"managed lab judge assignment count drifted: got %d, want %d",
			len(receipt),
			len(expected),
		)
	}
	expectedSet := make(map[string]struct{}, len(expected))
	for _, name := range expected {
		expectedSet[name] = struct{}{}
	}
	seen := make(map[string]struct{}, len(receipt))
	solvedCount := 0
	for _, item := range receipt {
		name := item.Assignment.Name
		if _, exists := expectedSet[name]; !exists {
			return false, "", "", fmt.Errorf("managed lab judge returned unexpected assignment %q", name)
		}
		if _, exists := seen[name]; exists {
			return false, "", "", fmt.Errorf("managed lab judge returned duplicate assignment %q", name)
		}
		seen[name] = struct{}{}
		if item.Solved {
			solvedCount++
		}
	}
	digest := sha256.Sum256(body)
	summary := fmt.Sprintf(
		"应用内进度确认：%d/%d 个固定课节完成",
		solvedCount,
		len(expected),
	)
	return solvedCount == len(expected), summary, hex.EncodeToString(digest[:]), nil
}

func readBoundedHTTPBody(response *http.Response, limit int64) ([]byte, error) {
	data, err := io.ReadAll(io.LimitReader(response.Body, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > limit {
		return nil, fmt.Errorf("managed lab HTTP response exceeds %d bytes", limit)
	}
	return data, nil
}

func (m *Manager) instanceStateDirectory(instanceID string) string {
	return filepath.Join(m.root, "instances", instanceID)
}

func (m *Manager) prepareInstanceStateDirectory(instanceID string) error {
	if _, err := uuid.Parse(instanceID); err != nil {
		return fmt.Errorf("invalid managed lab instance id")
	}
	base := filepath.Join(m.root, "instances")
	if err := os.MkdirAll(base, 0o700); err != nil {
		return err
	}
	if err := os.Chmod(base, 0o700); err != nil {
		return err
	}
	directory := m.instanceStateDirectory(instanceID)
	if err := os.Mkdir(directory, 0o700); err != nil && !errors.Is(err, os.ErrExist) {
		return err
	}
	info, err := os.Lstat(directory)
	if err != nil {
		return err
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return fmt.Errorf("managed lab private state is not a directory")
	}
	return os.Chmod(directory, 0o700)
}

func (m *Manager) validateInstanceStateDirectory(instanceID string) error {
	if _, err := uuid.Parse(instanceID); err != nil {
		return fmt.Errorf("invalid instance id")
	}
	info, err := os.Lstat(m.instanceStateDirectory(instanceID))
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return fmt.Errorf("private state directory is missing")
		}
		return err
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return fmt.Errorf("private state path is not a directory")
	}
	if info.Mode().Perm() != 0o700 {
		return fmt.Errorf("private state directory permissions are %04o, want 0700", info.Mode().Perm())
	}
	return nil
}

func (m *Manager) resetInstanceStateDirectory(instanceID string) error {
	if err := m.removeInstanceStateDirectory(instanceID); err != nil {
		return err
	}
	return m.prepareInstanceStateDirectory(instanceID)
}

func (m *Manager) removeInstanceStateDirectory(instanceID string) error {
	if _, err := uuid.Parse(instanceID); err != nil {
		return fmt.Errorf("invalid managed lab instance id")
	}
	return os.RemoveAll(m.instanceStateDirectory(instanceID))
}

func cloneState(state State) State {
	state.Scope.Targets = append([]securitypolicy.Target{}, state.Scope.Targets...)
	return state
}
