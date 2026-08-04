package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/MilkSU-Official/milksu/internal/appdata"
	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

const (
	startupRecoverySmokeResultEnv = "MILKSU_STARTUP_RECOVERY_SMOKE_RESULT"
	startupRecoverySmokeQuitEnv   = "MILKSU_STARTUP_RECOVERY_SMOKE_QUIT"

	startupRecoverySmokeSchema = "milksu-startup-recovery-packaged-smoke/v1"
)

type startupRecoverySmokeReport struct {
	Schema        string                    `json:"schema"`
	RanAt         string                    `json:"ranAt"`
	DataDirectory string                    `json:"dataDirectory"`
	Startup       appdata.LifespanStart     `json:"startup"`
	Persisted     appdata.LifespanState     `json:"persisted"`
	Gates         startupRecoverySmokeGates `json:"gates"`
	Limitations   []string                  `json:"limitations,omitempty"`
	Error         string                    `json:"error,omitempty"`
}

type startupRecoverySmokeGates struct {
	DetectedPreviousAbnormalExit bool `json:"detectedPreviousAbnormalExit"`
	PreviousPIDRecorded          bool `json:"previousPidRecorded"`
	CurrentRunMarkedRunning      bool `json:"currentRunMarkedRunning"`
	CurrentPIDRecorded           bool `json:"currentPidRecorded"`
	AbnormalCountIncremented     bool `json:"abnormalCountIncremented"`
	NoSessionContent             bool `json:"noSessionContent"`
}

func (a *App) maybeRunStartupRecoverySmoke() {
	resultPath := strings.TrimSpace(os.Getenv(startupRecoverySmokeResultEnv))
	if resultPath == "" {
		return
	}
	report := a.buildStartupRecoverySmokeReport()
	if err := writeStartupRecoverySmokeReport(resultPath, report); err != nil {
		a.diagnostics.Record("startup-recovery", "error", "packaged startup recovery smoke report failed")
	}
	if strings.TrimSpace(os.Getenv(startupRecoverySmokeQuitEnv)) == "1" && a.ctx != nil {
		go func() {
			time.Sleep(250 * time.Millisecond)
			wailsruntime.Quit(a.ctx)
		}()
	}
}

func (a *App) buildStartupRecoverySmokeReport() startupRecoverySmokeReport {
	report := startupRecoverySmokeReport{
		Schema:        startupRecoverySmokeSchema,
		RanAt:         time.Now().UTC().Format(time.RFC3339Nano),
		DataDirectory: a.dataDirectory,
		Startup:       a.lifespanStart,
		Limitations: []string{
			"This smoke verifies the packaged App lifespan marker and startup recovery classification.",
			"It does not replay unfinished Coding, CTF or CVE jobs; those use their own recovery smokes.",
		},
	}
	state, err := appdata.ReadLifespanState(a.dataDirectory)
	if err != nil {
		report.Error = fmt.Sprintf("read current lifespan marker: %v", err)
		return report
	}
	report.Persisted = state
	report.Gates.DetectedPreviousAbnormalExit = a.lifespanStart.PreviousExit == appdata.LifespanExitAbnormal
	report.Gates.PreviousPIDRecorded = a.lifespanStart.PreviousPID > 0
	report.Gates.CurrentRunMarkedRunning = state.LastExit == appdata.LifespanExitRunning
	report.Gates.CurrentPIDRecorded = state.PID == os.Getpid()
	report.Gates.AbnormalCountIncremented = a.lifespanStart.ConsecutiveAbnormalExits > 0 &&
		state.ConsecutiveAbnormalExits == a.lifespanStart.ConsecutiveAbnormalExits
	report.Gates.NoSessionContent = !startupRecoverySmokeContainsSensitiveShape(report)
	return report
}

func startupRecoverySmokeContainsSensitiveShape(report startupRecoverySmokeReport) bool {
	encoded, err := json.Marshal(report)
	if err != nil {
		return true
	}
	lower := strings.ToLower(string(encoded))
	for _, forbidden := range []string{
		"api_key",
		"apikey",
		"authorization",
		"bearer ",
		"sk-",
		"tool output",
		"message content",
	} {
		if strings.Contains(lower, forbidden) {
			return true
		}
	}
	return false
}

func writeStartupRecoverySmokeReport(path string, report startupRecoverySmokeReport) error {
	absolute, err := filepath.Abs(path)
	if err != nil {
		return fmt.Errorf("resolve startup recovery smoke report path: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(absolute), 0o700); err != nil {
		return fmt.Errorf("create startup recovery smoke report directory: %w", err)
	}
	payload, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		return fmt.Errorf("encode startup recovery smoke report: %w", err)
	}
	payload = append(payload, '\n')
	temporary, err := os.CreateTemp(filepath.Dir(absolute), ".milksu-startup-recovery-smoke-*")
	if err != nil {
		return fmt.Errorf("create temporary startup recovery smoke report: %w", err)
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(0o600); err != nil {
		temporary.Close()
		return fmt.Errorf("protect temporary startup recovery smoke report: %w", err)
	}
	if _, err := temporary.Write(payload); err != nil {
		temporary.Close()
		return fmt.Errorf("write temporary startup recovery smoke report: %w", err)
	}
	if err := temporary.Sync(); err != nil {
		temporary.Close()
		return fmt.Errorf("sync temporary startup recovery smoke report: %w", err)
	}
	if err := temporary.Close(); err != nil {
		return fmt.Errorf("close temporary startup recovery smoke report: %w", err)
	}
	if err := os.Rename(temporaryPath, absolute); err != nil {
		return fmt.Errorf("install startup recovery smoke report: %w", err)
	}
	if err := os.Chmod(absolute, 0o600); err != nil {
		return fmt.Errorf("protect startup recovery smoke report: %w", err)
	}
	return nil
}
