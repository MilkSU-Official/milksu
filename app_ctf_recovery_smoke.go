package main

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/MilkSU-Official/milksu/internal/ctf"
)

const (
	ctfRecoverySmokeResultEnv = "MILKSU_CTF_RECOVERY_SMOKE_RESULT"
	ctfRecoverySmokeModeEnv   = "MILKSU_CTF_RECOVERY_SMOKE_MODE"
	ctfRecoverySmokeJobIDEnv  = "MILKSU_CTF_RECOVERY_SMOKE_JOB_ID"

	ctfRecoverySmokeSchema = "milksu-ctf-recovery-packaged-smoke/v1"
)

type ctfRecoverySmokeReport struct {
	Schema        string                     `json:"schema"`
	RanAt         string                     `json:"ranAt"`
	Mode          string                     `json:"mode"`
	DataDirectory string                     `json:"dataDirectory"`
	JobID         string                     `json:"jobId,omitempty"`
	WorkspacePath string                     `json:"workspacePath,omitempty"`
	Projection    ctfRecoverySmokeProjection `json:"projection"`
	Handoff       ctfRecoverySmokeHandoff    `json:"handoff"`
	Checkpoint    ctfRecoverySmokeCheckpoint `json:"checkpoint"`
	Replay        ctfRecoverySmokeReplay     `json:"replay"`
	Files         ctfRecoverySmokeFiles      `json:"files"`
	Gates         ctfRecoverySmokeGates      `json:"gates"`
	Limitations   []string                   `json:"limitations,omitempty"`
	Error         string                     `json:"error,omitempty"`
}

type ctfRecoverySmokeProjection struct {
	Title             string `json:"title,omitempty"`
	Category          string `json:"category,omitempty"`
	CollaborationMode string `json:"collaborationMode,omitempty"`
	JobStatus         string `json:"jobStatus,omitempty"`
	MaterialCount     int    `json:"materialCount"`
	Listed            bool   `json:"listed"`
}

type ctfRecoverySmokeHandoff struct {
	ConversationID string `json:"conversationId,omitempty"`
	Role           string `json:"role,omitempty"`
	MaterialCount  int    `json:"materialCount"`
	PromptResumes  bool   `json:"promptResumes"`
}

type ctfRecoverySmokeCheckpoint struct {
	Status               string              `json:"status,omitempty"`
	ExitReason           string              `json:"exitReason,omitempty"`
	Model                string              `json:"model,omitempty"`
	Metrics              ctf.AgentRunMetrics `json:"metrics"`
	LastAssistantSummary string              `json:"lastAssistantSummary,omitempty"`
	NotesExcerptPresent  bool                `json:"notesExcerptPresent"`
	Progress             ctf.AgentProgress   `json:"progress"`
}

type ctfRecoverySmokeReplay struct {
	SchemaVersion  string               `json:"schemaVersion,omitempty"`
	Status         string               `json:"status,omitempty"`
	ExitReason     string               `json:"exitReason,omitempty"`
	EventCount     int                  `json:"eventCount"`
	CompletedTurns int                  `json:"completedTurns"`
	ToolCalls      int                  `json:"toolCalls"`
	LastEventType  string               `json:"lastEventType,omitempty"`
	FirstEvent     ctf.AgentReplayEvent `json:"firstEvent,omitempty"`
}

type ctfRecoverySmokeFiles struct {
	ChallengeJSONExists bool   `json:"challengeJsonExists"`
	RunJSONExists       bool   `json:"runJsonExists"`
	TrajectoryExists    bool   `json:"trajectoryExists"`
	NotesExists         bool   `json:"notesExists"`
	MaterialExists      bool   `json:"materialExists"`
	TrajectorySHA256    string `json:"trajectorySha256,omitempty"`
}

type ctfRecoverySmokeGates struct {
	PackagedAppCreatedCTFJob       bool `json:"packagedAppCreatedCtfJob"`
	AgentWorkspacePrepared         bool `json:"agentWorkspacePrepared"`
	CheckpointPersisted            bool `json:"checkpointPersisted"`
	CheckpointRestoredAfterRestart bool `json:"checkpointRestoredAfterRestart"`
	ReplayRestoredAfterRestart     bool `json:"replayRestoredAfterRestart"`
	ProgressRestoredAfterRestart   bool `json:"progressRestoredAfterRestart"`
	WorkspaceStayedInAppData       bool `json:"workspaceStayedInAppData"`
	NoRawCandidateInCheckpoint     bool `json:"noRawCandidateInCheckpoint"`
}

