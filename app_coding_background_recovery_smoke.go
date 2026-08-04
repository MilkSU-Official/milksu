package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/MilkSU-Official/milksu/internal/engine"
	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

const (
	codingBackgroundRecoverySmokeResultEnv       = "MILKSU_CODING_BACKGROUND_RECOVERY_SMOKE_RESULT"
	codingBackgroundRecoverySmokePhaseEnv        = "MILKSU_CODING_BACKGROUND_RECOVERY_SMOKE_PHASE"
	codingBackgroundRecoverySmokeWorkspaceEnv    = "MILKSU_CODING_BACKGROUND_RECOVERY_SMOKE_WORKSPACE"
	codingBackgroundRecoverySmokeConversationEnv = "MILKSU_CODING_BACKGROUND_RECOVERY_SMOKE_CONVERSATION"
	codingBackgroundRecoverySmokeCommandEnv      = "MILKSU_CODING_BACKGROUND_RECOVERY_SMOKE_COMMAND"
	codingBackgroundRecoverySmokeHeartbeatEnv    = "MILKSU_CODING_BACKGROUND_RECOVERY_SMOKE_HEARTBEAT"
	codingBackgroundRecoverySmokeExpectedPIDEnv  = "MILKSU_CODING_BACKGROUND_RECOVERY_SMOKE_EXPECTED_PID"
	codingBackgroundRecoverySmokeQuitEnv         = "MILKSU_CODING_BACKGROUND_RECOVERY_SMOKE_QUIT"

	codingBackgroundRecoverySmokeSchema = "milksu-coding-background-recovery-packaged-smoke/v1"
)

type codingBackgroundRecoverySmokeReport struct {
	Schema         string                             `json:"schema"`
	RanAt          string                             `json:"ranAt"`
	Phase          string                             `json:"phase"`
	DataDirectory  string                             `json:"dataDirectory"`
	ConversationID string                             `json:"conversationId"`
	Workspace      string                             `json:"workspace"`
	Command        string                             `json:"command,omitempty"`
	HeartbeatPath  string                             `json:"heartbeatPath,omitempty"`
	HeartbeatBytes int64                              `json:"heartbeatBytes,omitempty"`
	HeartbeatLines int                                `json:"heartbeatLines,omitempty"`
	Status         engine.RuntimeStatus               `json:"status"`
	StopStatus     *engine.RuntimeStatus              `json:"stopStatus,omitempty"`
	Task           *engine.BackgroundTask             `json:"task,omitempty"`
	Gates          codingBackgroundRecoverySmokeGates `json:"gates"`
	Limitations    []string                           `json:"limitations,omitempty"`
	Error          string                             `json:"error,omitempty"`
}

type codingBackgroundRecoverySmokeGates struct {
	TaskRunning                bool `json:"taskRunning"`
	TaskHasPID                 bool `json:"taskHasPid"`
	LogTailObserved            bool `json:"logTailObserved"`
	HeartbeatObserved          bool `json:"heartbeatObserved"`
	RecoveredAfterAppRestart   bool `json:"recoveredAfterAppRestart"`
	RecoveredPIDMatchesStarted bool `json:"recoveredPidMatchesStarted"`
	TaskStopped                bool `json:"taskStopped"`
	NoCredentialLeak           bool `json:"noCredentialLeak"`
}

func (a *App) maybeRunCodingBackgroundRecoverySmoke() {
	resultPath := strings.TrimSpace(os.Getenv(codingBackgroundRecoverySmokeResultEnv))
	if resultPath == "" {
		return
	}
	report := a.buildCodingBackgroundRecoverySmokeReport(
		strings.TrimSpace(os.Getenv(codingBackgroundRecoverySmokePhaseEnv)),
		strings.TrimSpace(os.Getenv(codingBackgroundRecoverySmokeConversationEnv)),
		strings.TrimSpace(os.Getenv(codingBackgroundRecoverySmokeWorkspaceEnv)),
		strings.TrimSpace(os.Getenv(codingBackgroundRecoverySmokeCommandEnv)),
		strings.TrimSpace(os.Getenv(codingBackgroundRecoverySmokeHeartbeatEnv)),
		strings.TrimSpace(os.Getenv(codingBackgroundRecoverySmokeExpectedPIDEnv)),
	)
	if err := writeCodingBackgroundRecoverySmokeReport(resultPath, report); err != nil {
		a.diagnostics.Record("coding-background", "error", "packaged Coding background recovery smoke report failed")
	}
	if strings.TrimSpace(os.Getenv(codingBackgroundRecoverySmokeQuitEnv)) == "1" && a.ctx != nil {
		go func() {
			time.Sleep(250 * time.Millisecond)
			wailsruntime.Quit(a.ctx)
		}()
	}
}

