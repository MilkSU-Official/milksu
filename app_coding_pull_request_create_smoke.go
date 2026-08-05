package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/MilkSU-Official/milksu/internal/codingenv"
	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

const (
	codingPullRequestCreateSmokeResultEnv    = "MILKSU_CODING_PR_CREATE_SMOKE_RESULT"
	codingPullRequestCreateSmokeWorkspaceEnv = "MILKSU_CODING_PR_CREATE_SMOKE_WORKSPACE"
	codingPullRequestCreateSmokeTitleEnv     = "MILKSU_CODING_PR_CREATE_SMOKE_TITLE"
	codingPullRequestCreateSmokeBodyEnv      = "MILKSU_CODING_PR_CREATE_SMOKE_BODY"
	codingPullRequestCreateSmokeQuitEnv      = "MILKSU_CODING_PR_CREATE_SMOKE_QUIT"

	codingPullRequestCreateSmokeSchema = "milksu-coding-pr-create-packaged-smoke/v1"
)

type codingPullRequestCreateSmokeReport struct {
	Schema        string                             `json:"schema"`
	RanAt         string                             `json:"ranAt"`
	DataDirectory string                             `json:"dataDirectory"`
	Workspace     string                             `json:"workspace"`
	Title         string                             `json:"title"`
	Preview       codingPullRequestSmokePreview      `json:"preview"`
	Publish       codingenv.PullRequestPublishResult `json:"publish"`
	ReuseError    string                             `json:"reuseError,omitempty"`
	Gates         codingPullRequestCreateSmokeGates  `json:"gates"`
	Limitations   []string                           `json:"limitations,omitempty"`
	Error         string                             `json:"error,omitempty"`
}

type codingPullRequestCreateSmokeGates struct {
	PreparedPreview         bool `json:"preparedPreview"`
	PreviewForPrivateMilkSU bool `json:"previewForPrivateMilkSU"`
	PreviewNoExistingDraft  bool `json:"previewNoExistingDraft"`
	ConfirmationTokenIssued bool `json:"confirmationTokenIssued"`
	CreatedDraftPR          bool `json:"createdDraftPr"`
	PublishVerifiedReadback bool `json:"publishVerifiedReadback"`
	ConfirmationTokenUsed   bool `json:"confirmationTokenUsed"`
	NoCredentialLeak        bool `json:"noCredentialLeak"`
}

func (a *App) maybeRunCodingPullRequestCreateSmoke() {
	resultPath := strings.TrimSpace(os.Getenv(codingPullRequestCreateSmokeResultEnv))
	if resultPath == "" {
		return
	}
	report := a.buildCodingPullRequestCreateSmokeReport(
		strings.TrimSpace(os.Getenv(codingPullRequestCreateSmokeWorkspaceEnv)),
		envOrDefault(codingPullRequestCreateSmokeTitleEnv, "test: verify MilkSU draft PR creation flow"),
		envOrDefault(codingPullRequestCreateSmokeBodyEnv, "Packaged MilkSU PR create smoke created a private draft PR on a temporary branch."),
	)
	if err := writeCodingPullRequestCreateSmokeReport(resultPath, report); err != nil {
		a.diagnostics.Record("coding-pr-create", "error", "packaged Coding pull request create smoke report failed")
	}
	if strings.TrimSpace(os.Getenv(codingPullRequestCreateSmokeQuitEnv)) == "1" && a.ctx != nil {
		go func() {
			time.Sleep(250 * time.Millisecond)
			wailsruntime.Quit(a.ctx)
		}()
	}
}