func (a *App) maybeRunCTFRecoverySmoke() {
	resultPath := strings.TrimSpace(os.Getenv(ctfRecoverySmokeResultEnv))
	if resultPath == "" {
		return
	}

	mode := strings.ToLower(strings.TrimSpace(os.Getenv(ctfRecoverySmokeModeEnv)))
	if mode == "" {
		mode = "create"
	}
	report := a.buildCTFRecoverySmokeReport(mode, strings.TrimSpace(os.Getenv(ctfRecoverySmokeJobIDEnv)))
	if err := writeCTFRecoverySmokeReport(resultPath, report); err != nil {
		a.diagnostics.Record("ctf", "error", "packaged CTF recovery smoke report failed")
	}
}

func (a *App) buildCTFRecoverySmokeReport(mode, jobID string) ctfRecoverySmokeReport {
	report := ctfRecoverySmokeReport{
		Schema:        ctfRecoverySmokeSchema,
		RanAt:         time.Now().UTC().Format(time.RFC3339Nano),
		Mode:          mode,
		DataDirectory: a.dataDirectory,
		Limitations: []string{
			"This smoke verifies packaged App CTF job/workspace/checkpoint/replay persistence.",
			"It does not run a real Solver model, platform Judge, exploit input, or six-track CTF outcome.",
		},
	}

	switch mode {
	case "create":
		a.runCTFRecoveryCreateSmoke(&report)
	case "verify":
		if jobID == "" {
			report.Error = "verify mode requires MILKSU_CTF_RECOVERY_SMOKE_JOB_ID"
			return report
		}
		a.runCTFRecoveryVerifySmoke(&report, jobID)
	default:
		report.Error = fmt.Sprintf("unsupported CTF recovery smoke mode: %s", mode)
	}
	return report
}

func (a *App) runCTFRecoveryCreateSmoke(report *ctfRecoverySmokeReport) {
	const materialText = "MilkSU packaged CTF recovery smoke material.\nNo exploit, no network, no real flag.\n"
	started, err := a.StartCTFChallenge(ctf.ChallengeRequest{
		Title:             "Packaged CTF recovery smoke",
		Statement:         "Local safe recovery smoke. Verify that an in-progress Agent workspace survives an App restart.",
		Category:          "misc",
		CollaborationMode: "delegate",
		DeferAgent:        true,
		TrackName:         "M3 packaged recovery",
		HumanGoal:         "Keep CTF workspace, checkpoint and replay evidence available after switching or restarting the App.",
		SourceKind:        "file",
		KnowledgePoints:   []string{"checkpoint", "recovery", "evidence"},
		Materials: []ctf.MaterialRequest{{
			Name:       "recovery-note.txt",
			MediaType:  "text/plain; charset=utf-8",
			DataBase64: base64.StdEncoding.EncodeToString([]byte(materialText)),
			Provenance: "packaged-ctf-recovery-smoke:local",
		}},
	})
	if err != nil {
		report.Error = fmt.Sprintf("start CTF recovery smoke challenge: %v", err)
		return
	}
	report.Gates.PackagedAppCreatedCTFJob = true
	a.populateCTFRecoveryReportProjection(report, started)

	handoff, err := a.PrepareCTFAgentWorkspace(started.Job.ID)
	if err != nil {
		report.Error = fmt.Sprintf("prepare CTF Agent workspace: %v", err)
		return
	}
	report.Gates.AgentWorkspacePrepared = true
	if err := writeCTFRecoveryAgentFixture(handoff); err != nil {
		report.Error = err.Error()
		return
	}
	checkpoint, err := ctf.PersistAgentRunCheckpoint(
		handoff.WorkspacePath,
		handoff,
		ctf.AgentRunSnapshot{
			Status:               "running",
			Model:                "packaged-ctf-recovery-smoke-model",
			LastAssistantSummary: "Packaged CTF recovery smoke checkpoint before App restart.",
		},
		time.Now().UTC(),
	)
	if err != nil {
		report.Error = fmt.Sprintf("persist CTF Agent checkpoint: %v", err)
		return
	}
	report.Gates.CheckpointPersisted = true
	a.populateCTFRecoveryReportState(report, handoff, checkpoint)
}