func (a *App) buildCodingBackgroundRecoverySmokeReport(
	phase,
	conversationID,
	workspacePath,
	commandText,
	heartbeatPath,
	expectedPIDText string,
) codingBackgroundRecoverySmokeReport {
	if phase == "" {
		phase = "recover"
	}
	report := codingBackgroundRecoverySmokeReport{
		Schema:         codingBackgroundRecoverySmokeSchema,
		RanAt:          time.Now().UTC().Format(time.RFC3339Nano),
		Phase:          phase,
		DataDirectory:  a.dataDirectory,
		ConversationID: conversationID,
		Workspace:      workspacePath,
		Command:        commandText,
		HeartbeatPath:  heartbeatPath,
		Limitations: []string{
			"This smoke verifies packaged App recovery for Coding background tasks only.",
			"It does not recover interactive PTY sessions or prove a full model-driven Coding task.",
		},
	}
	if conversationID == "" {
		report.Error = fmt.Sprintf("%s is required", codingBackgroundRecoverySmokeConversationEnv)
		report.Gates.NoCredentialLeak = !codingBackgroundRecoverySmokeContainsSensitiveShape(report)
		return report
	}
	if workspacePath == "" {
		report.Error = fmt.Sprintf("%s is required", codingBackgroundRecoverySmokeWorkspaceEnv)
		report.Gates.NoCredentialLeak = !codingBackgroundRecoverySmokeContainsSensitiveShape(report)
		return report
	}
	switch phase {
	case "start":
		if commandText == "" {
			report.Error = fmt.Sprintf("%s is required for start phase", codingBackgroundRecoverySmokeCommandEnv)
			break
		}
		status, err := a.StartCodingBackgroundTask(
			conversationID,
			workspacePath,
			commandText,
			"MilkSU background recovery smoke",
			"go",
			"workspace-auto",
		)
		if err != nil {
			report.Error = fmt.Sprintf("start Coding background task: %v", err)
			break
		}
		report.Status = status
		task, status, err := a.waitForCodingBackgroundSmokeTask(
			conversationID,
			workspacePath,
			heartbeatPath,
			"",
			true,
		)
		if err != nil {
			report.Error = err.Error()
			break
		}
		report.Status = status
		report.Task = &task
		report.populateCodingBackgroundRecoverySmokeGates(task, status, heartbeatPath, 0, false)
	case "recover":
		startedPID := parseCodingBackgroundRecoverySmokePID(expectedPIDText)
		task, status, err := a.waitForCodingBackgroundSmokeTask(
			conversationID,
			workspacePath,
			heartbeatPath,
			"recovered",
			true,
		)
		if err != nil {
			report.Error = err.Error()
			break
		}
		report.Status = status
		report.Task = &task
		report.populateCodingBackgroundRecoverySmokeGates(task, status, heartbeatPath, startedPID, true)
		stopStatus, err := a.StopCodingBackgroundTask(conversationID, task.ID)
		if err != nil {
			report.Error = fmt.Sprintf("stop recovered background task: %v", err)
			break
		}
		report.StopStatus = &stopStatus
		report.Gates.TaskStopped = !hasRunningCodingBackgroundTask(stopStatus.BackgroundTasks)
	default:
		report.Error = fmt.Sprintf("unsupported Coding background recovery smoke phase %q", phase)
	}
	report.Gates.NoCredentialLeak = !codingBackgroundRecoverySmokeContainsSensitiveShape(report)
	return report
}

func parseCodingBackgroundRecoverySmokePID(value string) int {
	var parsed int
	_, _ = fmt.Sscanf(strings.TrimSpace(value), "%d", &parsed)
	if parsed < 0 {
		return 0
	}
	return parsed
}

func (a *App) waitForCodingBackgroundSmokeTask(
	conversationID,
	workspacePath,
	heartbeatPath,
	requiredRecoveryState string,
	requireRunning bool,
) (engine.BackgroundTask, engine.RuntimeStatus, error) {
	deadline := time.Now().Add(12 * time.Second)
	var lastStatus engine.RuntimeStatus
	var lastTask *engine.BackgroundTask
	var lastErr error
	for time.Now().Before(deadline) {
		status, err := a.RefreshCodingBackgroundTasks(
			conversationID,
			workspacePath,
			"go",
			"workspace-auto",
		)
		if err != nil {
			lastErr = err
			time.Sleep(250 * time.Millisecond)
			continue
		}
		lastStatus = status
		for index := range status.BackgroundTasks {
			task := status.BackgroundTasks[index]
			if !strings.Contains(task.Name, "background recovery smoke") &&
				!strings.Contains(task.Command, "bg-worker.") {
				continue
			}
			lastTask = &task
			if requireRunning && task.Status != "running" {
				continue
			}
			if requiredRecoveryState != "" {
				recovery := status.BackgroundRecovery
				if recovery == nil || recovery.State != requiredRecoveryState {
					continue
				}
			}
			if heartbeatPath != "" && heartbeatLineCount(heartbeatPath) == 0 {
				continue
			}
			if !strings.Contains(task.LogTail, "MILKSU_BG_RECOVERY_READY") &&
				heartbeatPath == "" {
				continue
			}
			return task, status, nil
		}
		time.Sleep(250 * time.Millisecond)
	}
	if lastErr != nil {
		return engine.BackgroundTask{}, lastStatus, fmt.Errorf("wait for Coding background task: %v", lastErr)
	}
	if lastTask != nil {
		return engine.BackgroundTask{}, lastStatus, fmt.Errorf(
			"wait for Coding background task recovery timed out: last task status=%s recovery=%s",
			lastTask.Status,
			codingBackgroundRecoveryState(lastStatus),
		)
	}
	return engine.BackgroundTask{}, lastStatus, fmt.Errorf("wait for Coding background task recovery timed out: no task found")
}

