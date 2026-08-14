package engine

import (
	"bufio"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/MilkSU-Official/milksu/internal/codingattachment"
	"github.com/MilkSU-Official/milksu/internal/config"
	"github.com/MilkSU-Official/milksu/internal/securitytools"
)

const eventSchemaVersion = 1

const defaultTurnActivityTimeout = 90 * time.Second

// defaultCompactionTimeout bounds a manual context compaction end to end. It
// deliberately exceeds the Sidecar-side cancellation bound so the Sidecar
// always aborts the summarization call first; the Supervisor timeout only
// reports that the control surface gave up.
const defaultCompactionTimeout = 130 * time.Second

var (
	probeCredentialPattern = regexp.MustCompile(
		`(?i)\b(?:sk[-_]|gsk_|aiza|nss_agent_)[a-z0-9._-]{8,}`,
	)
	probeBearerPattern = regexp.MustCompile(
		`(?i)(bearer\s+)[a-z0-9._~+/=-]{8,}`,
	)
	probeAssignmentPattern = regexp.MustCompile(
		`(?i)\b(api[_ -]?key|key|token|secret|password)\s*[:=]\s*[^\s,;]+`,
	)
	probeQueryPattern = regexp.MustCompile(
		`(?i)([?&](?:api[_-]?key|key|token|secret|password)=)[^&#\s]+`,
	)
)

type Event struct {
	SchemaVersion   int                      `json:"schemaVersion"`
	Engine          string                   `json:"engine"`
	SessionID       string                   `json:"sessionId,omitempty"`
	Type            string                   `json:"type"`
	Timestamp       string                   `json:"timestamp"`
	Text            string                   `json:"text,omitempty"`
	ToolName        string                   `json:"toolName,omitempty"`
	ToolCallID      string                   `json:"toolCallId,omitempty"`
	DurationMS      int64                    `json:"durationMs,omitempty"`
	Error           string                   `json:"error,omitempty"`
	Done            bool                     `json:"done,omitempty"`
	Tools           []string                 `json:"tools,omitempty"`
	Extensions      []string                 `json:"extensions,omitempty"`
	Skills          []string                 `json:"skills,omitempty"`
	ExecutionMode   string                   `json:"executionMode,omitempty"`
	ApprovalPolicy  string                   `json:"approvalPolicy,omitempty"`
	Capabilities    []CodingCapabilityStatus `json:"capabilities,omitempty"`
	RequestID       string                   `json:"requestId,omitempty"`
	Input           string                   `json:"input,omitempty"`
	Reason          string                   `json:"reason,omitempty"`
	Approved        *bool                    `json:"approved,omitempty"`
	BackgroundTasks []BackgroundTask         `json:"backgroundTasks,omitempty"`
	Goal            *CodingGoalState         `json:"goal,omitempty"`
	Resumed         bool                     `json:"resumed,omitempty"`
	Aborted         bool                     `json:"aborted,omitempty"`
	Compaction      *CompactionResult        `json:"compaction,omitempty"`
	Steering        []string                 `json:"steering,omitempty"`
	FollowUp        []string                 `json:"followUp,omitempty"`
	ModelSource     string                   `json:"modelSource,omitempty"`
	Module          string                   `json:"module,omitempty"`
	Usage           *ModelUsage              `json:"usage,omitempty"`
}

// ModelUsage is the bounded, credential-free projection emitted by Pi after
// one real model call. Prompt, response, tool arguments and Provider headers
// never cross this structure.
type ModelUsage struct {
	RecordID     string  `json:"recordId"`
	Module       string  `json:"module"`
	OccurredAt   string  `json:"occurredAt"`
	Provider     string  `json:"provider"`
	Model        string  `json:"model"`
	Source       string  `json:"source"`
	InputTokens  int64   `json:"inputTokens"`
	OutputTokens int64   `json:"outputTokens"`
	CacheRead    int64   `json:"cacheReadTokens"`
	CacheWrite   int64   `json:"cacheWriteTokens"`
	Reasoning    int64   `json:"reasoningTokens"`
	TotalTokens  int64   `json:"totalTokens"`
	CostUSD      float64 `json:"costUsd"`
	Success      bool    `json:"success"`
}

type RuntimeStatus struct {
	DefaultEngine      string                  `json:"defaultEngine"`
	Running            bool                    `json:"running"`
	SessionCount       int                     `json:"sessionCount"`
	Protocol           string                  `json:"protocol"`
	Workspace          string                  `json:"workspace,omitempty"`
	BackgroundTasks    []BackgroundTask        `json:"backgroundTasks,omitempty"`
	BackgroundRecovery *BackgroundRecoveryInfo `json:"backgroundRecovery,omitempty"`
}

type BackgroundRecoveryInfo struct {
	State  string `json:"state"`
	Detail string `json:"detail,omitempty"`
}

type BackgroundTask struct {
	ID           string `json:"id"`
	Name         string `json:"name,omitempty"`
	Kind         string `json:"kind"`
	Status       string `json:"status"`
	StartedAt    int64  `json:"startedAt"`
	EndedAt      int64  `json:"endedAt,omitempty"`
	Command      string `json:"command,omitempty"`
	Cwd          string `json:"cwd,omitempty"`
	PID          int    `json:"pid,omitempty"`
	PGID         int    `json:"pgid,omitempty"`
	Ports        []int  `json:"ports,omitempty"`
	LogPath      string `json:"logPath,omitempty"`
	LogTail      string `json:"logTail,omitempty"`
	LogTruncated bool   `json:"logTruncated,omitempty"`
	LastExitCode *int   `json:"lastExitCode,omitempty"`
	Error        string `json:"error,omitempty"`
}

type CodingGoalState struct {
	ID                  string `json:"id"`
	Text                string `json:"text"`
	Status              string `json:"status"`
	StartedAt           int64  `json:"startedAt"`
	UpdatedAt           int64  `json:"updatedAt"`
	Iteration           int    `json:"iteration"`
	TokenBudget         *int64 `json:"tokenBudget,omitempty"`
	TokensUsed          int64  `json:"tokensUsed"`
	TimeUsedSeconds     int64  `json:"timeUsedSeconds"`
	AutomaticModelTurns int    `json:"automaticModelTurns"`
	QueuedCount         int    `json:"queuedCount"`
}

