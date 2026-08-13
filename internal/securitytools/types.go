package securitytools

import "time"

const (
	ToolIDA     = "ida-pro"
	ToolCapa    = "capa"
	ToolCodeQL  = "codeql"
	ToolBurp    = "burp-suite"
	ToolShannon = "shannon"
)

type Status string

const (
	StatusReady       Status = "ready"
	StatusDetected    Status = "detected"
	StatusNeedsSetup  Status = "needs_setup"
	StatusMissingApp  Status = "missing_app"
	StatusUnavailable Status = "unavailable"
	StatusConfiguring Status = "configuring"
	StatusFailed      Status = "failed"
)

type ToolSnapshot struct {
	ID              string   `json:"id"`
	Name            string   `json:"name"`
	Purpose         string   `json:"purpose"`
	Status          Status   `json:"status"`
	StatusLabel     string   `json:"statusLabel"`
	Enabled         bool     `json:"enabled"`
	UsableByAgent   bool     `json:"usableByAgent"`
	Version         string   `json:"version,omitempty"`
	Connection      string   `json:"connection"`
	Runtime         string   `json:"runtime"`
	Capabilities    []string `json:"capabilities"`
	Schema          []string `json:"schema"`
	Problem         string   `json:"problem,omitempty"`
	PrimaryAction   string   `json:"primaryAction,omitempty"`
	SetupSupported  bool     `json:"setupSupported"`
	CodingSupported bool     `json:"codingSupported"`
}

type SetupStep struct {
	ID     string `json:"id"`
	Label  string `json:"label"`
	Status string `json:"status"`
	Detail string `json:"detail,omitempty"`
}

type SetupSnapshot struct {
	ToolID      string      `json:"toolId"`
	State       string      `json:"state"`
	Percent     int         `json:"percent"`
	Summary     string      `json:"summary"`
	Steps       []SetupStep `json:"steps"`
	Error       string      `json:"error,omitempty"`
	StartedAt   time.Time   `json:"startedAt"`
	CompletedAt *time.Time  `json:"completedAt,omitempty"`
}

type CodingHandoff struct {
	ToolID         string `json:"toolId"`
	Title          string `json:"title"`
	Prompt         string `json:"prompt"`
	VisibleText    string `json:"visibleText"`
	ExecutionMode  string `json:"executionMode"`
	ApprovalPolicy string `json:"approvalPolicy"`
}

// RuntimeTool is the display-free, recomputed descriptor sent to Pi for one
// Coding turn. Paths are produced by MilkSU detection rather than settings.
type RuntimeTool struct {
	ID           string   `json:"id"`
	Command      string   `json:"command"`
	Version      string   `json:"version"`
	ProfilePath  string   `json:"profilePath,omitempty"`
	IDAPath      string   `json:"idaPath,omitempty"`
	UserIDAPath  string   `json:"userIdaPath,omitempty"`
	Capabilities []string `json:"capabilities"`
}