func (report *codingBackgroundRecoverySmokeReport) populateCodingBackgroundRecoverySmokeGates(
	task engine.BackgroundTask,
	status engine.RuntimeStatus,
	heartbeatPath string,
	startedPID int,
	recoveryPhase bool,
) {
	report.Gates.TaskRunning = task.Status == "running"
	report.Gates.TaskHasPID = task.PID > 0 || task.PGID > 0
	report.Gates.LogTailObserved = strings.Contains(task.LogTail, "MILKSU_BG_RECOVERY_READY")
	lines := heartbeatLineCount(heartbeatPath)
	report.HeartbeatLines = lines
	if heartbeatPath != "" {
		if info, err := os.Stat(heartbeatPath); err == nil && info.Mode().IsRegular() {
			report.HeartbeatBytes = info.Size()
		}
	}
	report.Gates.HeartbeatObserved = lines > 0
	if recoveryPhase {
		report.Gates.RecoveredAfterAppRestart = status.BackgroundRecovery != nil &&
			status.BackgroundRecovery.State == "recovered"
		report.Gates.RecoveredPIDMatchesStarted = startedPID == 0 || task.PID == startedPID
	}
}

func hasRunningCodingBackgroundTask(tasks []engine.BackgroundTask) bool {
	for _, task := range tasks {
		if task.Status == "running" {
			return true
		}
	}
	return false
}

func codingBackgroundRecoveryState(status engine.RuntimeStatus) string {
	if status.BackgroundRecovery == nil {
		return ""
	}
	return status.BackgroundRecovery.State
}

func heartbeatLineCount(path string) int {
	path = strings.TrimSpace(path)
	if path == "" {
		return 0
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return 0
	}
	text := strings.TrimSpace(string(data))
	if text == "" {
		return 0
	}
	return strings.Count(text, "\n") + 1
}

func codingBackgroundRecoverySmokeContainsSensitiveShape(
	report codingBackgroundRecoverySmokeReport,
) bool {
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
		"password=",
		"credential=",
		"secret=",
		"token=",
	} {
		if strings.Contains(lower, forbidden) {
			return true
		}
	}
	return false
}

func writeCodingBackgroundRecoverySmokeReport(
	path string,
	report codingBackgroundRecoverySmokeReport,
) error {
	absolute, err := filepath.Abs(path)
	if err != nil {
		return fmt.Errorf("resolve Coding background recovery smoke report path: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(absolute), 0o700); err != nil {
		return fmt.Errorf("create Coding background recovery smoke report directory: %w", err)
	}
	payload, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		return fmt.Errorf("encode Coding background recovery smoke report: %w", err)
	}
	payload = append(payload, '\n')
	temporary, err := os.CreateTemp(filepath.Dir(absolute), ".milksu-coding-background-recovery-smoke-*")
	if err != nil {
		return fmt.Errorf("create temporary Coding background recovery smoke report: %w", err)
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(0o600); err != nil {
		temporary.Close()
		return fmt.Errorf("protect temporary Coding background recovery smoke report: %w", err)
	}
	if _, err := temporary.Write(payload); err != nil {
		temporary.Close()
		return fmt.Errorf("write temporary Coding background recovery smoke report: %w", err)
	}
	if err := temporary.Sync(); err != nil {
		temporary.Close()
		return fmt.Errorf("sync temporary Coding background recovery smoke report: %w", err)
	}
	if err := temporary.Close(); err != nil {
		return fmt.Errorf("close temporary Coding background recovery smoke report: %w", err)
	}
	if err := os.Rename(temporaryPath, absolute); err != nil {
		return fmt.Errorf("install Coding background recovery smoke report: %w", err)
	}
	if err := os.Chmod(absolute, 0o600); err != nil {
		return fmt.Errorf("protect Coding background recovery smoke report: %w", err)
	}
	return nil
}
