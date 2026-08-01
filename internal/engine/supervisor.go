package engine

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/MilkSU-Official/milksu/internal/config"
)

const eventSchemaVersion = 1

const defaultTurnActivityTimeout = 90 * time.Second

type Event struct {
	SchemaVersion  int                      `json:"schemaVersion"`
	Engine         string                   `json:"engine"`
	SessionID      string                   `json:"sessionId,omitempty"`
	Type           string                   `json:"type"`
	Timestamp      string                   `json:"timestamp"`
	Text           string                   `json:"text,omitempty"`
	ToolName       string                   `json:"toolName,omitempty"`
	Error          string                   `json:"error,omitempty"`
	Done           bool                     `json:"done,omitempty"`
	Tools          []string                 `json:"tools,omitempty"`
	Extensions     []string                 `json:"extensions,omitempty"`
	Skills         []string                 `json:"skills,omitempty"`
	ExecutionMode  string                   `json:"executionMode,omitempty"`
	ApprovalPolicy string                   `json:"approvalPolicy,omitempty"`
	Capabilities   []CodingCapabilityStatus `json:"capabilities,omitempty"`
	RequestID      string                   `json:"requestId,omitempty"`
	Input          string                   `json:"input,omitempty"`
	Reason         string                   `json:"reason,omitempty"`
	Approved       *bool                    `json:"approved,omitempty"`
}

type RuntimeStatus struct {
	DefaultEngine string `json:"defaultEngine"`
	Running       bool   `json:"running"`
	SessionCount  int    `json:"sessionCount"`
	Protocol      string `json:"protocol"`
	Workspace     string `json:"workspace,omitempty"`
}

type ModelProbeResult struct {
	Provider  string `json:"provider"`
	Model     string `json:"model"`
	Ready     bool   `json:"ready"`
	LatencyMS int64  `json:"latencyMs"`
}

type CodingCapabilityStatus struct {
	ID     string `json:"id"`
	Label  string `json:"label"`
	Status string `json:"status"`
	Detail string `json:"detail"`
}

type CodingPolicy struct {
	ExecutionMode  string `json:"executionMode"`
	ApprovalPolicy string `json:"approvalPolicy"`
}

type bridgeEvent struct {
	Type           string                   `json:"type"`
	ID             string                   `json:"id"`
	Delta          string                   `json:"delta"`
	Content        string                   `json:"content"`
	Error          string                   `json:"error"`
	ToolName       string                   `json:"toolName"`
	IsError        bool                     `json:"isError"`
	Tools          []string                 `json:"tools"`
	Extensions     []string                 `json:"extensions"`
	Skills         []string                 `json:"skills"`
	ExecutionMode  string                   `json:"executionMode"`
	ApprovalPolicy string                   `json:"approvalPolicy"`
	Capabilities   []CodingCapabilityStatus `json:"capabilities"`
	RequestID      string                   `json:"requestId"`
	Input          string                   `json:"input"`
	Reason         string                   `json:"reason"`
	Approved       *bool                    `json:"approved"`
}

type childProcess struct {
	command   *exec.Cmd
	stdin     io.WriteCloser
	workspace string
}

type Supervisor struct {
	mu           sync.Mutex
	probeMu      sync.Mutex
	process      *childProcess
	sessions     map[string]struct{}
	probeWaiters map[string]chan Event
	turnTimeout  time.Duration
	turnTimers   map[string]*time.Timer
	turnSequence map[string]uint64
	approvals    map[string]int
	emit         func(Event)
}

func NewSupervisor(emit func(Event)) *Supervisor {
	return &Supervisor{
		sessions:     make(map[string]struct{}),
		probeWaiters: make(map[string]chan Event),
		turnTimeout:  defaultTurnActivityTimeout,
		turnTimers:   make(map[string]*time.Timer),
		turnSequence: make(map[string]uint64),
		approvals:    make(map[string]int),
		emit:         emit,
	}
}

