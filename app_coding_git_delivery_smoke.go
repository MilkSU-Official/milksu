package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/MilkSU-Official/milksu/internal/codingenv"
)

const (
	codingGitDeliverySmokeResultEnv    = "MILKSU_CODING_GIT_DELIVERY_SMOKE_RESULT"
	codingGitDeliverySmokeWorkspaceEnv = "MILKSU_CODING_GIT_DELIVERY_SMOKE_WORKSPACE"
	codingGitDeliverySmokeMessageEnv   = "MILKSU_CODING_GIT_DELIVERY_SMOKE_MESSAGE"

	codingGitDeliverySmokeSchema = "milksu-coding-git-delivery-packaged-smoke/v1"
)

type codingGitDeliverySmokeReport struct {
	Schema        string                      `json:"schema"`
	RanAt         string                      `json:"ranAt"`
	DataDirectory string                      `json:"dataDirectory"`
	Workspace     string                      `json:"workspace"`
	CommitMessage string                      `json:"commitMessage,omitempty"`
	Before        codingenv.Snapshot          `json:"before"`
	Stage         codingenv.GitActionResult   `json:"stage"`
	Commit        codingenv.GitActionResult   `json:"commit"`
	Push          codingenv.GitActionResult   `json:"push"`
	Gates         codingGitDeliverySmokeGates `json:"gates"`
	Limitations   []string                    `json:"limitations,omitempty"`
	Error         string                      `json:"error,omitempty"`
}

type codingGitDeliverySmokeGates struct {
	WorkspaceIsRepository bool `json:"workspaceIsRepository"`
	HadPendingChanges     bool `json:"hadPendingChanges"`
	StageAllStagedChanges bool `json:"stageAllStagedChanges"`
	CommitCreatedHead     bool `json:"commitCreatedHead"`
	PushUpdatedUpstream   bool `json:"pushUpdatedUpstream"`
	CleanAfterPush        bool `json:"cleanAfterPush"`
}

func (a *App) maybeRunCodingGitDeliverySmoke() {
	resultPath := strings.TrimSpace(os.Getenv(codingGitDeliverySmokeResultEnv))
	if resultPath == "" {
		return
	}
	report := a.buildCodingGitDeliverySmokeReport(
		strings.TrimSpace(os.Getenv(codingGitDeliverySmokeWorkspaceEnv)),
		strings.TrimSpace(os.Getenv(codingGitDeliverySmokeMessageEnv)),
	)
	if err := writeCodingGitDeliverySmokeReport(resultPath, report); err != nil {
		a.diagnostics.Record("coding-git", "error", "packaged Coding Git delivery smoke report failed")
	}
}

func (a *App) buildCodingGitDeliverySmokeReport(
	workspacePath,
	commitMessage string,
) codingGitDeliverySmokeReport {
	if commitMessage == "" {
		commitMessage = "test: deliver MilkSU coding self-bootstrap smoke"
	}
	report := codingGitDeliverySmokeReport{
		Schema:        codingGitDeliverySmokeSchema,
		RanAt:         time.Now().UTC().Format(time.RFC3339Nano),
		DataDirectory: a.dataDirectory,
		Workspace:     workspacePath,
		CommitMessage: commitMessage,
		Limitations: []string{
			"This smoke verifies packaged App Git stage/commit/push on an isolated local repository.",
			"It does not create a hosted pull request or write to the MilkSU private remote.",
		},
	}
	if workspacePath == "" {
		report.Error = fmt.Sprintf("%s is required", codingGitDeliverySmokeWorkspaceEnv)
		return report
	}

	before, err := a.GetCodingEnvironment(workspacePath)
	if err != nil {
		report.Error = fmt.Sprintf("inspect Coding workspace before Git delivery: %v", err)
		return report
	}
	report.Before = before
	report.Gates.WorkspaceIsRepository = before.Git.Available && before.Git.IsRepository
	report.Gates.HadPendingChanges = before.Git.Dirty && before.Git.ChangedFiles > 0
	if !report.Gates.WorkspaceIsRepository {
		report.Error = "Coding Git delivery smoke requires a Git repository"
		return report
	}
	if !report.Gates.HadPendingChanges {
		report.Error = "Coding Git delivery smoke requires pending workspace changes"
		return report
	}

	stage, err := a.ApplyCodingGitAction(workspacePath, codingenv.GitActionStageAll, "", "")
	if err != nil {
		report.Error = fmt.Sprintf("stage Coding workspace changes: %v", err)
		return report
	}
	report.Stage = stage
	report.Gates.StageAllStagedChanges = stage.Snapshot.Git.Staged > 0 &&
		stage.Snapshot.Git.Modified == 0 &&
		stage.Snapshot.Git.Conflicts == 0

	commit, err := a.ApplyCodingGitAction(workspacePath, codingenv.GitActionCommit, "", commitMessage)
	if err != nil {
		report.Error = fmt.Sprintf("commit Coding workspace changes: %v", err)
		return report
	}
	report.Commit = commit
	report.Gates.CommitCreatedHead = commit.Snapshot.Git.Head != "" &&
		commit.Snapshot.Git.Head != before.Git.Head &&
		commit.Snapshot.Git.Staged == 0 &&
		commit.Snapshot.Git.Conflicts == 0

	push, err := a.ApplyCodingGitAction(workspacePath, codingenv.GitActionPush, "", "")
	if err != nil {
		report.Error = fmt.Sprintf("push Coding workspace changes: %v", err)
		return report
	}
	report.Push = push
	report.Gates.PushUpdatedUpstream = push.Snapshot.Git.Upstream != "" &&
		push.Snapshot.Git.Ahead == 0
	report.Gates.CleanAfterPush = !push.Snapshot.Git.Dirty &&
		push.Snapshot.Git.ChangedFiles == 0 &&
		push.Snapshot.Git.Ahead == 0 &&
		push.Snapshot.Git.Conflicts == 0
	return report
}

func writeCodingGitDeliverySmokeReport(
	path string,
	report codingGitDeliverySmokeReport,
) error {
	absolute, err := filepath.Abs(path)
	if err != nil {
		return fmt.Errorf("resolve Coding Git delivery smoke report path: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(absolute), 0o700); err != nil {
		return fmt.Errorf("create Coding Git delivery smoke report directory: %w", err)
	}
	payload, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		return fmt.Errorf("encode Coding Git delivery smoke report: %w", err)
	}
	payload = append(payload, '\n')
	temporary, err := os.CreateTemp(filepath.Dir(absolute), ".milksu-coding-git-delivery-smoke-*")
	if err != nil {
		return fmt.Errorf("create temporary Coding Git delivery smoke report: %w", err)
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(0o600); err != nil {
		temporary.Close()
		return fmt.Errorf("protect temporary Coding Git delivery smoke report: %w", err)
	}
	if _, err := temporary.Write(payload); err != nil {
		temporary.Close()
		return fmt.Errorf("write temporary Coding Git delivery smoke report: %w", err)
	}
	if err := temporary.Sync(); err != nil {
		temporary.Close()
		return fmt.Errorf("sync temporary Coding Git delivery smoke report: %w", err)
	}
	if err := temporary.Close(); err != nil {
		return fmt.Errorf("close temporary Coding Git delivery smoke report: %w", err)
	}
	if err := os.Rename(temporaryPath, absolute); err != nil {
		return fmt.Errorf("install Coding Git delivery smoke report: %w", err)
	}
	if err := os.Chmod(absolute, 0o600); err != nil {
		return fmt.Errorf("protect Coding Git delivery smoke report: %w", err)
	}
	return nil
}
