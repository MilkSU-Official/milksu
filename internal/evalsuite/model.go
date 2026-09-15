package evalsuite

import (
	"strings"
	"time"
)

const (
	SuiteCybench  = "cybench"
	SuiteSECBench = "sec-bench"
	SuiteAutoPen  = "autopen"
	SuiteFrontier = "frontier-harness"
	SuiteCyberGym = "cybergym"

	GroupSecurity = "security"
	GroupHarness  = "harness"

	KernelPi  = "pi"
	KernelDSH = "dsh"

	StateIdle     = "idle"
	StateRunning  = "running"
	StateStopping = "stopping"

	ErrorKindProvider = "provider"
	ErrorKindNetwork  = "network"
	ErrorKindRuntime  = "runtime"
	ErrorKindStopped  = "stopped"
)

type ModelRef struct {
	Provider string `json:"provider"`
	Model    string `json:"model"`
	Source   string `json:"source,omitempty"`
	Kernel   string `json:"kernel,omitempty"`
}

func (m ModelRef) Key() string {
	return NormalizeKernel(m.Kernel) + "::" + m.Provider + "::" + m.Model
}

func (m ModelRef) usable() bool {
	return strings.TrimSpace(m.Provider) != "" && strings.TrimSpace(m.Model) != ""
}

func NormalizeKernel(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case KernelDSH, "deepseek", "deepseek-harness":
		return KernelDSH
	default:
		return KernelPi
	}
}

type ActivityStep struct {
	ID         string `json:"id"`
	Tool       string `json:"tool"`
	Summary    string `json:"summary"`
	Detail     string `json:"detail,omitempty"`
	Running    bool   `json:"running"`
	DurationMS int64  `json:"durationMs,omitempty"`
}

type ReplyTurn struct {
	TaskName string `json:"taskName"`
	Reply    string `json:"reply,omitempty"`
	Passed   bool   `json:"passed,omitempty"`
}

type ScoreRecord struct {
	Model        ModelRef  `json:"model"`
	Solved       int       `json:"solved"`
	Total        int       `json:"total"`
	Score        float64   `json:"score"`
	Curve        []float64 `json:"curve,omitempty"`
	Runs         []float64 `json:"runs,omitempty"`
	MedianTimeMS int64     `json:"medianTimeMs,omitempty"`
	TotalTimeMS  int64     `json:"totalTimeMs,omitempty"`
	InputTokens  int64     `json:"inputTokens,omitempty"`
	OutputTokens int64     `json:"outputTokens,omitempty"`
	CacheRead    int64     `json:"cacheReadTokens,omitempty"`
	CacheWrite   int64     `json:"cacheWriteTokens,omitempty"`
	TotalTokens  int64     `json:"totalTokens,omitempty"`
	CostUSD      float64   `json:"costUsd,omitempty"`
	CacheHitPct  float64   `json:"cacheHitPct,omitempty"`
	UpdatedAt    int64     `json:"updatedAt"`
}

type Progress struct {
	State      string         `json:"state"`
	Suite      string         `json:"suite"`
	Model      ModelRef       `json:"model"`
	All        bool           `json:"all"`
	Percent    int            `json:"percent"`
	ElapsedMS  int64          `json:"elapsedMs"`
	RemainMS   int64          `json:"remainMs,omitempty"`
	TaskName   string         `json:"taskName,omitempty"`
	TaskIndex  int            `json:"taskIndex,omitempty"`
	TaskTotal  int            `json:"taskTotal,omitempty"`
	ModelIndex int            `json:"modelIndex,omitempty"`
	ModelTotal int            `json:"modelTotal,omitempty"`
	Summary    string         `json:"summary,omitempty"`
	Reply      string         `json:"reply,omitempty"`
	Turns      []ReplyTurn    `json:"turns,omitempty"`
	Steps      []ActivityStep `json:"steps,omitempty"`
	ErrorKind  string         `json:"errorKind,omitempty"`
	Error      string         `json:"error,omitempty"`
}

type SuiteView struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Purpose  string `json:"purpose"`
	Group    string `json:"group,omitempty"`
	Runnable bool   `json:"runnable"`
	TaskN    int    `json:"taskN"`
	Missing  string `json:"missing,omitempty"`
}

type BoardModel struct {
	Model        ModelRef  `json:"model"`
	Score        *float64  `json:"score"`
	Rank         *int      `json:"rank"`
	Solved       *int      `json:"solved"`
	Total        int       `json:"total"`
	Curve        []float64 `json:"curve,omitempty"`
	Runs         []float64 `json:"runs,omitempty"`
	MedianTimeMS int64     `json:"medianTimeMs,omitempty"`
	TotalTokens  int64     `json:"totalTokens,omitempty"`
	CostUSD      float64   `json:"costUsd,omitempty"`
	CacheHitPct  float64   `json:"cacheHitPct,omitempty"`
}

type SuiteBoard struct {
	Suite  SuiteView    `json:"suite"`
	Models []BoardModel `json:"models"`
}

type BoardSnapshot struct {
	Suites   []SuiteView  `json:"suites"`
	Selected string       `json:"selected"`
	Models   []BoardModel `json:"models"`
	All      []SuiteBoard `json:"all"`
	Focused  *ScoreRecord `json:"focused,omitempty"`
	Progress *Progress    `json:"progress,omitempty"`
}

type StartRequest struct {
	Suite    string     `json:"suite"`
	Provider string     `json:"provider"`
	Model    string     `json:"model"`
	Source   string     `json:"source"`
	Kernel   string     `json:"kernel,omitempty"`
	Smoke    bool       `json:"smoke,omitempty"`
	Models   []ModelRef `json:"models,omitempty"`
}

func nowMillis() int64 {
	return time.Now().UnixMilli()
}
