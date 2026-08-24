package evalsuite

import (
	"strings"
	"time"
)

const (
	SuiteCybench  = "cybench"
	SuiteSECBench = "sec-bench"
	SuiteAutoPen  = "autopen"

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
}

func (m ModelRef) Key() string {
	return m.Provider + "::" + m.Model
}

func (m ModelRef) usable() bool {
	return strings.TrimSpace(m.Provider) != "" && strings.TrimSpace(m.Model) != ""
}

type ActivityStep struct {
	ID         string `json:"id"`
	Tool       string `json:"tool"`
	Summary    string `json:"summary"`
	Detail     string `json:"detail,omitempty"`
	Running    bool   `json:"running"`
	DurationMS int64  `json:"durationMs,omitempty"`
}

type ScoreRecord struct {
	Model     ModelRef  `json:"model"`
	Solved    int       `json:"solved"`
	Total     int       `json:"total"`
	Score     float64   `json:"score"`
	Curve     []float64 `json:"curve,omitempty"`
	Runs      []float64 `json:"runs,omitempty"`
	UpdatedAt int64     `json:"updatedAt"`
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
	Steps      []ActivityStep `json:"steps,omitempty"`
	ErrorKind  string         `json:"errorKind,omitempty"`
	Error      string         `json:"error,omitempty"`
}

type SuiteView struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Purpose  string `json:"purpose"`
	Runnable bool   `json:"runnable"`
	TaskN    int    `json:"taskN"`
}

type BoardModel struct {
	Model  ModelRef  `json:"model"`
	Score  *float64  `json:"score"`
	Rank   *int      `json:"rank"`
	Solved *int      `json:"solved"`
	Total  int       `json:"total"`
	Curve  []float64 `json:"curve,omitempty"`
	Runs   []float64 `json:"runs,omitempty"`
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
	Models   []ModelRef `json:"models,omitempty"`
}

func nowMillis() int64 {
	return time.Now().UnixMilli()
}
