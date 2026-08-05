package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/MilkSU-Official/milksu/internal/config"
	"github.com/MilkSU-Official/milksu/internal/ctf"
	"github.com/MilkSU-Official/milksu/internal/engine"
)

var errCTFAgentLoopDetected = errors.New("PI entered a no-progress CTF tool loop")

type ctfAgentSession struct {
	handoff              ctf.AgentWorkspaceHandoff
	status               string
	exitReason           string
	lastToolCall         string
	repeatedToolUse      int
	lastFailure          string
	repeatedToolFailures int
	lastAssistantSummary string
}

type ctfAgentRecorder struct {
	mu       sync.Mutex
	root     string
	sessions map[string]*ctfAgentSession
	jobs     *ctf.Service
	settings *config.Store
}

func newCTFAgentRecorder(root string, jobs *ctf.Service, settings *config.Store) *ctfAgentRecorder {
	return &ctfAgentRecorder{
		root:     root,
		sessions: make(map[string]*ctfAgentSession),
		jobs:     jobs,
		settings: settings,
	}
}

func (r *ctfAgentRecorder) Register(handoff ctf.AgentWorkspaceHandoff) error {
	checkpoint := ctf.AgentRunCheckpoint{Status: "ready"}
	if handoff.Role == ctf.AgentWorkspaceRoleSolver {
		var err error
		checkpoint, err = ctf.LoadAgentRunCheckpoint(handoff.WorkspacePath)
		if err != nil {
			if !errors.Is(err, os.ErrNotExist) {
				return err
			}
			checkpoint, err = ctf.PersistAgentRunCheckpoint(
				handoff.WorkspacePath,
				handoff,
				ctf.AgentRunSnapshot{Status: "ready"},
				time.Now().UTC(),
			)
			if err != nil {
				return err
			}
		}
	}
	r.mu.Lock()
	if existing := r.sessions[handoff.ConversationID]; existing != nil {
		existing.handoff = handoff
		if handoff.Role == ctf.AgentWorkspaceRoleSolver {
			existing.status = checkpoint.Status
			existing.exitReason = checkpoint.ExitReason
			existing.lastToolCall = checkpoint.LastToolFingerprint
			existing.repeatedToolUse = checkpoint.RepeatedToolUses
			existing.lastFailure = checkpoint.LastFailureFingerprint
			existing.repeatedToolFailures = checkpoint.RepeatedFailures
			existing.lastAssistantSummary = checkpoint.LastAssistantSummary
		}
	} else {
		r.sessions[handoff.ConversationID] = &ctfAgentSession{
			handoff:              handoff,
			status:               checkpoint.Status,
			exitReason:           checkpoint.ExitReason,
			lastToolCall:         checkpoint.LastToolFingerprint,
			repeatedToolUse:      checkpoint.RepeatedToolUses,
			lastFailure:          checkpoint.LastFailureFingerprint,
			repeatedToolFailures: checkpoint.RepeatedFailures,
			lastAssistantSummary: checkpoint.LastAssistantSummary,
		}
	}
	r.mu.Unlock()
	return nil
}

func (r *ctfAgentRecorder) AuthorizeTurn(
	ctx context.Context,
	sessionID, workspacePath string,
) error {
	session, err := r.resolveSession(sessionID, workspacePath)
	if err != nil || session == nil {
		return err
	}
	projection, err := r.jobs.GetJob(ctx, session.handoff.JobID)
	if err != nil {
		return err
	}
	status := ctf.EvaluateAgentSessionBudget(
		projection,
		session.handoff.ConversationID,
		session.handoff.Budget,
		time.Now(),
		session.handoff.Role == ctf.AgentWorkspaceRoleSolver,
	)
	switch status.Reason {
	case ctf.AgentBudgetReasonTurns:
		return fmt.Errorf(
			"CTF Agent 已达到 %d 回合预算；请先复盘或新建一次受控尝试",
			status.Budget.MaxTurns,
		)
	case ctf.AgentBudgetReasonWallTime:
		return fmt.Errorf(
			"CTF Agent 已达到 %d 分钟会话预算；请先复盘并由用户决定是否开启新尝试",
			status.Budget.MaxWallMinutes,
		)
	case ctf.AgentBudgetReasonWrongSubmissions:
		return fmt.Errorf(
			"CTF Agent 已达到 %d 次错误提交预算；禁止继续盲试",
			status.Budget.MaxWrongSubmissions,
		)
	}
	return nil
}