func (a *App) runCTFRecoveryVerifySmoke(report *ctfRecoverySmokeReport, jobID string) {
	projection, err := a.GetCTFJob(jobID)
	if err != nil {
		report.Error = fmt.Sprintf("get recovered CTF job: %v", err)
		return
	}
	a.populateCTFRecoveryReportProjection(report, projection)
	handoff, err := a.PrepareCTFAgentWorkspace(jobID)
	if err != nil {
		report.Error = fmt.Sprintf("load recovered CTF Agent workspace: %v", err)
		return
	}
	checkpoint, err := a.GetCTFAgentRunCheckpoint(jobID)
	if err != nil {
		report.Error = fmt.Sprintf("load recovered CTF Agent checkpoint: %v", err)
		return
	}
	if checkpoint == nil {
		report.Error = "recovered CTF Agent checkpoint is missing"
		return
	}
	a.populateCTFRecoveryReportState(report, handoff, *checkpoint)
	report.Gates.CheckpointRestoredAfterRestart = checkpoint.Status == "running" &&
		checkpoint.Metrics.CompletedTurns == 1 &&
		checkpoint.Metrics.ToolCalls == 1 &&
		checkpoint.Metrics.LastEventType == "assistant.completed"
	report.Gates.ProgressRestoredAfterRestart = strings.Contains(checkpoint.Progress.LastVerifiedFact, "recovery smoke material") &&
		strings.Contains(checkpoint.Progress.NextAction, "restored checkpoint")
	report.Gates.ReplayRestoredAfterRestart = report.Replay.EventCount == 3 &&
		report.Replay.CompletedTurns == 1 &&
		report.Replay.ToolCalls == 1
}

func (a *App) populateCTFRecoveryReportProjection(report *ctfRecoverySmokeReport, projection ctf.Projection) {
	report.JobID = projection.Job.ID
	report.Projection = ctfRecoverySmokeProjection{
		Title:             projection.Challenge.Title,
		Category:          projection.Challenge.Category,
		CollaborationMode: projection.Challenge.CollaborationMode,
		JobStatus:         string(projection.Job.Status),
		MaterialCount:     len(projection.Challenge.Materials),
	}
	if summaries, err := a.ListCTFJobs(); err == nil {
		for _, summary := range summaries {
			if summary.ID == projection.Job.ID {
				report.Projection.Listed = true
				break
			}
		}
	}
}

func (a *App) populateCTFRecoveryReportState(
	report *ctfRecoverySmokeReport,
	handoff ctf.AgentWorkspaceHandoff,
	checkpoint ctf.AgentRunCheckpoint,
) {
	report.WorkspacePath = handoff.WorkspacePath
	report.Handoff = ctfRecoverySmokeHandoff{
		ConversationID: handoff.ConversationID,
		Role:           handoff.Role,
		MaterialCount:  len(handoff.Materials),
		PromptResumes:  strings.Contains(handoff.Prompt, "恢复") || strings.Contains(strings.ToLower(handoff.Prompt), "resume"),
	}
	report.Checkpoint = ctfRecoverySmokeCheckpoint{
		Status:               checkpoint.Status,
		ExitReason:           checkpoint.ExitReason,
		Model:                checkpoint.Model,
		Metrics:              checkpoint.Metrics,
		LastAssistantSummary: checkpoint.LastAssistantSummary,
		NotesExcerptPresent:  strings.Contains(checkpoint.NotesExcerpt, "recovery smoke material"),
		Progress:             checkpoint.Progress,
	}
	replay, replayErr := a.GetCTFAgentReplay(handoff.JobID)
	if replayErr == nil {
		report.Replay = ctfRecoverySmokeReplay{
			SchemaVersion:  replay.SchemaVersion,
			Status:         replay.Status,
			ExitReason:     replay.ExitReason,
			EventCount:     len(replay.Events),
			CompletedTurns: replay.Metrics.CompletedTurns,
			ToolCalls:      replay.Metrics.ToolCalls,
			LastEventType:  replay.Metrics.LastEventType,
		}
		if len(replay.Events) > 0 {
			report.Replay.FirstEvent = replay.Events[0]
		}
	}
	report.Files = inspectCTFRecoverySmokeFiles(handoff.WorkspacePath, checkpoint.Metrics.TrajectorySHA256)
	report.Gates.WorkspaceStayedInAppData = strings.HasPrefix(
		filepath.Clean(handoff.WorkspacePath),
		filepath.Clean(filepath.Join(a.dataDirectory, "ctf-workspaces"))+string(os.PathSeparator),
	)
	report.Gates.NoRawCandidateInCheckpoint = !ctfRecoveryRunFileContains(
		filepath.Join(handoff.WorkspacePath, "evidence", "run.json"),
		"flag{",
	)
}

