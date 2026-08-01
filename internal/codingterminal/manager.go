package codingterminal

import (
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/creack/pty"
	"github.com/google/uuid"
)

const (
	defaultColumns       = 100
	defaultRows          = 28
	maxColumns           = 400
	maxRows              = 200
	maxInputBytes        = 64 * 1024
	maxOutputBytes       = 512 * 1024
	maxRunningPerSession = 4
)

type Status string

const (
	StatusRunning Status = "running"
	StatusExited  Status = "exited"
	StatusStopped Status = "stopped"
	StatusFailed  Status = "failed"
)

type Session struct {
	ID             string `json:"id"`
	ConversationID string `json:"conversationId"`
	Workspace      string `json:"workspace"`
	Shell          string `json:"shell"`
	Status         Status `json:"status"`
	PID            int    `json:"pid,omitempty"`
	Columns        int    `json:"columns"`
	Rows           int    `json:"rows"`
	StartedAt      int64  `json:"startedAt"`
	EndedAt        *int64 `json:"endedAt,omitempty"`
	ExitCode       *int   `json:"exitCode,omitempty"`
	Output         string `json:"output,omitempty"`
	OutputTrimmed  bool   `json:"outputTrimmed,omitempty"`
	Error          string `json:"error,omitempty"`
}

type Event struct {
	Type           string   `json:"type"`
	ConversationID string   `json:"conversationId"`
	TerminalID     string   `json:"terminalId"`
	Data           string   `json:"data,omitempty"`
	Session        *Session `json:"session,omitempty"`
}

type terminalSession struct {
	mu            sync.Mutex
	view          Session
	command       *exec.Cmd
	terminal      *os.File
	output        []byte
	outputTrimmed bool
	stopRequested bool
}

type Manager struct {
	mu       sync.Mutex
	sessions map[string]*terminalSession
	emit     func(Event)
	closed   bool
}

func NewManager(emit func(Event)) *Manager {
	return &Manager{
		sessions: make(map[string]*terminalSession),
		emit:     emit,
	}
}

func (m *Manager) Start(
	conversationID,
	workspacePath string,
	columns,
	rows int,
) (Session, error) {
	conversationID, err := validateConversationID(conversationID)
	if err != nil {
		return Session{}, err
	}
	workspace, err := resolveWorkspace(workspacePath)
	if err != nil {
		return Session{}, err
	}
	columns, rows = normalizedSize(columns, rows)
	shell, err := resolveShell()
	if err != nil {
		return Session{}, err
	}

	m.mu.Lock()
	if m.closed {
		m.mu.Unlock()
		return Session{}, errors.New("Coding terminal manager is closed")
	}
	m.pruneConversationLocked(conversationID, 12)
	running := 0
	for _, candidate := range m.sessions {
		candidate.mu.Lock()
		if candidate.view.ConversationID == conversationID &&
			candidate.view.Status == StatusRunning {
			running++
		}
		candidate.mu.Unlock()
	}
	if running >= maxRunningPerSession {
		m.mu.Unlock()
		return Session{}, fmt.Errorf(
			"at most %d terminal sessions can run for one Coding task",
			maxRunningPerSession,
		)
	}
	m.mu.Unlock()

	command := exec.Command(shell, "-l")
	command.Dir = workspace
	command.Env = terminalEnvironment(os.Environ())
	terminal, err := pty.StartWithSize(command, &pty.Winsize{
		Cols: uint16(columns),
		Rows: uint16(rows),
	})
	if err != nil {
		return Session{}, fmt.Errorf("start project terminal: %w", err)
	}
	startedAt := time.Now().UnixMilli()
	entry := &terminalSession{
		view: Session{
			ID:             "term_" + strings.ReplaceAll(uuid.NewString(), "-", ""),
			ConversationID: conversationID,
			Workspace:      workspace,
			Shell:          shell,
			Status:         StatusRunning,
			PID:            command.Process.Pid,
			Columns:        columns,
			Rows:           rows,
			StartedAt:      startedAt,
		},
		command:  command,
		terminal: terminal,
	}

	m.mu.Lock()
	if m.closed {
		m.mu.Unlock()
		_ = terminal.Close()
		_ = command.Process.Kill()
		_ = command.Wait()
		return Session{}, errors.New("Coding terminal manager is closed")
	}
	m.sessions[entry.view.ID] = entry
	m.mu.Unlock()

	view := entry.snapshot()
	m.emitEvent(Event{
		Type:           "terminal.started",
		ConversationID: conversationID,
		TerminalID:     view.ID,
		Session:        &view,
	})
	go m.readOutput(entry, terminal)
	go m.wait(entry)
	return view, nil
}