func (r *ctfAgentRecorder) resolveSession(
	sessionID, workspacePath string,
) (*ctfAgentSession, error) {
	if !strings.HasPrefix(sessionID, "ctf_") {
		return nil, nil
	}
	r.mu.Lock()
	existing := r.sessions[sessionID]
	r.mu.Unlock()
	if existing != nil {
		return existing, nil
	}

	absoluteRoot, err := filepath.Abs(r.root)
	if err != nil {
		return nil, err
	}
	absoluteWorkspace, err := filepath.Abs(workspacePath)
	if err != nil {
		return nil, err
	}
	relative, err := filepath.Rel(absoluteRoot, absoluteWorkspace)
	if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return nil, fmt.Errorf("CTF Agent workspace is outside MilkSU application data")
	}
	handoff, err := ctf.LoadAgentWorkspaceHandoff(absoluteWorkspace)
	if err != nil {
		return nil, err
	}
	if handoff.ConversationID != sessionID {
		roleHandoffs := []func(string) (ctf.AgentWorkspaceHandoff, error){
			ctf.LoadAgentToolBuilderHandoff,
			ctf.LoadAgentStrategistHandoff,
		}
		matched := false
		for _, loadRoleHandoff := range roleHandoffs {
			roleHandoff, roleErr := loadRoleHandoff(absoluteWorkspace)
			if roleErr != nil {
				return nil, roleErr
			}
			if roleHandoff.ConversationID == sessionID {
				handoff = roleHandoff
				matched = true
				break
			}
		}
		if !matched {
			return nil, fmt.Errorf("CTF Agent conversation does not match its workspace manifest")
		}
	}
	if err := r.Register(handoff); err != nil {
		return nil, err
	}
	r.mu.Lock()
	resolved := r.sessions[sessionID]
	r.mu.Unlock()
	return resolved, nil
}

func (r *ctfAgentRecorder) Record(ctx context.Context, event engine.Event) error {
	if event.SessionID == "" || event.Type == "assistant.delta" {
		return nil
	}
	r.mu.Lock()
	session := r.sessions[event.SessionID]
	if session == nil {
		r.mu.Unlock()
		return nil
	}
	handoff := session.handoff
	noProgressReason := session.applyEvent(event)
	data, err := json.Marshal(event)
	if err != nil {
		r.mu.Unlock()
		return fmt.Errorf("encode PI trajectory event: %w", err)
	}
	trajectoryName := "trajectory.jsonl"
	switch handoff.Role {
	case ctf.AgentWorkspaceRoleToolBuilder:
		trajectoryName = "tool-builder-trajectory.jsonl"
	case ctf.AgentWorkspaceRoleStrategist:
		trajectoryName = "strategist-trajectory.jsonl"
	}
	trajectoryPath := filepath.Join(handoff.WorkspacePath, "evidence", trajectoryName)
	file, err := os.OpenFile(trajectoryPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		r.mu.Unlock()
		return fmt.Errorf("open PI trajectory: %w", err)
	}
	data = append(data, '\n')
	if _, err := file.Write(data); err != nil {
		file.Close()
		r.mu.Unlock()
		return fmt.Errorf("append PI trajectory: %w", err)
	}
	if err := file.Sync(); err != nil {
		file.Close()
		r.mu.Unlock()
		return fmt.Errorf("sync PI trajectory: %w", err)
	}
	if err := file.Close(); err != nil {
		r.mu.Unlock()
		return fmt.Errorf("close PI trajectory: %w", err)
	}
	completed := event.Type == "assistant.completed"
	settings := r.settings.Get()
	model := strings.Trim(
		strings.TrimSpace(settings.ActiveProvider)+"/"+strings.TrimSpace(settings.ActiveModel),
		"/",
	)
	var checkpointErr error
	if handoff.Role == ctf.AgentWorkspaceRoleSolver {
		_, checkpointErr = ctf.PersistAgentRunCheckpoint(
			handoff.WorkspacePath,
			handoff,
			ctf.AgentRunSnapshot{
				Status:                 session.status,
				ExitReason:             session.exitReason,
				Model:                  model,
				LastToolFingerprint:    session.lastToolCall,
				RepeatedToolUses:       session.repeatedToolUse,
				LastFailureFingerprint: session.lastFailure,
				RepeatedFailures:       session.repeatedToolFailures,
				LastAssistantSummary:   session.lastAssistantSummary,
			},
			time.Now().UTC(),
		)
	}
	r.mu.Unlock()
	if checkpointErr != nil {
		return checkpointErr
	}
	if noProgressReason != "" {
		return fmt.Errorf("%w: %s", errCTFAgentLoopDetected, noProgressReason)
	}
	if handoff.Role == ctf.AgentWorkspaceRoleSolver {
		request, requested, requestErr := endpointRequestFromToolEvent(event)
		if requestErr != nil {
			return requestErr
		}
		if requested {
			if r.jobs == nil {
				return fmt.Errorf("CTF endpoint request recorder is unavailable")
			}
			if _, requestErr := r.jobs.RequestDynamicEndpoint(
				ctx,
				handoff.JobID,
				request,
				ctf.EndpointRequesterAgent,
			); requestErr != nil {
				return requestErr
			}
		}
	}
	if !completed {
		return nil
	}

	result, err := ctf.ReadAgentWorkspaceResult(handoff.WorkspacePath)
	switch handoff.Role {
	case ctf.AgentWorkspaceRoleToolBuilder:
		result, err = ctf.ReadAgentToolWorkspaceResult(handoff.WorkspacePath)
	case ctf.AgentWorkspaceRoleStrategist:
		result, err = ctf.ReadAgentStrategistWorkspaceResult(handoff.WorkspacePath)
	}
	if err != nil {
		return err
	}
	_, err = r.jobs.RecordCodingAgentTurn(
		ctx,
		handoff.JobID,
		handoff.ConversationID,
		model,
		event.Text,
		result.Trajectory,
	)
	if err != nil {
		return err
	}
	if handoff.Role != ctf.AgentWorkspaceRoleSolver {
		return nil
	}
	if result.Candidate == "" {
		return nil
	}
	explanation := "PI Coding Agent 在独立题目工作区中写入候选，并保存了可复现工具轨迹。"
	if result.Notes != "" {
		explanation += "\n\n" + result.Notes
	}
	if len([]rune(explanation)) > 2000 {
		explanation = string([]rune(explanation)[:2000])
	}
	_, err = r.jobs.RecordCodingAgentCandidate(
		ctx,
		handoff.JobID,
		handoff.ConversationID,
		strings.TrimSpace(result.Candidate),
		explanation,
	)
	return err
}

