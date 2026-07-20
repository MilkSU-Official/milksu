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

type Event struct {
	SchemaVersion int    `json:"schemaVersion"`
	Engine        string `json:"engine"`
	SessionID     string `json:"sessionId,omitempty"`
	Type          string `json:"type"`
	Timestamp     string `json:"timestamp"`
	Text          string `json:"text,omitempty"`
	ToolName      string `json:"toolName,omitempty"`
	Error         string `json:"error,omitempty"`
	Done          bool   `json:"done,omitempty"`
}

type RuntimeStatus struct {
	DefaultEngine string `json:"defaultEngine"`
	Running       bool   `json:"running"`
	SessionCount  int    `json:"sessionCount"`
	Protocol      string `json:"protocol"`
}

type bridgeEvent struct {
	Type     string `json:"type"`
	ID       string `json:"id"`
	Delta    string `json:"delta"`
	Content  string `json:"content"`
	Error    string `json:"error"`
	ToolName string `json:"toolName"`
	IsError  bool   `json:"isError"`
}

type childProcess struct {
	command *exec.Cmd
	stdin   io.WriteCloser
}

type Supervisor struct {
	mu       sync.Mutex
	process  *childProcess
	sessions map[string]struct{}
	emit     func(Event)
}

func NewSupervisor(emit func(Event)) *Supervisor {
	return &Supervisor{
		sessions: make(map[string]struct{}),
		emit:     emit,
	}
}

func (s *Supervisor) SendMessage(sessionID, prompt string, settings config.AppSettings) error {
	if strings.TrimSpace(sessionID) == "" {
		return fmt.Errorf("session id is required")
	}
	if strings.TrimSpace(prompt) == "" {
		return fmt.Errorf("prompt is required")
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.ensureProcessLocked(settings); err != nil {
		return err
	}

	if _, exists := s.sessions[sessionID]; !exists {
		if err := writeCommand(s.process.stdin, map[string]any{
			"action":         "create_session",
			"conversationId": sessionID,
			"provider":       settings.ActiveProvider,
			"model":          settings.ActiveModel,
		}); err != nil {
			return fmt.Errorf("create engine session: %w", err)
		}
		s.sessions[sessionID] = struct{}{}
	}

	if err := writeCommand(s.process.stdin, map[string]any{
		"action":         "send_message",
		"conversationId": sessionID,
		"prompt":         prompt,
	}); err != nil {
		return fmt.Errorf("send engine message: %w", err)
	}
	return nil
}

func (s *Supervisor) DestroySession(sessionID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.process != nil {
		_ = writeCommand(s.process.stdin, map[string]any{
			"action":         "destroy_session",
			"conversationId": sessionID,
		})
	}
	delete(s.sessions, sessionID)
}

func (s *Supervisor) Status() RuntimeStatus {
	s.mu.Lock()
	defer s.mu.Unlock()
	return RuntimeStatus{
		DefaultEngine: "pi",
		Running:       s.process != nil,
		SessionCount:  len(s.sessions),
		Protocol:      "jsonl-stdio/v1alpha1",
	}
}

func (s *Supervisor) Close() {
	s.mu.Lock()
	process := s.process
	s.process = nil
	s.sessions = make(map[string]struct{})
	s.mu.Unlock()

	if process == nil {
		return
	}
	_ = process.stdin.Close()
	if process.command.Process != nil {
		_ = process.command.Process.Kill()
	}
}

func (s *Supervisor) ensureProcessLocked(settings config.AppSettings) error {
	if s.process != nil {
		return nil
	}
	command, err := newSidecarCommand("chat-bridge.cjs", "bridge.js")
	if err != nil {
		return err
	}
	command.Env = sidecarEnvironment(settings, command.Dir)
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

	process := &childProcess{command: command, stdin: stdin}
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
		s.emitEvent(normalizeBridgeEvent(raw))
	}

	waitError := process.command.Wait()
	s.mu.Lock()
	if s.process == process {
		s.process = nil
		s.sessions = make(map[string]struct{})
	}
	s.mu.Unlock()

	errorText := ""
	if waitError != nil {
		errorText = waitError.Error()
	}
	if scanError := scanner.Err(); scanError != nil {
		errorText = scanError.Error()
	}
	s.emitEvent(Event{Engine: "pi", Type: "engine.stopped", Error: errorText, Done: true})
}

func (s *Supervisor) emitEvent(event Event) {
	event.SchemaVersion = eventSchemaVersion
	event.Timestamp = time.Now().UTC().Format(time.RFC3339Nano)
	if s.emit != nil {
		s.emit(event)
	}
}

func normalizeBridgeEvent(raw bridgeEvent) Event {
	event := Event{Engine: "pi", SessionID: raw.ID, Text: raw.Content, ToolName: raw.ToolName}
	switch raw.Type {
	case "ready":
		event.Type = "session.ready"
	case "model_selected":
		event.Type = "session.model_selected"
	case "text_delta":
		event.Type = "assistant.delta"
		event.Text = raw.Delta
	case "message_done":
		event.Type = "assistant.completed"
		event.Done = true
	case "tool_call_start":
		event.Type = "tool.started"
	case "tool_call_end":
		event.Type = "tool.completed"
		event.Done = true
		if raw.IsError {
			event.Error = raw.Content
		}
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

func engineEnvironment(settings config.AppSettings) []string {
	environment := safeBaseEnvironment(os.Environ())
	keys := map[string]string{
		"anthropic": "ANTHROPIC_API_KEY",
		"openai":    "OPENAI_API_KEY",
		"deepseek":  "DEEPSEEK_API_KEY",
		"google":    "GEMINI_API_KEY",
		"mistral":   "MISTRAL_API_KEY",
		"groq":      "GROQ_API_KEY",
	}
	for name, provider := range settings.Providers {
		key, supported := keys[name]
		if !supported || !provider.Enabled || provider.APIKey == "" {
			continue
		}
		environment = append(environment, key+"="+provider.APIKey)
		if provider.BaseURL != nil && *provider.BaseURL != "" {
			environment = append(environment, strings.ToUpper(name)+"_BASE_URL="+*provider.BaseURL)
		}
	}
	if key, supported := keys[settings.ActiveProvider]; supported {
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