func (m *Manager) List(conversationID string) ([]Session, error) {
	conversationID, err := validateConversationID(conversationID)
	if err != nil {
		return nil, err
	}
	m.mu.Lock()
	entries := make([]*terminalSession, 0, len(m.sessions))
	for _, entry := range m.sessions {
		entry.mu.Lock()
		matches := entry.view.ConversationID == conversationID
		entry.mu.Unlock()
		if matches {
			entries = append(entries, entry)
		}
	}
	m.mu.Unlock()

	result := make([]Session, 0, len(entries))
	for _, entry := range entries {
		result = append(result, entry.snapshot())
	}
	sort.Slice(result, func(left, right int) bool {
		return result[left].StartedAt > result[right].StartedAt
	})
	return result, nil
}

func (m *Manager) Write(
	conversationID,
	terminalID,
	data string,
) error {
	entry, err := m.session(conversationID, terminalID)
	if err != nil {
		return err
	}
	if len(data) > maxInputBytes {
		return fmt.Errorf("terminal input must be at most %d bytes", maxInputBytes)
	}
	entry.mu.Lock()
	if entry.view.Status != StatusRunning || entry.terminal == nil {
		entry.mu.Unlock()
		return errors.New("terminal session is not running")
	}
	terminal := entry.terminal
	entry.mu.Unlock()
	if _, err := io.WriteString(terminal, data); err != nil {
		return fmt.Errorf("write project terminal: %w", err)
	}
	return nil
}

func (m *Manager) Resize(
	conversationID,
	terminalID string,
	columns,
	rows int,
) (Session, error) {
	entry, err := m.session(conversationID, terminalID)
	if err != nil {
		return Session{}, err
	}
	columns, rows = normalizedSize(columns, rows)
	entry.mu.Lock()
	if entry.view.Status != StatusRunning || entry.terminal == nil {
		view := entry.snapshotLocked()
		entry.mu.Unlock()
		return view, errors.New("terminal session is not running")
	}
	terminal := entry.terminal
	entry.view.Columns = columns
	entry.view.Rows = rows
	view := entry.snapshotLocked()
	entry.mu.Unlock()
	if err := pty.Setsize(terminal, &pty.Winsize{
		Cols: uint16(columns),
		Rows: uint16(rows),
	}); err != nil {
		return Session{}, fmt.Errorf("resize project terminal: %w", err)
	}
	m.emitEvent(Event{
		Type:           "terminal.resized",
		ConversationID: conversationID,
		TerminalID:     terminalID,
		Session:        &view,
	})
	return view, nil
}

func (m *Manager) Stop(
	conversationID,
	terminalID string,
) (Session, error) {
	entry, err := m.session(conversationID, terminalID)
	if err != nil {
		return Session{}, err
	}
	entry.mu.Lock()
	if entry.view.Status != StatusRunning {
		view := entry.snapshotLocked()
		entry.mu.Unlock()
		return view, nil
	}
	entry.stopRequested = true
	process := entry.command.Process
	terminal := entry.terminal
	entry.mu.Unlock()

	if process != nil {
		_ = process.Signal(os.Interrupt)
	}
	if terminal != nil {
		_ = terminal.Close()
	}
	if process != nil {
		time.AfterFunc(750*time.Millisecond, func() {
			entry.mu.Lock()
			running := entry.view.Status == StatusRunning
			entry.mu.Unlock()
			if running {
				_ = process.Kill()
			}
		})
	}
	return entry.snapshot(), nil
}