func endpointRequestFromToolEvent(
	event engine.Event,
) (ctf.EndpointRequestInput, bool, error) {
	if event.Type != "tool.completed" ||
		event.ToolName != "ctf_request_endpoint" ||
		strings.TrimSpace(event.Error) != "" {
		return ctf.EndpointRequestInput{}, false, nil
	}
	var result struct {
		Kind        string               `json:"kind"`
		Protocol    ctf.EndpointProtocol `json:"protocol"`
		Endpoint    string               `json:"endpoint"`
		Source      string               `json:"source"`
		Purpose     string               `json:"purpose"`
		RequestedBy string               `json:"requestedBy"`
		Status      string               `json:"status"`
	}
	if err := json.Unmarshal([]byte(event.Text), &result); err != nil ||
		result.Kind != "ctf_endpoint_request" ||
		result.RequestedBy != "agent" ||
		result.Status != "pending_user_approval" {
		return ctf.EndpointRequestInput{}, false, fmt.Errorf(
			"CTF Agent returned an invalid Endpoint authorization request",
		)
	}
	return ctf.EndpointRequestInput{
		Protocol: result.Protocol,
		Endpoint: result.Endpoint,
		Source:   result.Source,
		Purpose:  result.Purpose,
	}, true, nil
}

func (s *ctfAgentSession) applyEvent(event engine.Event) string {
	noProgressReason := ""
	switch event.Type {
	case "session.ready", "session.model_selected", "tool.started", "tool.completed":
		s.status = "running"
		s.exitReason = ""
	case "assistant.segment_completed":
		s.status = "running"
		s.exitReason = ""
		if summary := strings.TrimSpace(event.Text); summary != "" {
			s.lastAssistantSummary = summary
		}
	case "assistant.completed":
		s.status = "awaiting-user"
		s.exitReason = "turn-complete"
		s.lastAssistantSummary = strings.TrimSpace(event.Text)
	case "engine.error":
		s.status = "failed"
		s.exitReason = "engine-error"
	case "session.destroyed":
		if s.status != "failed" && s.status != "paused" {
			s.status = "paused"
			s.exitReason = "session-destroyed"
		}
	}

	if event.Type == "tool.started" {
		fingerprint := ctfAgentEventFingerprint(event.ToolName, event.Text)
		if fingerprint == s.lastToolCall {
			s.repeatedToolUse++
		} else {
			s.lastToolCall = fingerprint
			s.repeatedToolUse = 1
		}
		if s.repeatedToolUse >= 3 {
			noProgressReason = "same-tool-call-repeated"
		}
	}
	if event.Type == "tool.completed" {
		if strings.TrimSpace(event.Error) == "" {
			s.lastFailure = ""
			s.repeatedToolFailures = 0
		} else {
			fingerprint := ctfAgentEventFingerprint(event.ToolName, event.Error)
			if fingerprint == s.lastFailure {
				s.repeatedToolFailures++
			} else {
				s.lastFailure = fingerprint
				s.repeatedToolFailures = 1
			}
			if s.repeatedToolFailures >= 3 {
				noProgressReason = "same-tool-failure-repeated"
			}
		}
	}
	if noProgressReason != "" {
		s.status = "paused"
		s.exitReason = noProgressReason
	}
	if event.Type == "assistant.completed" {
		s.lastToolCall = ""
		s.repeatedToolUse = 0
		s.lastFailure = ""
		s.repeatedToolFailures = 0
	}
	return noProgressReason
}

func ctfAgentEventFingerprint(parts ...string) string {
	digest := sha256.Sum256([]byte(strings.Join(parts, "\x00")))
	return hex.EncodeToString(digest[:])
}