func writeCTFRecoveryAgentFixture(handoff ctf.AgentWorkspaceHandoff) error {
	now := time.Now().UTC()
	trajectory := []map[string]string{
		{
			"sessionId": handoff.ConversationID,
			"engine":    "packaged-ctf-recovery-smoke",
			"type":      "tool.started",
			"toolName":  "read",
			"text":      "Read the local recovery-note material.",
			"timestamp": now.Format(time.RFC3339Nano),
		},
		{
			"sessionId": handoff.ConversationID,
			"engine":    "packaged-ctf-recovery-smoke",
			"type":      "tool.completed",
			"toolName":  "read",
			"timestamp": now.Add(time.Second).Format(time.RFC3339Nano),
		},
		{
			"sessionId": handoff.ConversationID,
			"engine":    "packaged-ctf-recovery-smoke",
			"type":      "assistant.completed",
			"text":      "Recorded the recovery smoke observation and left the job in progress.",
			"timestamp": now.Add(2 * time.Second).Format(time.RFC3339Nano),
		},
	}
	lines := make([]string, 0, len(trajectory))
	for _, event := range trajectory {
		data, err := json.Marshal(event)
		if err != nil {
			return fmt.Errorf("encode CTF recovery trajectory: %w", err)
		}
		lines = append(lines, string(data))
	}
	if err := os.WriteFile(
		filepath.Join(handoff.WorkspacePath, "evidence", "trajectory.jsonl"),
		[]byte(strings.Join(lines, "\n")+"\n"),
		0o600,
	); err != nil {
		return fmt.Errorf("write CTF recovery trajectory: %w", err)
	}
	notes := `# 解题状态

## 已确认事实

- Packaged CTF recovery smoke material was exported and read from the Agent workspace.

## 当前假设

| 假设 | 依据 | 验证方法 | 状态 |
| --- | --- | --- | --- |
| Checkpoint survives App restart | local smoke trajectory | reopen packaged App with same App data | active |

## 实验与观察

- The smoke records a safe local observation only.

## 失败分支

## 候选与证据

## 下一步

- Continue from restored checkpoint after cross-module navigation.
`
	if err := os.WriteFile(filepath.Join(handoff.WorkspacePath, "notes.md"), []byte(notes), 0o600); err != nil {
		return fmt.Errorf("write CTF recovery notes: %w", err)
	}
	return nil
}

func inspectCTFRecoverySmokeFiles(workspacePath, trajectorySHA256 string) ctfRecoverySmokeFiles {
	return ctfRecoverySmokeFiles{
		ChallengeJSONExists: fileExists(filepath.Join(workspacePath, "challenge.json")),
		RunJSONExists:       fileExists(filepath.Join(workspacePath, "evidence", "run.json")),
		TrajectoryExists:    fileExists(filepath.Join(workspacePath, "evidence", "trajectory.jsonl")),
		NotesExists:         fileExists(filepath.Join(workspacePath, "notes.md")),
		MaterialExists:      fileExists(filepath.Join(workspacePath, "materials", "recovery-note.txt")),
		TrajectorySHA256:    trajectorySHA256,
	}
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func ctfRecoveryRunFileContains(path, needle string) bool {
	data, err := os.ReadFile(path)
	if err != nil {
		return false
	}
	return strings.Contains(strings.ToLower(string(data)), strings.ToLower(needle))
}

func writeCTFRecoverySmokeReport(path string, report ctfRecoverySmokeReport) error {
	absolute, err := filepath.Abs(path)
	if err != nil {
		return fmt.Errorf("resolve CTF recovery smoke report path: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(absolute), 0o700); err != nil {
		return fmt.Errorf("create CTF recovery smoke report directory: %w", err)
	}
	payload, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		return fmt.Errorf("encode CTF recovery smoke report: %w", err)
	}
	payload = append(payload, '\n')
	temporary, err := os.CreateTemp(filepath.Dir(absolute), ".milksu-ctf-recovery-smoke-*")
	if err != nil {
		return fmt.Errorf("create temporary CTF recovery smoke report: %w", err)
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(0o600); err != nil {
		temporary.Close()
		return fmt.Errorf("protect temporary CTF recovery smoke report: %w", err)
	}
	if _, err := temporary.Write(payload); err != nil {
		temporary.Close()
		return fmt.Errorf("write temporary CTF recovery smoke report: %w", err)
	}
	if err := temporary.Sync(); err != nil {
		temporary.Close()
		return fmt.Errorf("sync temporary CTF recovery smoke report: %w", err)
	}
	if err := temporary.Close(); err != nil {
		return fmt.Errorf("close temporary CTF recovery smoke report: %w", err)
	}
	if err := os.Rename(temporaryPath, absolute); err != nil {
		return fmt.Errorf("install CTF recovery smoke report: %w", err)
	}
	if err := os.Chmod(absolute, 0o600); err != nil {
		return fmt.Errorf("protect CTF recovery smoke report: %w", err)
	}
	return nil
}