func (m *Manager) CloseConversation(conversationID string) {
	conversationID = strings.TrimSpace(conversationID)
	if conversationID == "" {
		return
	}
	m.mu.Lock()
	identifiers := make([]string, 0)
	for identifier, entry := range m.sessions {
		entry.mu.Lock()
		matches := entry.view.ConversationID == conversationID
		entry.mu.Unlock()
		if matches {
			identifiers = append(identifiers, identifier)
		}
	}
	m.mu.Unlock()
	for _, identifier := range identifiers {
		_, _ = m.Stop(conversationID, identifier)
	}
}

func (m *Manager) Close() {
	m.mu.Lock()
	if m.closed {
		m.mu.Unlock()
		return
	}
	m.closed = true
	entries := make([]*terminalSession, 0, len(m.sessions))
	for _, entry := range m.sessions {
		entries = append(entries, entry)
	}
	m.mu.Unlock()
	for _, entry := range entries {
		entry.mu.Lock()
		if entry.view.Status != StatusRunning {
			entry.mu.Unlock()
			continue
		}
		entry.stopRequested = true
		process := entry.command.Process
		terminal := entry.terminal
		entry.mu.Unlock()
		if process != nil {
			_ = process.Signal(os.Interrupt)
		}
		if terminal != nil {
			_ = terminal.Close()
		}
		if process != nil {
			_ = process.Kill()
		}
	}
}

func (m *Manager) session(
	conversationID,
	terminalID string,
) (*terminalSession, error) {
	conversationID, err := validateConversationID(conversationID)
	if err != nil {
		return nil, err
	}
	terminalID = strings.TrimSpace(terminalID)
	if !strings.HasPrefix(terminalID, "term_") || len(terminalID) > 96 {
		return nil, errors.New("invalid terminal session id")
	}
	m.mu.Lock()
	entry := m.sessions[terminalID]
	m.mu.Unlock()
	if entry == nil {
		return nil, errors.New("terminal session not found")
	}
	entry.mu.Lock()
	matches := entry.view.ConversationID == conversationID
	entry.mu.Unlock()
	if !matches {
		return nil, errors.New("terminal session does not belong to this Coding task")
	}
	return entry, nil
}

func (m *Manager) readOutput(
	entry *terminalSession,
	terminal *os.File,
) {
	buffer := make([]byte, 32*1024)
	for {
		count, err := terminal.Read(buffer)
		if count > 0 {
			data := strings.ToValidUTF8(string(buffer[:count]), "\uFFFD")
			entry.appendOutput([]byte(data))
			entry.mu.Lock()
			conversationID := entry.view.ConversationID
			terminalID := entry.view.ID
			entry.mu.Unlock()
			m.emitEvent(Event{
				Type:           "terminal.output",
				ConversationID: conversationID,
				TerminalID:     terminalID,
				Data:           data,
			})
		}
		if err != nil {
			return
		}
	}
}

func (m *Manager) wait(entry *terminalSession) {
	err := entry.command.Wait()
	endedAt := time.Now().UnixMilli()
	entry.mu.Lock()
	stopRequested := entry.stopRequested
	exitCode := -1
	if entry.command.ProcessState != nil {
		exitCode = entry.command.ProcessState.ExitCode()
	}
	if stopRequested {
		entry.view.Status = StatusStopped
	} else if err == nil && exitCode == 0 {
		entry.view.Status = StatusExited
	} else {
		entry.view.Status = StatusFailed
		if err != nil {
			entry.view.Error = err.Error()
		}
	}
	entry.view.EndedAt = &endedAt
	entry.view.ExitCode = &exitCode
	entry.terminal = nil
	view := entry.snapshotLocked()
	entry.mu.Unlock()
	m.emitEvent(Event{
		Type:           "terminal.exited",
		ConversationID: view.ConversationID,
		TerminalID:     view.ID,
		Session:        &view,
	})
}

func (entry *terminalSession) appendOutput(data []byte) {
	entry.mu.Lock()
	defer entry.mu.Unlock()
	entry.output = append(entry.output, data...)
	if len(entry.output) > maxOutputBytes {
		entry.output = append(
			[]byte(nil),
			entry.output[len(entry.output)-maxOutputBytes:]...,
		)
		entry.outputTrimmed = true
	}
}