func normalizeCodingPolicy(
	executionMode,
	approvalPolicy,
	sessionRole string,
) (CodingPolicy, error) {
	if strings.TrimSpace(sessionRole) != "" {
		return CodingPolicy{}, nil
	}
	execution := strings.TrimSpace(executionMode)
	if execution == "" {
		execution = "go"
	}
	if execution != "plan" && execution != "go" {
		return CodingPolicy{}, fmt.Errorf("unsupported Coding execution mode %q", execution)
	}
	approval := strings.TrimSpace(approvalPolicy)
	if approval == "" {
		approval = "workspace-auto"
	}
	switch approval {
	case "read-only", "ask", "workspace-auto", "full-auto":
	default:
		return CodingPolicy{}, fmt.Errorf("unsupported Coding approval policy %q", approval)
	}
	return CodingPolicy{
		ExecutionMode:  execution,
		ApprovalPolicy: approval,
	}, nil
}

func (s *Supervisor) SendMessage(
	sessionID,
	prompt,
	workspacePath string,
	sessionRole string,
	executionMode string,
	approvalPolicy string,
	settings config.AppSettings,
) error {
	if strings.TrimSpace(sessionID) == "" {
		return fmt.Errorf("session id is required")
	}
	if strings.TrimSpace(prompt) == "" {
		return fmt.Errorf("prompt is required")
	}
	codingPolicy, err := normalizeCodingPolicy(
		executionMode,
		approvalPolicy,
		sessionRole,
	)
	if err != nil {
		return err
	}
	if err := validateModelAccess(settings); err != nil {
		return err
	}
	workspace, err := resolveAgentWorkspace(workspacePath)
	if err != nil {
		return err
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.ensureProcessLocked(settings, workspace); err != nil {
		return err
	}

	if err := writeCommand(s.process.stdin, map[string]any{
		"action":         "send_message",
		"conversationId": sessionID,
		"prompt":         prompt,
		"provider":       settings.ActiveProvider,
		"model":          settings.ActiveModel,
		"sessionRole":    strings.TrimSpace(sessionRole),
		"executionMode":  codingPolicy.ExecutionMode,
		"approvalPolicy": codingPolicy.ApprovalPolicy,
	}); err != nil {
		return fmt.Errorf("send engine message: %w", err)
	}
	s.sessions[sessionID] = struct{}{}
	s.armTurnTimerLocked(sessionID)
	return nil
}

func (s *Supervisor) AbortMessage(sessionID string) error {
	if strings.TrimSpace(sessionID) == "" {
		return fmt.Errorf("session id is required")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.process == nil {
		return nil
	}
	return writeCommand(s.process.stdin, map[string]any{
		"action":         "abort_session",
		"conversationId": sessionID,
	})
}

func (s *Supervisor) RespondToolApproval(
	sessionID,
	requestID string,
	approved bool,
) error {
	if strings.TrimSpace(sessionID) == "" {
		return fmt.Errorf("session id is required")
	}
	if strings.TrimSpace(requestID) == "" {
		return fmt.Errorf("approval request id is required")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.process == nil {
		return fmt.Errorf("PI Sidecar is not running")
	}
	if _, exists := s.sessions[sessionID]; !exists {
		return fmt.Errorf("PI session not found: %s", sessionID)
	}
	return writeCommand(s.process.stdin, map[string]any{
		"action":         "approval_response",
		"conversationId": sessionID,
		"requestId":      requestID,
		"approved":       approved,
	})
}

func (s *Supervisor) ProbeModel(settings config.AppSettings) (ModelProbeResult, error) {
	if err := validateModelAccess(settings); err != nil {
		return ModelProbeResult{}, err
	}

	sessionID := fmt.Sprintf("milksu_model_probe_%d", time.Now().UnixNano())
	events := make(chan Event, 16)
	s.probeMu.Lock()
	s.probeWaiters[sessionID] = events
	s.probeMu.Unlock()
	defer func() {
		s.DestroySession(sessionID)
		s.probeMu.Lock()
		delete(s.probeWaiters, sessionID)
		s.probeMu.Unlock()
	}()

	startedAt := time.Now()
	if err := s.SendMessage(
		sessionID,
		"Reply with exactly OK. Do not call tools.",
		"",
		"",
		"",
		"",
		settings,
	); err != nil {
		return ModelProbeResult{}, err
	}

	timer := time.NewTimer(45 * time.Second)
	defer timer.Stop()
	for {
		select {
		case event := <-events:
			switch event.Type {
			case "assistant.completed":
				return ModelProbeResult{
					Provider:  settings.ActiveProvider,
					Model:     settings.ActiveModel,
					Ready:     true,
					LatencyMS: time.Since(startedAt).Milliseconds(),
				}, nil
			case "engine.error", "engine.stopped", "engine.protocol_error":
				return ModelProbeResult{}, fmt.Errorf(
					"PI model verification failed: %s",
					probeFailureMessage(event),
				)
			}
		case <-timer.C:
			_ = s.AbortMessage(sessionID)
			return ModelProbeResult{}, fmt.Errorf("PI model verification timed out after 45 seconds")
		}
	}
}

func (s *Supervisor) DestroySession(sessionID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.process != nil {
		_ = writeCommand(s.process.stdin, map[string]any{
			"action":          "destroy_session",
			"conversationId":  sessionID,
			"deletePersisted": true,
		})
	}
	s.stopTurnTimerLocked(sessionID)
	delete(s.sessions, sessionID)
	delete(s.approvals, sessionID)
}

func (s *Supervisor) Status() RuntimeStatus {
	s.mu.Lock()
	defer s.mu.Unlock()
	status := RuntimeStatus{
		DefaultEngine: "pi",
		Running:       s.process != nil,
		SessionCount:  len(s.sessions),
		Protocol:      "jsonl-stdio/v1alpha1",
	}
	if s.process != nil {
		status.Workspace = s.process.workspace
	}
	return status
}

func (s *Supervisor) Close() {
	s.mu.Lock()
	process := s.process
	s.process = nil
	s.sessions = make(map[string]struct{})
	s.stopAllTurnTimersLocked()
	s.approvals = make(map[string]int)
	s.mu.Unlock()

	if process == nil {
		return
	}
	_ = process.stdin.Close()
	if process.command.Process != nil {
		_ = process.command.Process.Kill()
	}
}

func (s *Supervisor) ensureProcessLocked(settings config.AppSettings, workspace string) error {
	if s.process != nil && s.process.workspace == workspace {
		return nil
	}
	if s.process != nil {
		previous := s.process
		s.process = nil
		s.sessions = make(map[string]struct{})
		s.stopAllTurnTimersLocked()
		s.approvals = make(map[string]int)
		_ = previous.stdin.Close()
		if previous.command.Process != nil {
			_ = previous.command.Process.Kill()
		}
	}
	command, err := newSidecarCommandAt("chat-bridge.cjs", "bridge.js", workspace, true)
	if err != nil {
		return err
	}
	command.Env, err = sidecarEnvironment(settings)
	if err != nil {
		return err
	}
	command.Env = withSidecarRuntimePath(command.Env, command.Path)
	command.Env, err = withWorkspaceTemporaryDirectory(command.Env, workspace)
	if err != nil {
		return err
	}
	command.Stderr = os.Stderr

	stdin, err := command.StdinPipe()
	if err != nil {
		return fmt.Errorf("open engine stdin: %w", err)
	}
	stdout, err := command.StdoutPipe()
	if err != nil {
		stdin.Close()
		return fmt.Errorf("open engine stdout: %w", err)
	}
	if err := command.Start(); err != nil {
		stdin.Close()
		return fmt.Errorf("start Pi sidecar: %w", err)
	}

	process := &childProcess{command: command, stdin: stdin, workspace: workspace}
	s.process = process
	go s.readEvents(process, stdout)
	s.emitEvent(Event{Engine: "pi", Type: "engine.started"})
	return nil
}

func (s *Supervisor) readEvents(process *childProcess, stdout io.Reader) {
	scanner := bufio.NewScanner(stdout)
	buffer := make([]byte, 64*1024)
	scanner.Buffer(buffer, 4*1024*1024)
	for scanner.Scan() {
		var raw bridgeEvent
		if err := json.Unmarshal(scanner.Bytes(), &raw); err != nil {
			s.emitEvent(Event{Engine: "pi", Type: "engine.protocol_error", Error: err.Error()})
			continue
		}
		event := normalizeBridgeEvent(raw)
		s.observeTurnEvent(event)
		if raw.ID != "" && (raw.Type == "error" || raw.Type == "session_destroyed") {
			s.mu.Lock()
			delete(s.sessions, raw.ID)
			s.mu.Unlock()
		}
		s.emitEvent(event)
	}

	waitError := process.command.Wait()
	s.mu.Lock()
	current := s.process == process
	if s.process == process {
		s.process = nil
		s.sessions = make(map[string]struct{})
		s.stopAllTurnTimersLocked()
		s.approvals = make(map[string]int)
	}
	s.mu.Unlock()
	if !current {
		return
	}

	errorText := ""
	if waitError != nil {
		errorText = waitError.Error()
	}
	if scanError := scanner.Err(); scanError != nil {
		errorText = scanError.Error()
	}
	s.emitEvent(Event{Engine: "pi", Type: "engine.stopped", Error: errorText, Done: true})
}

func (s *Supervisor) observeTurnEvent(event Event) {
	if event.SessionID == "" {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	switch event.Type {
	case "assistant.completed", "engine.error", "session.destroyed":
		s.stopTurnTimerLocked(event.SessionID)
		delete(s.approvals, event.SessionID)
	case "approval.requested":
		s.approvals[event.SessionID]++
		s.stopTurnTimerLocked(event.SessionID)
	case "approval.resolved":
		if s.approvals[event.SessionID] > 1 {
			s.approvals[event.SessionID]--
		} else {
			delete(s.approvals, event.SessionID)
			if _, exists := s.sessions[event.SessionID]; exists {
				s.armTurnTimerLocked(event.SessionID)
			}
		}
	case "session.ready", "session.policy_updated", "session.model_selected", "assistant.delta", "assistant.segment_completed", "tool.started", "tool.completed":
		if _, exists := s.turnTimers[event.SessionID]; exists &&
			s.approvals[event.SessionID] == 0 {
			s.armTurnTimerLocked(event.SessionID)
		}
	}
}

func (s *Supervisor) armTurnTimerLocked(sessionID string) {
	if timer := s.turnTimers[sessionID]; timer != nil {
		timer.Stop()
	}
	timeout := s.turnTimeout
	if timeout <= 0 {
		timeout = defaultTurnActivityTimeout
	}
	s.turnSequence[sessionID]++
	sequence := s.turnSequence[sessionID]
	s.turnTimers[sessionID] = time.AfterFunc(timeout, func() {
		s.handleTurnTimeout(sessionID, sequence, timeout)
	})
}

func (s *Supervisor) stopTurnTimerLocked(sessionID string) {
	if timer := s.turnTimers[sessionID]; timer != nil {
		timer.Stop()
		delete(s.turnTimers, sessionID)
	}
	s.turnSequence[sessionID]++
}

func (s *Supervisor) stopAllTurnTimersLocked() {
	for sessionID, timer := range s.turnTimers {
		timer.Stop()
		delete(s.turnTimers, sessionID)
		s.turnSequence[sessionID]++
	}
}

func (s *Supervisor) handleTurnTimeout(
	sessionID string,
	sequence uint64,
	timeout time.Duration,
) {
	s.mu.Lock()
	if s.turnSequence[sessionID] != sequence || s.turnTimers[sessionID] == nil {
		s.mu.Unlock()
		return
	}
	delete(s.turnTimers, sessionID)
	s.turnSequence[sessionID]++
	process := s.process
	if process != nil {
		_ = writeCommand(process.stdin, map[string]any{
			"action":         "abort_session",
			"conversationId": sessionID,
		})
	}
	s.mu.Unlock()
	s.emitEvent(Event{
		Engine:    "pi",
		SessionID: sessionID,
		Type:      "engine.error",
		Error: fmt.Sprintf(
			"Agent turn produced no model or tool activity for %s and was stopped; retry to resume from the persisted workspace",
			timeout.Round(time.Second),
		),
		Done: true,
	})
}

func (s *Supervisor) emitEvent(event Event) {
	event.SchemaVersion = eventSchemaVersion
	event.Timestamp = time.Now().UTC().Format(time.RFC3339Nano)
	s.deliverProbeEvent(event)
	if s.emit != nil {
		s.emit(event)
	}
}

func (s *Supervisor) deliverProbeEvent(event Event) {
	s.probeMu.Lock()
	defer s.probeMu.Unlock()
	if event.SessionID != "" {
		if waiter := s.probeWaiters[event.SessionID]; waiter != nil {
			select {
			case waiter <- event:
			default:
			}
		}
		return
	}
	if event.Type != "engine.stopped" && event.Type != "engine.protocol_error" {
		return
	}
	for _, waiter := range s.probeWaiters {
		select {
		case waiter <- event:
		default:
		}
	}
}

func probeFailureMessage(event Event) string {
	message := strings.TrimSpace(event.Error)
	if message == "" {
		message = strings.TrimSpace(event.Text)
	}
	if message == "" {
		return event.Type
	}
	if line, _, found := strings.Cut(message, "\n"); found {
		message = line
	}
	message = strings.TrimSpace(strings.TrimPrefix(message, "Error:"))
	if len(message) > 320 {
		message = message[:320] + "..."
	}
	return message
}

func normalizeBridgeEvent(raw bridgeEvent) Event {
	event := Event{
		Engine:         "pi",
		SessionID:      raw.ID,
		Text:           raw.Content,
		ToolName:       raw.ToolName,
		Tools:          raw.Tools,
		Extensions:     raw.Extensions,
		Skills:         raw.Skills,
		ExecutionMode:  raw.ExecutionMode,
		ApprovalPolicy: raw.ApprovalPolicy,
		Capabilities:   raw.Capabilities,
		RequestID:      raw.RequestID,
		Input:          raw.Input,
		Reason:         raw.Reason,
		Approved:       raw.Approved,
	}
	switch raw.Type {
	case "ready":
		event.Type = "session.ready"
	case "policy_updated":
		event.Type = "session.policy_updated"
	case "model_selected":
		event.Type = "session.model_selected"
	case "text_delta":
		event.Type = "assistant.delta"
		event.Text = raw.Delta
	case "message_done":
		event.Type = "assistant.completed"
		event.Done = true
	case "message_segment_done":
		event.Type = "assistant.segment_completed"
		event.Done = true
	case "tool_call_start":
		event.Type = "tool.started"
	case "tool_call_end":
		event.Type = "tool.completed"
		event.Done = true
		if raw.IsError {
			event.Error = raw.Content
		}
	case "approval_requested":
		event.Type = "approval.requested"
	case "approval_resolved":
		event.Type = "approval.resolved"
		event.Done = true
	case "session_destroyed":
		event.Type = "session.destroyed"
		event.Done = true
	case "error":
		event.Type = "engine.error"
		event.Error = raw.Error
		event.Done = true
	default:
		event.Type = "engine.raw." + raw.Type
	}
	return event
}

func writeCommand(writer io.Writer, value any) error {
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	data = append(data, '\n')
	_, err = writer.Write(data)
	return err
}

func providerAPIKeyEnvironment(provider string) (string, bool) {
	keys := map[string]string{
		"anthropic": "ANTHROPIC_API_KEY",
		"openai":    "OPENAI_API_KEY",
		"deepseek":  "DEEPSEEK_API_KEY",
		"kourichat": "KOURICHAT_API_KEY",
		"google":    "GEMINI_API_KEY",
		"mistral":   "MISTRAL_API_KEY",
		"groq":      "GROQ_API_KEY",
	}
	key, supported := keys[provider]
	return key, supported
}

func validateModelAccess(settings config.AppSettings) error {
	provider := strings.TrimSpace(settings.ActiveProvider)
	model := strings.TrimSpace(settings.ActiveModel)
	if provider == "" || model == "" {
		return fmt.Errorf("model provider and model must be selected")
	}

	if relay := settings.Relay; relay != nil && relay.Enabled {
		if strings.TrimSpace(relay.Key) == "" {
			return fmt.Errorf("MilkSU Relay is enabled but has no API key; open Settings > API Keys, enter the relay key, and save")
		}
		return nil
	}

	environmentKey, supported := providerAPIKeyEnvironment(provider)
	if !supported {
		return fmt.Errorf("model provider %q is not supported by the local Agent runtime", provider)
	}
	if configured, exists := settings.Providers[provider]; exists {
		if !configured.Enabled {
			return fmt.Errorf("%s/%s cannot start because the provider is disabled; open Settings > API Keys, enable %s, and save", provider, model, provider)
		}
		if strings.TrimSpace(configured.APIKey) == "" {
			return fmt.Errorf("%s/%s cannot start because no API key is configured; open Settings > API Keys, enter a key for %s, enable it, and save", provider, model, provider)
		}
		return nil
	}
	if strings.TrimSpace(os.Getenv(environmentKey)) == "" {
		return fmt.Errorf("%s/%s cannot start because no API key is configured; open Settings > API Keys, enter a key for %s, enable it, and save", provider, model, provider)
	}
	return nil
}

func engineEnvironment(settings config.AppSettings) []string {
	environment := safeBaseEnvironment(os.Environ())
	for name, provider := range settings.Providers {
		key, supported := providerAPIKeyEnvironment(name)
		if !supported || !provider.Enabled || provider.APIKey == "" {
			continue
		}
		environment = append(environment, key+"="+provider.APIKey)
		if provider.BaseURL != nil && strings.TrimSpace(*provider.BaseURL) != "" {
			environment = append(environment, strings.ToUpper(name)+"_BASE_URL="+strings.TrimSpace(*provider.BaseURL))
		}
	}
	if key, supported := providerAPIKeyEnvironment(settings.ActiveProvider); supported {
		if _, configured := settings.Providers[settings.ActiveProvider]; !configured {
			if value := os.Getenv(key); value != "" {
				environment = append(environment, key+"="+value)
			}
		}
	}
	if relay := settings.Relay; relay != nil && relay.Enabled && relay.Key != "" {
		environment = append(environment, "MILKSU_RELAY_ENABLED=1", "MILKSU_RELAY_KEY="+relay.Key)
		if relay.URL != "" {
			environment = append(environment, "MILKSU_RELAY_URL="+relay.URL)
		}
	}
	return environment
}

func safeBaseEnvironment(source []string) []string {
	allowed := map[string]struct{}{
		"HOME": {}, "LANG": {}, "LC_ALL": {}, "PATH": {}, "SHELL": {},
		"SSL_CERT_DIR": {}, "SSL_CERT_FILE": {}, "TMPDIR": {},
	}
	result := make([]string, 0, len(allowed))
	for _, entry := range source {
		name, _, found := strings.Cut(entry, "=")
		if !found {
			continue
		}
		if _, keep := allowed[name]; keep {
			result = append(result, entry)
		}
	}
	return result
}

func findProjectRoot() (string, error) {
	if root := os.Getenv("MILKSU_ROOT"); root != "" {
		if _, err := os.Stat(filepath.Join(root, "bridge.js")); err == nil {
			return root, nil
		}
	}

	starts := make([]string, 0, 2)
	if workingDirectory, err := os.Getwd(); err == nil {
		starts = append(starts, workingDirectory)
	}
	if executable, err := os.Executable(); err == nil {
		starts = append(starts, filepath.Dir(executable))
	}
	for _, start := range starts {
		directory := start
		for range 12 {
			if _, err := os.Stat(filepath.Join(directory, "bridge.js")); err == nil {
				return directory, nil
			}
			parent := filepath.Dir(directory)
			if parent == directory {
				break
			}
			directory = parent
		}
	}
	return "", fmt.Errorf("cannot locate MilkSU project root containing bridge.js")
}