// CompactionResult is the bounded projection of Pi's manual context
// compaction outcome. The summary body stays inside the persisted Pi session;
// only token accounting crosses the control surface.
type CompactionResult struct {
	TokensBefore         int64 `json:"tokensBefore"`
	EstimatedTokensAfter int64 `json:"estimatedTokensAfter,omitempty"`
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

type CodingBrowserDescriptor struct {
	SessionID   string `json:"sessionId"`
	CDPEndpoint string `json:"cdpEndpoint"`
}

type ComputerUseDescriptor struct {
	SessionID      string `json:"sessionId"`
	SocketPath     string `json:"socketPath"`
	TargetBundleID string `json:"targetBundleId"`
	TargetName     string `json:"targetName"`
	TargetPID      int    `json:"targetPid"`
	TargetWindowID int64  `json:"targetWindowId"`
}

type CodingCollaborationDescriptor struct {
	SchemaVersion  int                           `json:"schemaVersion"`
	ConversationID string                        `json:"conversationId"`
	Workspace      string                        `json:"workspace"`
	BaseHead       string                        `json:"baseHead"`
	Worktrees      []CodingCollaborationWorktree `json:"worktrees"`
}

type CodingCollaborationWorktree struct {
	ID     string `json:"id"`
	Path   string `json:"path"`
	Branch string `json:"branch"`
}

type bridgeEvent struct {
	Type           string                   `json:"type"`
	ID             string                   `json:"id"`
	Delta          string                   `json:"delta"`
	Content        string                   `json:"content"`
	Error          string                   `json:"error"`
	ToolName       string                   `json:"toolName"`
	ToolCallID     string                   `json:"toolCallId"`
	DurationMS     int64                    `json:"durationMs"`
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
	Tasks          []BackgroundTask         `json:"tasks"`
	Goal           *CodingGoalState         `json:"goal"`
	Resumed        bool                     `json:"resumed"`
	Aborted        bool                     `json:"aborted"`
	Compaction     *CompactionResult        `json:"compaction"`
	Steering       []string                 `json:"steering"`
	FollowUp       []string                 `json:"followUp"`
	Source         string                   `json:"source"`
	From           string                   `json:"from"`
	To             string                   `json:"to"`
	Module         string                   `json:"module"`
	Usage          *ModelUsage              `json:"usage"`
}

type childProcess struct {
	command   *exec.Cmd
	stdin     io.WriteCloser
	workspace string
}

type Supervisor struct {
	mu               sync.Mutex
	probeMu          sync.Mutex
	process          *childProcess
	sessions         map[string]struct{}
	probeWaiters     map[string]chan Event
	silentSessions   map[string]struct{}
	controlWaiters   map[string]chan Event
	recoveryWaiters  map[string]map[chan Event]struct{}
	recoveryFailures map[string]string
	turnTimeout      time.Duration
	turnTimers       map[string]*time.Timer
	turnSequence     map[string]uint64
	approvals        map[string]int
	backgroundTasks  map[string][]BackgroundTask
	securityTools    []securitytools.RuntimeTool
	emit             func(Event)
	sidecarDirectory string
}

func NewSupervisor(emit func(Event)) *Supervisor {
	return &Supervisor{
		sessions:         make(map[string]struct{}),
		probeWaiters:     make(map[string]chan Event),
		silentSessions:   make(map[string]struct{}),
		controlWaiters:   make(map[string]chan Event),
		recoveryWaiters:  make(map[string]map[chan Event]struct{}),
		recoveryFailures: make(map[string]string),
		turnTimeout:      defaultTurnActivityTimeout,
		turnTimers:       make(map[string]*time.Timer),
		turnSequence:     make(map[string]uint64),
		approvals:        make(map[string]int),
		backgroundTasks:  make(map[string][]BackgroundTask),
		emit:             emit,
	}
}

type TextGenerationResult struct {
	Provider string
	Model    string
	Text     string
}

func NewSupervisorWithSidecarDirectory(
	emit func(Event),
	sidecarDirectory string,
) *Supervisor {
	supervisor := NewSupervisor(emit)
	supervisor.sidecarDirectory = strings.TrimSpace(sidecarDirectory)
	return supervisor
}

// SetSecurityTools publishes the current local, display-free capability
// descriptors to subsequent Coding turns. Detection remains owned by the
// desktop application; Pi only receives tools that are enabled and ready.
func (s *Supervisor) SetSecurityTools(tools []securitytools.RuntimeTool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.securityTools = append([]securitytools.RuntimeTool(nil), tools...)
}

// SetTurnActivityTimeout configures the inactivity deadline used for turns
// started after this call. Callers with a stricter end-to-end deadline should
// set this before SendMessage so that their deadline remains authoritative.
func (s *Supervisor) SetTurnActivityTimeout(timeout time.Duration) error {
	if timeout <= 0 {
		return fmt.Errorf("turn activity timeout must be positive")
	}
	s.mu.Lock()
	s.turnTimeout = timeout
	s.mu.Unlock()
	return nil
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
	mcpServers []string,
	mcpConfigDigest string,
	codingBrowser *CodingBrowserDescriptor,
	computerUse *ComputerUseDescriptor,
	codingCollaboration *CodingCollaborationDescriptor,
	attachments []codingattachment.Attachment,
	settings config.AppSettings,
	modelSourcePreference ...string,
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
	codingBrowser, err = normalizeCodingBrowserDescriptor(codingBrowser)
	if err != nil {
		return err
	}
	if sessionRole != "" || codingPolicy.ExecutionMode != "go" {
		codingBrowser = nil
	}
	computerUse, err = normalizeComputerUseDescriptor(computerUse)
	if err != nil {
		return err
	}
	if sessionRole != "" ||
		codingPolicy.ExecutionMode != "go" ||
		codingPolicy.ApprovalPolicy == "read-only" {
		computerUse = nil
	}
	if err := validateModelAccess(settings); err != nil {
		return err
	}
	workspace, err := resolveAgentWorkspace(workspacePath)
	if err != nil {
		return err
	}
	collaborationRoot, err := codingCollaborationRoot()
	if err != nil {
		return err
	}
	codingCollaboration, err = normalizeCodingCollaborationDescriptor(
		codingCollaboration,
		sessionID,
		workspace,
		collaborationRoot,
	)
	if err != nil {
		return err
	}
	if sessionRole != "" ||
		codingPolicy.ExecutionMode != "go" ||
		codingPolicy.ApprovalPolicy == "read-only" {
		codingCollaboration = nil
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.ensureProcessLocked(settings, workspace); err != nil {
		return err
	}
	preference := ""
	if len(modelSourcePreference) > 0 {
		preference = modelSourcePreference[0]
	}

	command := map[string]any{
		"action":          "send_message",
		"conversationId":  sessionID,
		"prompt":          prompt,
		"provider":        settings.ActiveProvider,
		"model":           settings.ActiveModel,
		"sessionRole":     strings.TrimSpace(sessionRole),
		"executionMode":   codingPolicy.ExecutionMode,
		"approvalPolicy":  codingPolicy.ApprovalPolicy,
		"mcpServers":      mcpServers,
		"mcpConfigDigest": strings.TrimSpace(mcpConfigDigest),
		"disabledSkills":  settings.DisabledSkills,
		"attachments":     attachments,
		"modelSourceOrder": preferredModelSourceOrder(
			settings,
			preference,
		),
	}
	if len(s.securityTools) > 0 {
		command["securityTools"] = append([]securitytools.RuntimeTool(nil), s.securityTools...)
	}
	if codingBrowser != nil {
		command["codingBrowser"] = codingBrowser
	}
	if computerUse != nil {
		command["computerUse"] = computerUse
	}
	if codingCollaboration != nil {
		command["codingCollaboration"] = codingCollaboration
	}
	if err := writeCommand(s.process.stdin, command); err != nil {
		return fmt.Errorf("send engine message: %w", err)
	}
	s.sessions[sessionID] = struct{}{}
	s.armTurnTimerLocked(sessionID)
	return nil
}

func normalizeCodingCollaborationDescriptor(
	descriptor *CodingCollaborationDescriptor,
	sessionID,
	workspace,
	root string,
) (*CodingCollaborationDescriptor, error) {
	if descriptor == nil {
		return nil, nil
	}
	if descriptor.SchemaVersion != 2 {
		return nil, errors.New("invalid Coding collaboration schema version")
	}
	if strings.TrimSpace(descriptor.ConversationID) != strings.TrimSpace(sessionID) {
		return nil, errors.New("Coding collaboration must belong to the current task")
	}
	resolvedWorkspace, err := resolveAgentWorkspace(descriptor.Workspace)
	if err != nil || resolvedWorkspace != workspace {
		return nil, errors.New("Coding collaboration must belong to the current workspace")
	}
	if !validGitObjectID(descriptor.BaseHead) {
		return nil, errors.New("invalid Coding collaboration base commit")
	}
	resolvedRoot, err := filepath.Abs(root)
	if err != nil {
		return nil, fmt.Errorf("resolve Coding collaboration root: %w", err)
	}
	resolvedRoot, err = filepath.EvalSymlinks(resolvedRoot)
	if err != nil {
		return nil, fmt.Errorf("resolve Coding collaboration root links: %w", err)
	}
	if len(descriptor.Worktrees) < 1 || len(descriptor.Worktrees) > 2 {
		return nil, errors.New("Coding collaboration requires one or two writer worktrees")
	}
	digest := sha256.Sum256([]byte(strings.TrimSpace(sessionID)))
	taskKey := fmt.Sprintf("%x", digest[:16])
	normalized := &CodingCollaborationDescriptor{
		SchemaVersion:  2,
		ConversationID: strings.TrimSpace(sessionID),
		Workspace:      workspace,
		BaseHead:       descriptor.BaseHead,
		Worktrees: make(
			[]CodingCollaborationWorktree,
			0,
			len(descriptor.Worktrees),
		),
	}
	for index, worktree := range descriptor.Worktrees {
		expectedID := fmt.Sprintf("writer-%d", index+1)
		expectedBranch := fmt.Sprintf(
			"codex/agent-%s-writer-%d",
			taskKey[:12],
			index+1,
		)
		expectedPath := filepath.Join(resolvedRoot, taskKey, expectedID)
		resolvedPath, pathErr := resolveAgentWorkspace(worktree.Path)
		if pathErr != nil ||
			worktree.ID != expectedID ||
			strings.TrimSpace(worktree.Branch) != expectedBranch ||
			resolvedPath != expectedPath {
			return nil, fmt.Errorf(
				"invalid Coding collaboration boundary for %s",
				expectedID,
			)
		}
		normalized.Worktrees = append(
			normalized.Worktrees,
			CodingCollaborationWorktree{
				ID:     expectedID,
				Path:   expectedPath,
				Branch: expectedBranch,
			},
		)
	}
	return normalized, nil
}

func validGitObjectID(value string) bool {
	if len(value) != 40 && len(value) != 64 {
		return false
	}
	for _, character := range value {
		if character >= '0' && character <= '9' ||
			character >= 'a' && character <= 'f' {
			continue
		}
		return false
	}
	return true
}

func normalizeComputerUseDescriptor(
	descriptor *ComputerUseDescriptor,
) (*ComputerUseDescriptor, error) {
	if descriptor == nil {
		return nil, nil
	}
	sessionID := strings.TrimSpace(descriptor.SessionID)
	sessionSuffix := strings.TrimPrefix(sessionID, "computer_")
	if sessionSuffix == sessionID ||
		len(sessionSuffix) < 8 ||
		len(sessionSuffix) > 128 {
		return nil, fmt.Errorf("invalid Computer Use session id")
	}
	for _, character := range sessionSuffix {
		if character >= 'a' && character <= 'z' ||
			character >= 'A' && character <= 'Z' ||
			character >= '0' && character <= '9' ||
			character == '-' {
			continue
		}
		return nil, fmt.Errorf("invalid Computer Use session id")
	}
	expectedSocket := filepath.Join(
		"/private/tmp/milksu-computer-use",
		sessionID,
		"driver.sock",
	)
	if strings.TrimSpace(descriptor.SocketPath) != expectedSocket {
		return nil, fmt.Errorf("invalid Computer Use socket path")
	}
	targetBundleID := strings.TrimSpace(descriptor.TargetBundleID)
	targetName := strings.TrimSpace(descriptor.TargetName)
	if !validComputerUseBundleID(targetBundleID) {
		return nil, fmt.Errorf("invalid Computer Use target bundle id")
	}
	if targetName == "" || len(targetName) > 120 || strings.ContainsRune(targetName, '\x00') {
		return nil, fmt.Errorf("invalid Computer Use target name")
	}
	if descriptor.TargetPID <= 1 {
		return nil, fmt.Errorf("invalid Computer Use target PID")
	}
	if descriptor.TargetWindowID <= 0 {
		return nil, fmt.Errorf("invalid Computer Use target window")
	}
	return &ComputerUseDescriptor{
		SessionID:      sessionID,
		SocketPath:     expectedSocket,
		TargetBundleID: targetBundleID,
		TargetName:     targetName,
		TargetPID:      descriptor.TargetPID,
		TargetWindowID: descriptor.TargetWindowID,
	}, nil
}

func validComputerUseBundleID(value string) bool {
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

func normalizeCodingBrowserDescriptor(
	descriptor *CodingBrowserDescriptor,
) (*CodingBrowserDescriptor, error) {
	if descriptor == nil {
		return nil, nil
	}
	sessionID := strings.TrimSpace(descriptor.SessionID)
	endpoint := strings.TrimSpace(descriptor.CDPEndpoint)
	if !strings.HasPrefix(sessionID, "browser_") || len(sessionID) > 160 {
		return nil, fmt.Errorf("invalid Coding browser session id")
	}
	for _, character := range sessionID {
		if character >= 'a' && character <= 'z' ||
			character >= 'A' && character <= 'Z' ||
			character >= '0' && character <= '9' ||
			strings.ContainsRune("_-", character) {
			continue
		}
		return nil, fmt.Errorf("invalid Coding browser session id")
	}
	parsed, err := url.Parse(endpoint)
	if err != nil ||
		parsed.Scheme != "http" ||
		parsed.Hostname() != "127.0.0.1" ||
		parsed.Path != "" ||
		parsed.RawQuery != "" ||
		parsed.Fragment != "" ||
		parsed.User != nil {
		return nil, fmt.Errorf("invalid Coding browser CDP endpoint")
	}
	port, err := strconv.Atoi(parsed.Port())
	if err != nil || port <= 0 || port > 65535 ||
		net.JoinHostPort(parsed.Hostname(), strconv.Itoa(port)) != parsed.Host {
		return nil, fmt.Errorf("invalid Coding browser CDP endpoint")
	}
	return &CodingBrowserDescriptor{
		SessionID:   sessionID,
		CDPEndpoint: endpoint,
	}, nil
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

// SteerMessage delegates mid-run guidance to Pi's native steering queue. Pi
// applies it after the current assistant tool-call batch and before the next
// model call, so MilkSU does not maintain a second generic message loop.
func (s *Supervisor) SteerMessage(sessionID, prompt string) error {
	sessionID = strings.TrimSpace(sessionID)
	prompt = strings.TrimSpace(prompt)
	if sessionID == "" {
		return fmt.Errorf("session id is required")
	}
	if prompt == "" {
		return fmt.Errorf("steering message is required")
	}
	if len([]rune(prompt)) > 16000 {
		return fmt.Errorf("steering message exceeds 16000 characters")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.process == nil {
		return fmt.Errorf("PI Sidecar is not running")
	}
	if _, exists := s.sessions[sessionID]; !exists {
		return fmt.Errorf("PI session not found: %s", sessionID)
	}
	if err := writeCommand(s.process.stdin, map[string]any{
		"action":         "steer_message",
		"conversationId": sessionID,
		"prompt":         prompt,
	}); err != nil {
		return fmt.Errorf("steer engine message: %w", err)
	}
	s.armTurnTimerLocked(sessionID)
	return nil
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

func (s *Supervisor) StartBackgroundTask(
	sessionID,
	workspacePath,
	command,
	name,
	executionMode,
	approvalPolicy string,
	settings config.AppSettings,
) (RuntimeStatus, error) {
	sessionID = strings.TrimSpace(sessionID)
	if sessionID == "" {
		return RuntimeStatus{}, fmt.Errorf("session id is required")
	}
	command = strings.TrimSpace(command)
	if command == "" {
		return RuntimeStatus{}, fmt.Errorf("terminal command is required")
	}
	codingPolicy, err := normalizeCodingPolicy(
		executionMode,
		approvalPolicy,
		"",
	)
	if err != nil {
		return RuntimeStatus{}, err
	}
	if codingPolicy.ExecutionMode != "go" ||
		codingPolicy.ApprovalPolicy == "read-only" {
		return RuntimeStatus{}, fmt.Errorf(
			"terminal commands require Go mode with a writable permission policy",
		)
	}
	workspace, err := resolveAgentWorkspace(workspacePath)
	if err != nil {
		return RuntimeStatus{}, err
	}
	s.mu.Lock()
	err = s.ensureProcessLocked(settings, workspace)
	s.mu.Unlock()
	if err != nil {
		return RuntimeStatus{}, err
	}
	return s.sendBackgroundTaskControl(
		sessionID,
		"start background task",
		map[string]any{
			"control":        "spawn",
			"command":        command,
			"name":           strings.TrimSpace(name),
			"executionMode":  codingPolicy.ExecutionMode,
			"approvalPolicy": codingPolicy.ApprovalPolicy,
		},
	)
}

func (s *Supervisor) StopBackgroundTask(
	sessionID,
	taskID string,
) (RuntimeStatus, error) {
	taskID = strings.TrimSpace(taskID)
	if taskID == "" {
		return RuntimeStatus{}, fmt.Errorf("background task id is required")
	}
	return s.sendBackgroundTaskControl(
		sessionID,
		"stop background task",
		map[string]any{
			"control": "stop",
			"taskId":  taskID,
		},
	)
}

func (s *Supervisor) RefreshBackgroundTasks(
	sessionID,
	workspacePath,
	executionMode,
	approvalPolicy string,
	settings config.AppSettings,
) (RuntimeStatus, error) {
	sessionID = strings.TrimSpace(sessionID)
	if sessionID == "" {
		return RuntimeStatus{}, fmt.Errorf("session id is required")
	}
	codingPolicy, err := normalizeCodingPolicy(
		executionMode,
		approvalPolicy,
		"",
	)
	if err != nil {
		return RuntimeStatus{}, err
	}
	workspace, err := resolveAgentWorkspace(workspacePath)
	if err != nil {
		return RuntimeStatus{}, err
	}
	s.mu.Lock()
	err = s.ensureProcessLocked(settings, workspace)
	s.mu.Unlock()
	if err != nil {
		return RuntimeStatus{}, err
	}

	status, err := s.sendBackgroundTaskControl(
		sessionID,
		"refresh background tasks",
		map[string]any{"control": "list"},
	)
	if err != nil || !hasRunningBackgroundTask(status.BackgroundTasks) {
		return status, err
	}
	recovered, recoveryErr := s.recoverBackgroundTaskSession(
		sessionID,
		workspace,
		codingPolicy,
	)
	if recoveryErr != nil {
		status.BackgroundRecovery = &BackgroundRecoveryInfo{
			State:  "failed",
			Detail: recoveryErr.Error(),
		}
		return status, nil
	}
	recoveredStatus, err := s.sendBackgroundTaskControl(
		sessionID,
		"refresh recovered background tasks",
		map[string]any{"control": "list"},
	)
	if err != nil {
		status.BackgroundRecovery = &BackgroundRecoveryInfo{
			State:  "failed",
			Detail: err.Error(),
		}
		return status, nil
	}
	recoveryState := "attached"
	if recovered {
		recoveryState = "recovered"
	}
	recoveredStatus.BackgroundRecovery = &BackgroundRecoveryInfo{State: recoveryState}
	return recoveredStatus, nil
}

// CompactSession requests a bounded manual Pi context compaction for the given
// conversation and waits for the Sidecar receipt. The request is bound to the
// current conversation (an in-memory Pi session must already exist) and never
// restores Browser, MCP, Computer Use, or stale approvals: it carries no
// capability descriptors and compaction does not touch the approval broker.
// Sidecar process termination and timeouts are surfaced as explicit errors.
func (s *Supervisor) CompactSession(sessionID string) (CompactionResult, error) {
	return s.CompactSessionWithTimeout(sessionID, defaultCompactionTimeout)
}

func (s *Supervisor) CompactSessionWithTimeout(
	sessionID string,
	timeout time.Duration,
) (CompactionResult, error) {
	sessionID = strings.TrimSpace(sessionID)
	if sessionID == "" {
		return CompactionResult{}, fmt.Errorf("session id is required")
	}
	if timeout <= 0 {
		return CompactionResult{}, fmt.Errorf("compaction timeout must be positive")
	}
	requestID := fmt.Sprintf("comp_%d", time.Now().UnixNano())
	events := make(chan Event, 1)
	s.probeMu.Lock()
	s.controlWaiters[requestID] = events
	s.probeMu.Unlock()
	defer func() {
		s.probeMu.Lock()
		delete(s.controlWaiters, requestID)
		s.probeMu.Unlock()
	}()

	s.mu.Lock()
	if s.process == nil {
		s.mu.Unlock()
		return CompactionResult{}, fmt.Errorf("PI Sidecar is not running")
	}
	if _, exists := s.sessions[sessionID]; !exists {
		s.mu.Unlock()
		return CompactionResult{}, fmt.Errorf("PI session not found: %s", sessionID)
	}
	err := writeCommand(s.process.stdin, map[string]any{
		"action":         "compact_session",
		"conversationId": sessionID,
		"requestId":      requestID,
	})
	s.mu.Unlock()
	if err != nil {
		return CompactionResult{}, fmt.Errorf("compact session: %w", err)
	}

	timer := time.NewTimer(timeout)
	defer timer.Stop()
	for {
		select {
		case event := <-events:
			switch event.Type {
			case "runtime.compaction_started":
				// The native Pi lifecycle start is observable by the UI but is
				// not the waiting control receipt.
				continue
			case "engine.stopped", "engine.protocol_error":
				return CompactionResult{}, fmt.Errorf(
					"context compaction stopped: %s",
					probeFailureMessage(event),
				)
			}
			if strings.TrimSpace(event.Error) != "" {
				return CompactionResult{}, fmt.Errorf(
					"context compaction failed: %s",
					probeFailureMessage(event),
				)
			}
			if event.Type != "runtime.compaction_completed" ||
				event.Compaction == nil {
				return CompactionResult{}, fmt.Errorf(
					"context compaction ended without a result",
				)
			}
			return *event.Compaction, nil
		case <-timer.C:
			return CompactionResult{}, fmt.Errorf(
				"context compaction timed out after %s",
				timeout.Round(time.Second),
			)
		}
	}
}

func (s *Supervisor) sendBackgroundTaskControl(
	sessionID,
	label string,
	payload map[string]any,
) (RuntimeStatus, error) {
	sessionID = strings.TrimSpace(sessionID)
	if sessionID == "" {
		return RuntimeStatus{}, fmt.Errorf("session id is required")
	}
	requestID := fmt.Sprintf("bg_control_%d", time.Now().UnixNano())
	events := make(chan Event, 1)
	s.probeMu.Lock()
	s.controlWaiters[requestID] = events
	s.probeMu.Unlock()
	defer func() {
		s.probeMu.Lock()
		delete(s.controlWaiters, requestID)
		s.probeMu.Unlock()
	}()

	s.mu.Lock()
	if s.process == nil {
		s.mu.Unlock()
		return RuntimeStatus{}, fmt.Errorf("PI Sidecar is not running")
	}
	wireCommand := map[string]any{
		"action":         "background_task_control",
		"conversationId": sessionID,
		"requestId":      requestID,
	}
	for key, value := range payload {
		wireCommand[key] = value
	}
	err := writeCommand(s.process.stdin, wireCommand)
	s.mu.Unlock()
	if err != nil {
		return RuntimeStatus{}, fmt.Errorf("%s: %w", label, err)
	}

	timer := time.NewTimer(5 * time.Second)
	defer timer.Stop()
	select {
	case event := <-events:
		if strings.TrimSpace(event.Error) != "" {
			return RuntimeStatus{}, fmt.Errorf(
				"%s: %s",
				label,
				probeFailureMessage(event),
			)
		}
		return s.StatusForSession(sessionID), nil
	case <-timer.C:
		return RuntimeStatus{}, fmt.Errorf("%s timed out", label)
	}
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
		nil,
		"",
		nil,
		nil,
		nil,
		nil,
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

// GenerateText runs one bounded, tool-free Pi turn without exposing its
// internal lifecycle events to the product conversation stream. It reuses the
// active Provider and Pi session implementation; callers remain responsible
// for validating any structured output before presenting it as a projection.
func (s *Supervisor) GenerateText(prompt string, settings config.AppSettings) (TextGenerationResult, error) {
	if err := validateModelAccess(settings); err != nil {
		return TextGenerationResult{}, err
	}
	prompt = strings.TrimSpace(prompt)
	if prompt == "" {
		return TextGenerationResult{}, fmt.Errorf("generation prompt is required")
	}
	if len([]rune(prompt)) > 48_000 {
		return TextGenerationResult{}, fmt.Errorf("generation prompt exceeds 48000 characters")
	}

	sessionID := fmt.Sprintf("milksu_text_projection_%d", time.Now().UnixNano())
	events := make(chan Event, 64)
	s.probeMu.Lock()
	s.probeWaiters[sessionID] = events
	s.silentSessions[sessionID] = struct{}{}
	s.probeMu.Unlock()
	defer func() {
		s.DestroySession(sessionID)
		s.probeMu.Lock()
		delete(s.probeWaiters, sessionID)
		delete(s.silentSessions, sessionID)
		s.probeMu.Unlock()
	}()

	// The explicit directive is enforced by bridge-turn-contract.js, which
	// removes all active tools for this turn. Plan/read-only is a second boundary.
	prompt = "Do not call any Agent tools. Return only the requested text.\n\n" + prompt
	s.mu.Lock()
	workspace := ""
	if s.process != nil {
		workspace = s.process.workspace
	}
	s.mu.Unlock()
	if err := s.SendMessage(
		sessionID,
		prompt,
		workspace,
		"",
		"plan",
		"read-only",
		nil,
		"",
		nil,
		nil,
		nil,
		nil,
		settings,
	); err != nil {
		return TextGenerationResult{}, err
	}

	const maximumOutputBytes = 128 * 1024
	var deltas strings.Builder
	timer := time.NewTimer(90 * time.Second)
	defer timer.Stop()
	for {
		select {
		case event := <-events:
			switch event.Type {
			case "assistant.delta":
				if deltas.Len()+len(event.Text) > maximumOutputBytes {
					_ = s.AbortMessage(sessionID)
					return TextGenerationResult{}, fmt.Errorf("Pi text projection exceeded %d bytes", maximumOutputBytes)
				}
				deltas.WriteString(event.Text)
			case "assistant.completed":
				text := strings.TrimSpace(event.Text)
				if text == "" {
					text = strings.TrimSpace(deltas.String())
				}
				if text == "" {
					return TextGenerationResult{}, fmt.Errorf("Pi text projection returned empty output")
				}
				if len(text) > maximumOutputBytes {
					return TextGenerationResult{}, fmt.Errorf("Pi text projection exceeded %d bytes", maximumOutputBytes)
				}
				return TextGenerationResult{
					Provider: strings.TrimSpace(settings.ActiveProvider),
					Model:    strings.TrimSpace(settings.ActiveModel),
					Text:     text,
				}, nil
			case "tool.started", "tool.progress", "tool.completed", "approval.requested":
				_ = s.AbortMessage(sessionID)
				return TextGenerationResult{}, fmt.Errorf("Pi text projection violated its tool-free contract")
			case "engine.error", "engine.stopped", "engine.protocol_error":
				return TextGenerationResult{}, fmt.Errorf(
					"Pi text projection failed: %s",
					probeFailureMessage(event),
				)
			}
		case <-timer.C:
			_ = s.AbortMessage(sessionID)
			return TextGenerationResult{}, fmt.Errorf("Pi text projection timed out after 90 seconds")
		}
	}
}

func (s *Supervisor) DestroySession(sessionID string) {
	s.disposeSession(sessionID, true)
}

// DetachSession disposes live tools and child-process state while retaining the
// persisted Pi conversation so the next turn can resume normally.
func (s *Supervisor) DetachSession(sessionID string) {
	s.disposeSession(sessionID, false)
}

func (s *Supervisor) disposeSession(sessionID string, deletePersisted bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.process != nil {
		_ = writeCommand(s.process.stdin, map[string]any{
			"action":          "destroy_session",
			"conversationId":  sessionID,
			"deletePersisted": deletePersisted,
		})
	}
	s.stopTurnTimerLocked(sessionID)
	delete(s.sessions, sessionID)
	delete(s.recoveryFailures, sessionID)
	delete(s.approvals, sessionID)
	delete(s.backgroundTasks, sessionID)
}

func (s *Supervisor) Status() RuntimeStatus {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.statusLocked("")
}

func (s *Supervisor) StatusForSession(sessionID string) RuntimeStatus {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.statusLocked(strings.TrimSpace(sessionID))
}

func (s *Supervisor) statusLocked(sessionID string) RuntimeStatus {
	status := RuntimeStatus{
		DefaultEngine: "pi",
		Running:       s.process != nil,
		SessionCount:  len(s.sessions),
		Protocol:      "jsonl-stdio/v1alpha1",
	}
	if s.process != nil {
		status.Workspace = s.process.workspace
	}
	if sessionID != "" {
		status.BackgroundTasks = append(
			[]BackgroundTask(nil),
			s.backgroundTasks[sessionID]...,
		)
		return status
	}
	seen := make(map[string]struct{})
	for _, tasks := range s.backgroundTasks {
		for _, task := range tasks {
			if _, exists := seen[task.ID]; exists {
				continue
			}
			seen[task.ID] = struct{}{}
			status.BackgroundTasks = append(status.BackgroundTasks, task)
		}
	}
	return status
}

func (s *Supervisor) Close() {
	s.mu.Lock()
	process := s.process
	s.process = nil
	s.sessions = make(map[string]struct{})
	s.recoveryFailures = make(map[string]string)
	s.stopAllTurnTimersLocked()
	s.approvals = make(map[string]int)
	s.backgroundTasks = make(map[string][]BackgroundTask)
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
		s.recoveryFailures = make(map[string]string)
		s.stopAllTurnTimersLocked()
		s.approvals = make(map[string]int)
		s.backgroundTasks = make(map[string][]BackgroundTask)
		_ = previous.stdin.Close()
		if previous.command.Process != nil {
			_ = previous.command.Process.Kill()
		}
	}
	command, err := newSidecarCommandAtWithDirectory(
		"chat-bridge.cjs",
		developmentChatBridgePath,
		workspace,
		true,
		s.sidecarDirectory,
	)
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
		s.observeRuntimeEvent(event)
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
		s.recoveryFailures = make(map[string]string)
		s.stopAllTurnTimersLocked()
		s.approvals = make(map[string]int)
		s.backgroundTasks = make(map[string][]BackgroundTask)
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
	case "assistant.completed", "assistant.settled", "engine.error", "session.destroyed":
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
	case "assistant.started":
		if _, exists := s.sessions[event.SessionID]; exists &&
			s.approvals[event.SessionID] == 0 {
			s.armTurnTimerLocked(event.SessionID)
		}
	case "session.ready", "session.policy_updated", "session.model_selected", "session.queue_updated", "assistant.delta", "assistant.segment_completed", "tool.started", "tool.progress", "tool.completed":
		if _, exists := s.turnTimers[event.SessionID]; exists &&
			s.approvals[event.SessionID] == 0 {
			s.armTurnTimerLocked(event.SessionID)
		}
	}
}

func (s *Supervisor) observeRuntimeEvent(event Event) {
	if event.Type != "runtime.background_tasks" &&
		event.Type != "runtime.background_task_controlled" {
		return
	}
	s.mu.Lock()
	if s.backgroundTasks == nil {
		s.backgroundTasks = make(map[string][]BackgroundTask)
	}
	if event.SessionID != "" {
		s.backgroundTasks[event.SessionID] = append(
			[]BackgroundTask(nil),
			event.BackgroundTasks...,
		)
	}
	s.mu.Unlock()
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
	s.deliverControlEvent(event)
	s.deliverRecoveryEvent(event)
	s.probeMu.Lock()
	_, silent := s.silentSessions[event.SessionID]
	s.probeMu.Unlock()
	silent = silent || strings.HasPrefix(event.SessionID, "milksu_text_projection_")
	if !silent && s.emit != nil {
		s.emit(event)
	}
}

func (s *Supervisor) deliverRecoveryEvent(event Event) {
	if event.Type != "session.ready" &&
		event.Type != "engine.error" &&
		event.Type != "session.destroyed" &&
		event.Type != "engine.stopped" &&
		event.Type != "engine.protocol_error" {
		return
	}
	if event.SessionID != "" {
		s.mu.Lock()
		switch event.Type {
		case "session.ready", "session.destroyed":
			delete(s.recoveryFailures, event.SessionID)
		}
		s.mu.Unlock()
	}
	s.probeMu.Lock()
	defer s.probeMu.Unlock()
	if event.SessionID != "" {
		for waiter := range s.recoveryWaiters[event.SessionID] {
			select {
			case waiter <- event:
			default:
			}
		}
		return
	}
	for _, waiters := range s.recoveryWaiters {
		for waiter := range waiters {
			select {
			case waiter <- event:
			default:
			}
		}
	}
}

func (s *Supervisor) deliverControlEvent(event Event) {
	// Lifecycle starts are broadcast to the UI but must not occupy the
	// single-result control channel. Fast failures such as "Nothing to compact"
	// can emit start and end back-to-back; queueing the start would otherwise
	// drop the terminal receipt.
	if event.Type == "runtime.compaction_started" {
		return
	}
	s.probeMu.Lock()
	defer s.probeMu.Unlock()
	if event.RequestID != "" {
		if waiter := s.controlWaiters[event.RequestID]; waiter != nil {
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
	for _, waiter := range s.controlWaiters {
		select {
		case waiter <- event:
		default:
		}
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
	message = probeCredentialPattern.ReplaceAllString(message, "[REDACTED]")
	message = probeBearerPattern.ReplaceAllString(message, "${1}[REDACTED]")
	message = probeAssignmentPattern.ReplaceAllString(message, "${1}=[REDACTED]")
	message = probeQueryPattern.ReplaceAllString(message, "${1}[REDACTED]")
	if line, _, found := strings.Cut(message, "\n"); found {
		message = line
	}
	message = strings.TrimSpace(strings.TrimPrefix(message, "Error:"))
	runes := []rune(message)
	if len(runes) > 320 {
		message = string(runes[:320]) + "..."
	}
	return message
}

func normalizeBridgeEvent(raw bridgeEvent) Event {
	event := Event{
		Engine:          "pi",
		SessionID:       raw.ID,
		Text:            raw.Content,
		ToolName:        raw.ToolName,
		ToolCallID:      raw.ToolCallID,
		DurationMS:      raw.DurationMS,
		Tools:           raw.Tools,
		Extensions:      raw.Extensions,
		Skills:          raw.Skills,
		ExecutionMode:   raw.ExecutionMode,
		ApprovalPolicy:  raw.ApprovalPolicy,
		Capabilities:    raw.Capabilities,
		RequestID:       raw.RequestID,
		Input:           raw.Input,
		Reason:          raw.Reason,
		Approved:        raw.Approved,
		BackgroundTasks: raw.Tasks,
		Goal:            raw.Goal,
		Resumed:         raw.Resumed,
		Aborted:         raw.Aborted,
		Compaction:      raw.Compaction,
		Steering:        raw.Steering,
		FollowUp:        raw.FollowUp,
		ModelSource:     raw.Source,
		Module:          raw.Module,
		Usage:           raw.Usage,
	}
	switch raw.Type {
	case "ready":
		event.Type = "session.ready"
	case "policy_updated":
		event.Type = "session.policy_updated"
	case "turn_policy":
		event.Type = "session.turn_policy"
	case "turn_policy_cleared":
		event.Type = "session.turn_policy_cleared"
	case "model_selected":
		event.Type = "session.model_selected"
	case "model_source_selected":
		event.Type = "session.model_source"
	case "model_source_fallback":
		event.Type = "session.model_source"
		event.ModelSource = raw.To
		event.Reason = raw.Reason
	case "turn_started":
		event.Type = "assistant.started"
	case "goal_state":
		event.Type = "session.goal_updated"
	case "queue_update":
		event.Type = "session.queue_updated"
	case "steer_rejected":
		event.Type = "session.steer_rejected"
		event.Error = raw.Error
	case "text_delta":
		event.Type = "assistant.delta"
		event.Text = raw.Delta
	case "message_done":
		event.Type = "assistant.completed"
		event.Done = true
	case "message_segment_done":
		event.Type = "assistant.segment_completed"
		event.Done = true
	case "turn_settled":
		event.Type = "assistant.settled"
		event.Done = true
	case "tool_call_start":
		event.Type = "tool.started"
	case "tool_call_progress":
		event.Type = "tool.progress"
		event.Text = ""
	case "tool_call_end":
		event.Type = "tool.completed"
		event.Done = true
		if raw.IsError {
			event.Error = raw.Content
		}
	case "usage_recorded":
		event.Type = "usage.recorded"
	case "approval_requested":
		event.Type = "approval.requested"
	case "approval_resolved":
		event.Type = "approval.resolved"
		event.Done = true
	case "session_destroyed":
		event.Type = "session.destroyed"
		event.Done = true
	case "background_tasks":
		event.Type = "runtime.background_tasks"
	case "background_task_controlled":
		event.Type = "runtime.background_task_controlled"
	case "compaction_start":
		event.Type = "runtime.compaction_started"
	case "compaction_end":
		event.Type = "runtime.compaction_completed"
		event.Error = raw.Error
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
		"tokenflux": "TOKENFLUX_API_KEY",
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
	if configured, exists := settings.Providers[provider]; exists && configured.Custom {
		modelConfigured := false
		for _, candidate := range configured.Models {
			if strings.TrimSpace(candidate) == model {
				modelConfigured = true
				break
			}
		}
		if !modelConfigured {
			return fmt.Errorf("custom relay %s does not contain model %q", provider, model)
		}
		if !configured.Enabled || strings.TrimSpace(configured.APIKey) == "" {
			return fmt.Errorf("%s/%s cannot start; enable the custom relay and add its API key in Settings", provider, model)
		}
		if configured.BaseURL == nil || strings.TrimSpace(*configured.BaseURL) == "" {
			return fmt.Errorf("%s/%s cannot start; add the custom relay Base URL in Settings", provider, model)
		}
		return nil
	}

	if len(resolvedModelSourceOrder(settings)) > 0 {
		return nil
	}

	environmentKey, supported := providerAPIKeyEnvironment(provider)
	if !supported {
		return fmt.Errorf("model provider %q is not supported by the local Agent runtime", provider)
	}
	if configured, exists := settings.Providers[provider]; exists {
		if !configured.Enabled {
			return fmt.Errorf("%s/%s cannot start because both model sources are unavailable; enable the personal API key or connect the beta account quota in Settings", provider, model)
		}
		if strings.TrimSpace(configured.APIKey) == "" {
			return fmt.Errorf("%s/%s cannot start because both model sources are unavailable; add a personal API key or connect the beta account quota in Settings", provider, model)
		}
	}
	if strings.TrimSpace(os.Getenv(environmentKey)) == "" {
		return fmt.Errorf("%s/%s cannot start because both model sources are unavailable; add a personal API key or connect the beta account quota in Settings", provider, model)
	}
	return nil
}

func engineEnvironment(settings config.AppSettings) []string {
	environment := safeBaseEnvironment(os.Environ())
	activeProvider, activeProviderConfigured := settings.Providers[settings.ActiveProvider]
	activeCustomProvider := activeProviderConfigured && activeProvider.Custom
	for name, provider := range settings.Providers {
		if provider.Custom {
			continue
		}
		key, supported := providerAPIKeyEnvironment(name)
		if !supported || !provider.Enabled || provider.APIKey == "" {
			continue
		}
		environment = append(environment, key+"="+provider.APIKey)
		if provider.BaseURL != nil && strings.TrimSpace(*provider.BaseURL) != "" {
			environment = append(environment, strings.ToUpper(name)+"_BASE_URL="+strings.TrimSpace(*provider.BaseURL))
		}
	}
	if activeCustomProvider && activeProvider.Enabled && activeProvider.APIKey != "" && activeProvider.BaseURL != nil {
		environment = append(
			environment,
			"MILKSU_CUSTOM_PROVIDER_ID="+settings.ActiveProvider,
			"MILKSU_CUSTOM_PROVIDER_NAME="+strings.TrimSpace(activeProvider.Name),
			"MILKSU_CUSTOM_PROVIDER_KEY="+activeProvider.APIKey,
			"MILKSU_CUSTOM_PROVIDER_URL="+strings.TrimSpace(*activeProvider.BaseURL),
		)
	}
	if key, supported := providerAPIKeyEnvironment(settings.ActiveProvider); supported {
		if _, configured := settings.Providers[settings.ActiveProvider]; !configured {
			if value := os.Getenv(key); value != "" {
				environment = append(environment, key+"="+value)
			}
		}
	}
	if relay := settings.Relay; !activeCustomProvider && relay != nil && relay.Enabled && relay.Key != "" {
		environment = append(environment, "MILKSU_RELAY_ENABLED=1", "MILKSU_RELAY_KEY="+relay.Key)
		if relay.URL != "" {
			environment = append(environment, "MILKSU_RELAY_URL="+relay.URL)
		}
	}
	if order := resolvedModelSourceOrder(settings); len(order) > 0 {
		environment = append(environment, "MILKSU_MODEL_SOURCE_ORDER="+strings.Join(order, ","))
		if modelSourceAutoFallback(settings) {
			environment = append(environment, "MILKSU_MODEL_SOURCE_FALLBACK=1")
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
		if projectRootContainsSidecar(root) {
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
			if projectRootContainsSidecar(directory) {
				return directory, nil
			}
			parent := filepath.Dir(directory)
			if parent == directory {
				break
			}
			directory = parent
		}
	}
	return "", fmt.Errorf("cannot locate MilkSU project root containing %s", developmentChatBridgePath)
}

func projectRootContainsSidecar(root string) bool {
	for _, relativePath := range []string{"go.mod", developmentChatBridgePath} {
		info, err := os.Stat(filepath.Join(root, relativePath))
		if err != nil || !info.Mode().IsRegular() {
			return false
		}
	}
	return true
}
