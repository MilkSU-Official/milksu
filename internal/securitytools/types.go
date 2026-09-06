package securitytools

import "time"

const (
	ToolIDA         = "ida-pro"
	ToolCapa        = "capa"
	ToolCodeQL      = "codeql"
	ToolBurp        = "burp-suite"
	ToolShannon     = "shannon"
	ToolGhidraRPC   = "ghidra-rpc"
	ToolJADXAndroid = "jadx-android-malware"
)

const (
	GhidraRPCSource        = "https://github.com/cellebrite-labs/ghidra-rpc"
	GhidraRPCRevision      = "1743305487b1de754fb750486dd468ea4d3c4141"
	GhidraRPCHeadDate      = "2026-08-06"
	GhidraRPCTag           = "v0.2.0"
	GhidraRPCTagRevision   = "ad507753469d01c7a0faee8b2b2b54ba9367b46e"
	GhidraRPCWinFork       = "assaflevy/ghidra-rpc-win"
	JADXSkillSource        = "https://github.com/mukul975/Anthropic-Cybersecurity-Skills"
	JADXSkillMirror        = "https://github.com/plurigrid/asi"
	JADXSkillMirrorSubtree = "plugins/asi/skills/reverse-engineering-android-malware-with-jadx"
	JADXSkillSubtree       = "skills/reverse-engineering-android-malware-with-jadx"
	JADXSkillTag           = "v1.3.0"
	JADXSkillRevision      = "101ca0bd887a295e39cc20a100efa571937ca969"
	JADXSkillMainTip       = "54a79883"
	InjuredAndroidAPK      = "InjuredAndroid-1.0.12-release.apk"
)

// GatedOverlayIDs are factory RE overlays that stay off the model catalog
// until a local tool is ready and the user enables the row.
var GatedOverlayIDs = []string{ToolGhidraRPC, ToolJADXAndroid}

func DefaultEnabled(id string) bool {
	switch id {
	case ToolGhidraRPC, ToolJADXAndroid:
		return false
	default:
		return true
	}
}

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
	WorkspacePath  string `json:"workspacePath,omitempty"`
	ExecutionMode  string `json:"executionMode"`
	ApprovalPolicy string `json:"approvalPolicy"`
}

// RuntimeTool is the display-free, recomputed descriptor sent to Pi for one
// Coding turn. Paths are produced by MilkSU detection rather than settings.
type RuntimeTool struct {
	ID           string   `json:"id"`
	Command      string   `json:"command"`
	Args         []string `json:"args,omitempty"`
	Version      string   `json:"version"`
	ProfilePath  string   `json:"profilePath,omitempty"`
	IDAPath      string   `json:"idaPath,omitempty"`
	UserIDAPath  string   `json:"userIdaPath,omitempty"`
	Capabilities []string `json:"capabilities"`
}
