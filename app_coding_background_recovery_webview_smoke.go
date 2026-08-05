package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const (
	codingBackgroundRecoveryWebViewSmokeResultEnv      = "MILKSU_CODING_BACKGROUND_RECOVERY_WEBVIEW_SMOKE_RESULT"
	codingBackgroundRecoveryWebViewSmokePhaseEnv       = "MILKSU_CODING_BACKGROUND_RECOVERY_WEBVIEW_SMOKE_PHASE"
	codingBackgroundRecoveryWebViewSmokeWorkspaceEnv   = "MILKSU_CODING_BACKGROUND_RECOVERY_WEBVIEW_SMOKE_WORKSPACE"
	codingBackgroundRecoveryWebViewSmokeCommandEnv     = "MILKSU_CODING_BACKGROUND_RECOVERY_WEBVIEW_SMOKE_COMMAND"
	codingBackgroundRecoveryWebViewSmokeExpectedPIDEnv = "MILKSU_CODING_BACKGROUND_RECOVERY_WEBVIEW_SMOKE_EXPECTED_PID"

	codingBackgroundRecoveryWebViewSmokeSchema = "milksu-coding-background-recovery-webview-smoke/v1"
)

type codingBackgroundRecoveryWebViewSmokeRequest struct {
	Enabled     bool   `json:"enabled"`
	Phase       string `json:"phase,omitempty"`
	Workspace   string `json:"workspace,omitempty"`
	Command     string `json:"command,omitempty"`
	ExpectedPID int    `json:"expectedPid,omitempty"`
}

type codingBackgroundRecoveryWebViewSmokeReport struct {
	Schema        string                                    `json:"schema"`
	RanAt         string                                    `json:"ranAt"`
	DataDirectory string                                    `json:"dataDirectory"`
	Phase         string                                    `json:"phase"`
	Workspace     string                                    `json:"workspace"`
	Command       string                                    `json:"command,omitempty"`
	ObservedPID   int                                       `json:"observedPid,omitempty"`
	Gates         codingBackgroundRecoveryWebViewSmokeGates `json:"gates"`
	Observations  []string                                  `json:"observations,omitempty"`
	Error         string                                    `json:"error,omitempty"`
}

type codingBackgroundRecoveryWebViewSmokeGates struct {
	CodingPageOpened      bool `json:"codingPageOpened"`
	TerminalPanelOpened   bool `json:"terminalPanelOpened"`
	TasksTabOpened        bool `json:"tasksTabOpened"`
	CommandEntered        bool `json:"commandEntered"`
	RunClicked            bool `json:"runClicked"`
	TaskVisible           bool `json:"taskVisible"`
	TaskRunning           bool `json:"taskRunning"`
	PIDVisible            bool `json:"pidVisible"`
	LogTailVisible        bool `json:"logTailVisible"`
	RecoveryBannerVisible bool `json:"recoveryBannerVisible"`
	StopClicked           bool `json:"stopClicked"`
	TaskStopped           bool `json:"taskStopped"`
	RecoveredPIDMatched   bool `json:"recoveredPidMatched"`
	NoCredentialLeak      bool `json:"noCredentialLeak"`
}

func (a *App) GetCodingBackgroundRecoveryWebViewSmokeRequest() codingBackgroundRecoveryWebViewSmokeRequest {
	resultPath := strings.TrimSpace(os.Getenv(codingBackgroundRecoveryWebViewSmokeResultEnv))
	if resultPath == "" {
		return codingBackgroundRecoveryWebViewSmokeRequest{}
	}
	phase := strings.TrimSpace(os.Getenv(codingBackgroundRecoveryWebViewSmokePhaseEnv))
	if phase == "" {
		phase = "recover"
	}
	return codingBackgroundRecoveryWebViewSmokeRequest{
		Enabled:     true,
		Phase:       phase,
		Workspace:   strings.TrimSpace(os.Getenv(codingBackgroundRecoveryWebViewSmokeWorkspaceEnv)),
		Command:     strings.TrimSpace(os.Getenv(codingBackgroundRecoveryWebViewSmokeCommandEnv)),
		ExpectedPID: parseCodingBackgroundRecoverySmokePID(os.Getenv(codingBackgroundRecoveryWebViewSmokeExpectedPIDEnv)),
	}
}

func (a *App) CompleteCodingBackgroundRecoveryWebViewSmoke(
	report codingBackgroundRecoveryWebViewSmokeReport,
) error {
	resultPath := strings.TrimSpace(os.Getenv(codingBackgroundRecoveryWebViewSmokeResultEnv))
	if resultPath == "" {
		return errors.New("Coding background recovery WebView smoke is not enabled")
	}
	report.Schema = codingBackgroundRecoveryWebViewSmokeSchema
	report.RanAt = time.Now().UTC().Format(time.RFC3339Nano)
	report.DataDirectory = a.dataDirectory
	report.Gates.NoCredentialLeak = !codingBackgroundRecoveryWebViewSmokeContainsSensitiveShape(report)
	if !report.Gates.NoCredentialLeak {
		return errors.New("Coding background recovery WebView smoke report contains sensitive-shaped content")
	}
	return writeCodingBackgroundRecoveryWebViewSmokeReport(resultPath, report)
}

func writeCodingBackgroundRecoveryWebViewSmokeReport(
	path string,
	report codingBackgroundRecoveryWebViewSmokeReport,
) error {
	absolute, err := filepath.Abs(path)
	if err != nil {
		return fmt.Errorf("resolve Coding background recovery WebView smoke report path: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(absolute), 0o700); err != nil {
		return fmt.Errorf("create Coding background recovery WebView smoke report directory: %w", err)
	}
	payload, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		return fmt.Errorf("encode Coding background recovery WebView smoke report: %w", err)
	}
	payload = append(payload, '\n')
	temporary, err := os.CreateTemp(filepath.Dir(absolute), ".milksu-coding-bg-webview-smoke-*")
	if err != nil {
		return fmt.Errorf("create temporary Coding background recovery WebView smoke report: %w", err)
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(0o600); err != nil {
		temporary.Close()
		return fmt.Errorf("protect temporary Coding background recovery WebView smoke report: %w", err)
	}
	if _, err := temporary.Write(payload); err != nil {
		temporary.Close()
		return fmt.Errorf("write temporary Coding background recovery WebView smoke report: %w", err)
	}
	if err := temporary.Sync(); err != nil {
		temporary.Close()
		return fmt.Errorf("sync temporary Coding background recovery WebView smoke report: %w", err)
	}
	if err := temporary.Close(); err != nil {
		return fmt.Errorf("close temporary Coding background recovery WebView smoke report: %w", err)
	}
	if err := os.Rename(temporaryPath, absolute); err != nil {
		return fmt.Errorf("install Coding background recovery WebView smoke report: %w", err)
	}
	return os.Chmod(absolute, 0o600)
}

func codingBackgroundRecoveryWebViewSmokeContainsSensitiveShape(
	report codingBackgroundRecoveryWebViewSmokeReport,
) bool {
	encoded, err := json.Marshal(report)
	if err != nil {
		return true
	}
	lower := strings.ToLower(string(encoded))
	for _, forbidden := range []string{
		"sk-",
		"ghp_",
		"github_pat_",
		"authorization: bearer",
		"bearer ",
		"api_key=",
		"password=",
		"secret=",
		"token=",
	} {
		if strings.Contains(lower, forbidden) {
			return true
		}
	}
	return false
}
