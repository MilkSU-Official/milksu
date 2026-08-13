package securitytools

import (
	"context"
	"fmt"
	"path/filepath"
	"sync"
	"time"

	"github.com/MilkSU-Official/milksu/internal/config"
)

type settingsStore interface {
	Get() config.AppSettings
	SetSecurityToolEnabled(id string, enabled bool) error
}

type Service struct {
	root     string
	settings settingsStore
	probe    commandProbe
	emit     func(SetupSnapshot)

	mu     sync.RWMutex
	setups map[string]SetupSnapshot
}

func NewService(dataDirectory string, settings settingsStore, emit func(SetupSnapshot)) *Service {
	return &Service{
		root:     filepath.Join(dataDirectory, "security-tools"),
		settings: settings,
		probe:    systemProbe{},
		emit:     emit,
		setups:   make(map[string]SetupSnapshot),
	}
}

func (s *Service) List(ctx context.Context) []ToolSnapshot {
	preferences := s.settings.Get().SecurityTools
	result := make([]ToolSnapshot, 0, len(catalog))
	for _, item := range catalog {
		detected := s.detect(ctx, item.id)
		enabled := true
		if preference, ok := preferences[item.id]; ok {
			enabled = preference.Enabled
		}
		if setup, ok := s.setup(item.id); ok && setup.State == "running" {
			detected.status = StatusConfiguring
			detected.statusLabel = "正在配置"
			detected.action = ""
		}
		usable := enabled && detected.status == StatusReady && item.codingSupported
		result = append(result, ToolSnapshot{
			ID: item.id, Name: item.name, Purpose: item.purpose,
			Status: detected.status, StatusLabel: detected.statusLabel,
			Enabled: enabled, UsableByAgent: usable, Version: detected.version,
			Connection: item.connection, Runtime: item.runtime,
			Capabilities: append([]string(nil), item.capabilities...),
			Schema:       append([]string(nil), item.schema...),
			Problem:      detected.problem, PrimaryAction: detected.action,
			SetupSupported:  item.setupSupported && detected.setupPossible,
			CodingSupported: item.codingSupported,
		})
	}
	return result
}

func (s *Service) SetEnabled(id string, enabled bool) error {
	if !knownTool(id) {
		return fmt.Errorf("unknown security tool %q", id)
	}
	return s.settings.SetSecurityToolEnabled(id, enabled)
}

func (s *Service) SetupStatus(id string) (SetupSnapshot, error) {
	if !knownTool(id) {
		return SetupSnapshot{}, fmt.Errorf("unknown security tool %q", id)
	}
	if setup, ok := s.setup(id); ok {
		return setup, nil
	}
	return SetupSnapshot{ToolID: id, State: "idle", Summary: "尚未开始配置"}, nil
}

func (s *Service) StartSetup(ctx context.Context, id string) (SetupSnapshot, error) {
	if id != ToolIDA && id != ToolCapa {
		return SetupSnapshot{}, fmt.Errorf("%s does not have a reviewed automatic setup", id)
	}
	if current, ok := s.setup(id); ok && current.State == "running" {
		return current, nil
	}
	detected := s.detect(ctx, id)
	if detected.status == StatusReady {
		now := time.Now().UTC()
		ready := SetupSnapshot{
			ToolID: id, State: "completed", Percent: 100,
			Summary: "工具已经可用", StartedAt: now, CompletedAt: &now,
		}
		s.setSetup(ready)
		return ready, nil
	}
	if !detected.setupPossible {
		return SetupSnapshot{}, fmt.Errorf("%s", detected.problem)
	}
	setup := initialSetup(id)
	s.setSetup(setup)
	go s.runSetup(context.WithoutCancel(ctx), id)
	return setup, nil
}

func (s *Service) Check(ctx context.Context, id string) (ToolSnapshot, error) {
	for _, snapshot := range s.List(ctx) {
		if snapshot.ID == id {
			return snapshot, nil
		}
	}
	return ToolSnapshot{}, fmt.Errorf("unknown security tool %q", id)
}

func (s *Service) RuntimeTools(ctx context.Context) []RuntimeTool {
	preferences := s.settings.Get().SecurityTools
	result := make([]RuntimeTool, 0, 2)
	for _, item := range []definition{catalog[0], catalog[1]} {
		if preference, ok := preferences[item.id]; ok && !preference.Enabled {
			continue
		}
		detected := s.detect(ctx, item.id)
		if detected.status != StatusReady || detected.command == "" {
			continue
		}
		result = append(result, RuntimeTool{
			ID: item.id, Command: detected.command, Version: detected.version,
			ProfilePath: detected.profilePath, IDAPath: detected.idaPath,
			UserIDAPath:  detected.userIDAPath,
			Capabilities: append([]string(nil), item.capabilities...),
		})
	}
	return result
}

func (s *Service) CodingHandoff(ctx context.Context, id string) (CodingHandoff, error) {
	if !knownTool(id) {
		return CodingHandoff{}, fmt.Errorf("unknown security tool %q", id)
	}
	detected := s.detect(ctx, id)
	name := id
	for _, item := range catalog {
		if item.id == id {
			name = item.name
			break
		}
	}
	prompt := fmt.Sprintf(
		"帮我准备 MilkSU 的 %s 本机能力。先检测当前系统和已有安装；只使用官方来源与固定版本，不要修改项目业务代码。完成后运行最小健康检查，并告诉我 MilkSU 设置页还需要重新检测什么。当前检测结果：%s。",
		name,
		detected.statusLabel,
	)
	if detected.problem != "" {
		prompt += " 检测说明：" + detected.problem
	}
	return CodingHandoff{
		ToolID: id, Title: "配置 " + name, Prompt: prompt,
		VisibleText: "检查并准备 " + name + "，完成一次最小健康检查。",
	}, nil
}

func knownTool(id string) bool {
	for _, item := range catalog {
		if item.id == id {
			return true
		}
	}
	return false
}

func (s *Service) setup(id string) (SetupSnapshot, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	value, ok := s.setups[id]
	return cloneSetup(value), ok
}

func (s *Service) setSetup(value SetupSnapshot) {
	s.mu.Lock()
	s.setups[value.ToolID] = cloneSetup(value)
	s.mu.Unlock()
	if s.emit != nil {
		s.emit(cloneSetup(value))
	}
}

func cloneSetup(value SetupSnapshot) SetupSnapshot {
	value.Steps = append([]SetupStep(nil), value.Steps...)
	return value
}