func (entry *terminalSession) snapshot() Session {
	entry.mu.Lock()
	defer entry.mu.Unlock()
	return entry.snapshotLocked()
}

func (entry *terminalSession) snapshotLocked() Session {
	view := entry.view
	view.Output = strings.ToValidUTF8(string(entry.output), "\uFFFD")
	view.OutputTrimmed = entry.outputTrimmed
	return view
}

func (m *Manager) emitEvent(event Event) {
	if m.emit != nil {
		m.emit(event)
	}
}

func (m *Manager) pruneConversationLocked(
	conversationID string,
	retain int,
) {
	type candidate struct {
		identifier string
		startedAt  int64
	}
	completed := make([]candidate, 0)
	for identifier, entry := range m.sessions {
		entry.mu.Lock()
		if entry.view.ConversationID == conversationID &&
			entry.view.Status != StatusRunning {
			completed = append(completed, candidate{
				identifier: identifier,
				startedAt:  entry.view.StartedAt,
			})
		}
		entry.mu.Unlock()
	}
	if len(completed) <= retain {
		return
	}
	sort.Slice(completed, func(left, right int) bool {
		return completed[left].startedAt > completed[right].startedAt
	})
	for _, entry := range completed[retain:] {
		delete(m.sessions, entry.identifier)
	}
}

func validateConversationID(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", errors.New("conversation id is required")
	}
	if len(value) > 200 || strings.ContainsRune(value, '\x00') {
		return "", errors.New("invalid conversation id")
	}
	return value, nil
}

func resolveWorkspace(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", errors.New("project directory is required")
	}
	absolute, err := filepath.Abs(value)
	if err != nil {
		return "", fmt.Errorf("resolve project directory: %w", err)
	}
	resolved, err := filepath.EvalSymlinks(absolute)
	if err != nil {
		return "", fmt.Errorf("resolve project directory: %w", err)
	}
	info, err := os.Stat(resolved)
	if err != nil {
		return "", fmt.Errorf("inspect project directory: %w", err)
	}
	if !info.IsDir() {
		return "", errors.New("project directory must be a directory")
	}
	return resolved, nil
}

func normalizedSize(columns, rows int) (int, int) {
	if columns < 20 {
		columns = defaultColumns
	}
	if rows < 5 {
		rows = defaultRows
	}
	if columns > maxColumns {
		columns = maxColumns
	}
	if rows > maxRows {
		rows = maxRows
	}
	return columns, rows
}

func resolveShell() (string, error) {
	candidates := []string{
		strings.TrimSpace(os.Getenv("SHELL")),
		"/bin/zsh",
		"/bin/bash",
		"/bin/sh",
	}
	for _, candidate := range candidates {
		if candidate == "" || !filepath.IsAbs(candidate) {
			continue
		}
		info, err := os.Stat(candidate)
		if err == nil && !info.IsDir() && info.Mode().Perm()&0o111 != 0 {
			return candidate, nil
		}
	}
	return "", errors.New("no supported local shell is available")
}

func terminalEnvironment(source []string) []string {
	blocked := map[string]struct{}{
		"ANTHROPIC_API_KEY": {},
		"DEEPSEEK_API_KEY":  {},
		"GEMINI_API_KEY":    {},
		"GOOGLE_API_KEY":    {},
		"GROQ_API_KEY":      {},
		"KOURICHAT_API_KEY": {},
		"MILKSU_RELAY_KEY":  {},
		"MISTRAL_API_KEY":   {},
		"OPENAI_API_KEY":    {},
	}
	environment := make([]string, 0, len(source)+3)
	hasPath := false
	for _, entry := range source {
		name, _, found := strings.Cut(entry, "=")
		if !found {
			continue
		}
		if _, denied := blocked[name]; denied {
			continue
		}
		switch name {
		case "TERM", "COLORTERM", "MILKSU_TERMINAL":
			continue
		case "PATH":
			hasPath = true
		}
		environment = append(environment, entry)
	}
	if !hasPath {
		environment = append(environment, "PATH=/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin")
	}
	environment = append(
		environment,
		"TERM=xterm-256color",
		"COLORTERM=truecolor",
		"MILKSU_TERMINAL=1",
	)
	return environment
}
