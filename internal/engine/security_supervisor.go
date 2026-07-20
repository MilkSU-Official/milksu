package engine

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"
	"sync"

	"github.com/MilkSU-Official/milksu/internal/config"
	"github.com/MilkSU-Official/milksu/internal/securityruntime"
)

type securityBridgeResponse struct {
	RequestID string `json:"requestId"`
	Type      string `json:"type"`
	Error     string `json:"error"`
	Action    struct {
		Capability string          `json:"capability"`
		Name       string          `json:"name"`
		Input      json.RawMessage `json:"input"`
		Rationale  string          `json:"rationale"`
	} `json:"action"`
}

type SecuritySupervisor struct {
	mu       sync.Mutex
	process  *childProcess
	pending  map[string]chan securityBridgeResponse
	settings func() config.AppSettings
	closed   bool
}

func NewSecuritySupervisor(settings func() config.AppSettings) (*SecuritySupervisor, error) {
	if settings == nil {
		return nil, fmt.Errorf("security engine settings provider is required")
	}
	return &SecuritySupervisor{
		pending: make(map[string]chan securityBridgeResponse), settings: settings,
	}, nil
}

func (s *SecuritySupervisor) Name() string { return "pi-security-adapter" }

func (s *SecuritySupervisor) Model() string {
	return s.settings().ActiveModel
}

func (s *SecuritySupervisor) Propose(ctx context.Context, input securityruntime.EngineInput) (securityruntime.ActionProposal, error) {
	if input.Attempt.ID == "" || input.Step.ID == "" || len(input.RoleState) == 0 || strings.TrimSpace(input.RolePrompt) == "" {
		return securityruntime.ActionProposal{}, fmt.Errorf("security engine requires attempt, step, role prompt, and role state")
	}
	settings := s.settings()
	requestID := securityruntime.NewIdentifier("engine-request")
	responseChannel := make(chan securityBridgeResponse, 1)
	command := map[string]any{
		"action": "propose", "requestId": requestID,
		"attemptId": input.Attempt.ID, "rolePrompt": input.RolePrompt,
		"roleState": json.RawMessage(input.RoleState),
		"provider":  settings.ActiveProvider, "model": settings.ActiveModel,
	}

	s.mu.Lock()
	if err := s.ensureProcessLocked(settings); err != nil {
		s.mu.Unlock()
		return securityruntime.ActionProposal{}, err
	}
	s.pending[requestID] = responseChannel
	if err := writeCommand(s.process.stdin, command); err != nil {
		delete(s.pending, requestID)
		s.mu.Unlock()
		return securityruntime.ActionProposal{}, fmt.Errorf("send security engine proposal: %w", err)
	}
	s.mu.Unlock()

	select {
	case <-ctx.Done():
		s.mu.Lock()
		delete(s.pending, requestID)
		if s.process != nil {
			_ = writeCommand(s.process.stdin, map[string]any{
				"action": "abort_attempt", "attemptId": input.Attempt.ID,
			})
		}
		s.mu.Unlock()
		return securityruntime.ActionProposal{}, ctx.Err()
	case response := <-responseChannel:
		if response.Error != "" || response.Type == "error" {
			if response.Error == "" {
				response.Error = "security engine returned an unspecified error"
			}
			return securityruntime.ActionProposal{}, errors.New(response.Error)
		}
		if response.Type != "proposal" || response.Action.Capability == "" || response.Action.Name == "" || len(response.Action.Input) == 0 {
			return securityruntime.ActionProposal{}, fmt.Errorf("invalid security engine response %q", response.Type)
		}
		return securityruntime.ActionProposal{
			Capability: response.Action.Capability,
			Name:       response.Action.Name,
			Input:      response.Action.Input,
			Rationale:  response.Action.Rationale,
		}, nil
	}
}

func (s *SecuritySupervisor) CloseAttempt(_ context.Context, attemptID string) error {
	if strings.TrimSpace(attemptID) == "" {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.process == nil {
		return nil
	}
	return writeCommand(s.process.stdin, map[string]any{
		"action": "close_attempt", "attemptId": attemptID,
	})
}

func (s *SecuritySupervisor) Close() {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return
	}
	s.closed = true
	process := s.process
	s.process = nil
	pending := s.pending
	s.pending = make(map[string]chan securityBridgeResponse)
	s.mu.Unlock()

	for _, channel := range pending {
		channel <- securityBridgeResponse{Type: "error", Error: "security engine closed"}
	}
	if process == nil {
		return
	}
	_ = process.stdin.Close()
	if process.command.Process != nil {
		_ = process.command.Process.Kill()
	}
}

// Restart drops credentials and in-memory Pi sessions without making the
// adapter unusable. The next proposal starts a fresh process from Settings.
func (s *SecuritySupervisor) Restart() {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return
	}
	process := s.process
	s.process = nil
	pending := s.pending
	s.pending = make(map[string]chan securityBridgeResponse)
	s.mu.Unlock()
	for _, channel := range pending {
		channel <- securityBridgeResponse{Type: "error", Error: "security engine restarted after settings changed"}
	}
	if process == nil {
		return
	}
	_ = process.stdin.Close()
	if process.command.Process != nil {
		_ = process.command.Process.Kill()
	}
}

func (s *SecuritySupervisor) ensureProcessLocked(settings config.AppSettings) error {
	if s.closed {
		return fmt.Errorf("security engine is closed")
	}
	if s.process != nil {
		return nil
	}
	command, err := newSidecarCommand("security-bridge.cjs", "security-bridge.js")
	if err != nil {
		return err
	}
	command.Env = sidecarEnvironment(settings, command.Dir)
	command.Stderr = os.Stderr
	stdin, err := command.StdinPipe()
	if err != nil {
		return fmt.Errorf("open security engine stdin: %w", err)
	}
	stdout, err := command.StdoutPipe()
	if err != nil {
		_ = stdin.Close()
		return fmt.Errorf("open security engine stdout: %w", err)
	}
	if err := command.Start(); err != nil {
		_ = stdin.Close()
		return fmt.Errorf("start Pi security sidecar: %w", err)
	}
	process := &childProcess{command: command, stdin: stdin}
	s.process = process
	go s.readSecurityResponses(process, stdout)
	return nil
}

func (s *SecuritySupervisor) readSecurityResponses(process *childProcess, stdout io.Reader) {
	scanner := bufio.NewScanner(stdout)
	scanner.Buffer(make([]byte, 64*1024), 4*1024*1024)
	for scanner.Scan() {
		var response securityBridgeResponse
		if err := json.Unmarshal(scanner.Bytes(), &response); err != nil {
			continue
		}
		if response.RequestID == "" {
			continue
		}
		s.mu.Lock()
		channel := s.pending[response.RequestID]
		if channel != nil {
			delete(s.pending, response.RequestID)
		}
		s.mu.Unlock()
		if channel != nil {
			channel <- response
		}
	}

	waitErr := process.command.Wait()
	errText := "security engine stopped"
	if waitErr != nil {
		errText = waitErr.Error()
	}
	if scanErr := scanner.Err(); scanErr != nil {
		errText = scanErr.Error()
	}
	s.mu.Lock()
	if s.process != process {
		s.mu.Unlock()
		return
	}
	s.process = nil
	pending := s.pending
	s.pending = make(map[string]chan securityBridgeResponse)
	s.mu.Unlock()
	for _, channel := range pending {
		channel <- securityBridgeResponse{Type: "error", Error: errText}
	}
}