func (a *App) buildCodingPullRequestCreateSmokeReport(
	workspacePath,
	title,
	body string,
) codingPullRequestCreateSmokeReport {
	report := codingPullRequestCreateSmokeReport{
		Schema:        codingPullRequestCreateSmokeSchema,
		RanAt:         time.Now().UTC().Format(time.RFC3339Nano),
		DataDirectory: a.dataDirectory,
		Workspace:     workspacePath,
		Title:         title,
		Limitations: []string{
			"This smoke verifies packaged App PR prepare/publish facade against a temporary branch in the private MilkSU repository.",
			"It expects no existing open draft PR for the temporary branch and creates one.",
			"Cleanup is performed by the live-smoke launcher: close the PR and delete the temporary branch.",
		},
	}
	if workspacePath == "" {
		report.Error = fmt.Sprintf("%s is required", codingPullRequestCreateSmokeWorkspaceEnv)
		report.Gates.NoCredentialLeak = !codingPullRequestCreateSmokeContainsSensitiveShape(report)
		return report
	}
	preview, err := a.PrepareCodingPullRequest(workspacePath)
	report.Preview = sanitizeCodingPullRequestPreview(preview)
	if err != nil {
		report.Error = fmt.Sprintf("prepare pull request: %v", err)
		report.Gates.NoCredentialLeak = !codingPullRequestCreateSmokeContainsSensitiveShape(report)
		return report
	}
	report.Gates.PreparedPreview = true
	report.Gates.PreviewForPrivateMilkSU = preview.Repository == "MilkSU-Official/milksu" &&
		preview.RepositoryURL == "https://github.com/MilkSU-Official/milksu" &&
		preview.Private &&
		preview.Remote == "origin"
	report.Gates.PreviewNoExistingDraft = preview.ExistingNumber == 0 &&
		strings.TrimSpace(preview.ExistingURL) == ""
	report.Gates.ConfirmationTokenIssued = strings.TrimSpace(preview.ConfirmationToken) != ""
	if !report.Gates.PreviewNoExistingDraft {
		report.Error = "Coding PR create smoke requires a temporary branch with no existing open draft PR"
		report.Gates.NoCredentialLeak = !codingPullRequestCreateSmokeContainsSensitiveShape(report)
		return report
	}
	published, err := a.PublishCodingPullRequest(
		workspacePath,
		preview.ConfirmationToken,
		title,
		body,
	)
	report.Publish = published
	if err != nil {
		report.Error = fmt.Sprintf("publish pull request: %v", err)
		report.Gates.NoCredentialLeak = !codingPullRequestCreateSmokeContainsSensitiveShape(report)
		return report
	}
	report.Gates.CreatedDraftPR = published.Repository == preview.Repository &&
		published.SourceBranch == preview.SourceBranch &&
		published.HeadCommit == preview.HeadCommit &&
		published.TargetBranch == preview.TargetBranch &&
		published.Created &&
		published.Draft &&
		published.Number > 0 &&
		strings.HasPrefix(published.URL, "https://github.com/MilkSU-Official/milksu/pull/")
	report.Gates.PublishVerifiedReadback = published.Verified &&
		published.State == "OPEN" &&
		published.Draft

	_, reuseErr := a.PublishCodingPullRequest(
		workspacePath,
		preview.ConfirmationToken,
		title,
		body,
	)
	if reuseErr != nil {
		report.ReuseError = strings.ReplaceAll(reuseErr.Error(), preview.ConfirmationToken, "[confirmation token redacted]")
	}
	report.Gates.ConfirmationTokenUsed = reuseErr != nil &&
		strings.Contains(reuseErr.Error(), "confirmation is missing, expired, or already used")
	report.Gates.NoCredentialLeak = !codingPullRequestCreateSmokeContainsSensitiveShape(report)
	if !report.Gates.PreparedPreview ||
		!report.Gates.PreviewForPrivateMilkSU ||
		!report.Gates.PreviewNoExistingDraft ||
		!report.Gates.ConfirmationTokenIssued ||
		!report.Gates.CreatedDraftPR ||
		!report.Gates.PublishVerifiedReadback ||
		!report.Gates.ConfirmationTokenUsed ||
		!report.Gates.NoCredentialLeak {
		report.Error = "Coding PR create smoke did not prove every gate"
	}
	return report
}

func writeCodingPullRequestCreateSmokeReport(
	path string,
	report codingPullRequestCreateSmokeReport,
) error {
	absolute, err := filepath.Abs(path)
	if err != nil {
		return fmt.Errorf("resolve Coding pull request create smoke report path: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(absolute), 0o700); err != nil {
		return fmt.Errorf("create Coding pull request create smoke report directory: %w", err)
	}
	payload, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		return fmt.Errorf("encode Coding pull request create smoke report: %w", err)
	}
	payload = append(payload, '\n')
	temporary, err := os.CreateTemp(filepath.Dir(absolute), ".milksu-coding-pr-create-smoke-*")
	if err != nil {
		return fmt.Errorf("create temporary Coding pull request create smoke report: %w", err)
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(0o600); err != nil {
		temporary.Close()
		return fmt.Errorf("protect temporary Coding pull request create smoke report: %w", err)
	}
	if _, err := temporary.Write(payload); err != nil {
		temporary.Close()
		return fmt.Errorf("write temporary Coding pull request create smoke report: %w", err)
	}
	if err := temporary.Sync(); err != nil {
		temporary.Close()
		return fmt.Errorf("sync temporary Coding pull request create smoke report: %w", err)
	}
	if err := temporary.Close(); err != nil {
		return fmt.Errorf("close temporary Coding pull request create smoke report: %w", err)
	}
	if err := os.Rename(temporaryPath, absolute); err != nil {
		return fmt.Errorf("install Coding pull request create smoke report: %w", err)
	}
	return os.Chmod(absolute, 0o600)
}

func codingPullRequestCreateSmokeContainsSensitiveShape(report codingPullRequestCreateSmokeReport) bool {
	encoded, err := json.Marshal(report)
	if err != nil {
		return true
	}
	lower := strings.ToLower(string(encoded))
	for _, forbidden := range []string{
		"ghp_",
		"github_pat_",
		"authorization: bearer",
		"bearer sk-",
		"api_key=",
		"password=",
		"secret=",
	} {
		if strings.Contains(lower, forbidden) {
			return true
		}
	}
	return false
}
