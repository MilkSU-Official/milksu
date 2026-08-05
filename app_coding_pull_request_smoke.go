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
	codingPullRequestSmokeResultEnv    = "MILKSU_CODING_PR_PUBLISH_SMOKE_RESULT"
	codingPullRequestSmokeWorkspaceEnv = "MILKSU_CODING_PR_PUBLISH_SMOKE_WORKSPACE"
	codingPullRequestSmokeTitleEnv     = "MILKSU_CODING_PR_PUBLISH_SMOKE_TITLE"
	codingPullRequestSmokeBodyEnv      = "MILKSU_CODING_PR_PUBLISH_SMOKE_BODY"
	codingPullRequestSmokeQuitEnv      = "MILKSU_CODING_PR_PUBLISH_SMOKE_QUIT"

	codingPullRequestSmokeSchema = "milksu-coding-pr-publish-packaged-smoke/v1"
)

type codingPullRequestSmokeReport struct {
	Schema        string                             `json:"schema"`
	RanAt         string                             `json:"ranAt"`
	DataDirectory string                             `json:"dataDirectory"`
	Workspace     string                             `json:"workspace"`
	Title         string                             `json:"title"`
	Preview       codingPullRequestSmokePreview      `json:"preview"`
	Publish       codingenv.PullRequestPublishResult `json:"publish"`
	ReuseError    string                             `json:"reuseError,omitempty"`
	Gates         codingPullRequestSmokeGates        `json:"gates"`
	Limitations   []string                           `json:"limitations,omitempty"`
	Error         string                             `json:"error,omitempty"`
}

type codingPullRequestSmokePreview struct {
	Repository             string `json:"repository"`
	RepositoryURL          string `json:"repositoryUrl"`
	Private                bool   `json:"private"`
	Remote                 string `json:"remote"`
	SourceBranch           string `json:"sourceBranch"`
	HeadCommit             string `json:"headCommit"`
	TargetBranch           string `json:"targetBranch"`
	SuggestedTitle         string `json:"suggestedTitle"`
	Draft                  bool   `json:"draft"`
	ExistingNumber         int    `json:"existingNumber,omitempty"`
	ExistingURL            string `json:"existingUrl,omitempty"`
	ConfirmationTokenBytes int    `json:"confirmationTokenBytes"`
	ExpiresAt              string `json:"expiresAt"`
}

type codingPullRequestSmokeGates struct {
	PreparedPreview         bool `json:"preparedPreview"`
	PreviewForPrivateMilkSU bool `json:"previewForPrivateMilkSU"`
	PreviewExistingDraftPR  bool `json:"previewExistingDraftPR"`
	ConfirmationTokenIssued bool `json:"confirmationTokenIssued"`
	PublishedByAppFacade    bool `json:"publishedByAppFacade"`
	PublishReusedExistingPR bool `json:"publishReusedExistingPr"`
	PublishVerifiedReadback bool `json:"publishVerifiedReadback"`
	ConfirmationTokenUsed   bool `json:"confirmationTokenUsed"`
	NoCredentialLeak        bool `json:"noCredentialLeak"`
}

func (a *App) maybeRunCodingPullRequestSmoke() {
	resultPath := strings.TrimSpace(os.Getenv(codingPullRequestSmokeResultEnv))
	if resultPath == "" {
		return
	}
	report := a.buildCodingPullRequestSmokeReport(
		strings.TrimSpace(os.Getenv(codingPullRequestSmokeWorkspaceEnv)),
		envOrDefault(codingPullRequestSmokeTitleEnv, "test: verify MilkSU draft PR publish flow"),
		envOrDefault(codingPullRequestSmokeBodyEnv, "Packaged MilkSU PR publish smoke reused the existing private draft PR."),
	)
	if err := writeCodingPullRequestSmokeReport(resultPath, report); err != nil {
		a.diagnostics.Record("coding-pr", "error", "packaged Coding pull request smoke report failed")
	}
	if strings.TrimSpace(os.Getenv(codingPullRequestSmokeQuitEnv)) == "1" && a.ctx != nil {
		go func() {
			time.Sleep(250 * time.Millisecond)
			wailsruntime.Quit(a.ctx)
		}()
	}
}

func (a *App) buildCodingPullRequestSmokeReport(
	workspacePath,
	title,
	body string,
) codingPullRequestSmokeReport {
	report := codingPullRequestSmokeReport{
		Schema:        codingPullRequestSmokeSchema,
		RanAt:         time.Now().UTC().Format(time.RFC3339Nano),
		DataDirectory: a.dataDirectory,
		Workspace:     workspacePath,
		Title:         title,
		Limitations: []string{
			"This smoke verifies packaged App PR prepare/publish facade against the private MilkSU GitHub repository.",
			"It requires an existing open draft PR for the current branch and reuses it instead of creating a new PR.",
			"It does not merge, mark ready for review, or update PR metadata.",
		},
	}
	if workspacePath == "" {
		report.Error = fmt.Sprintf("%s is required", codingPullRequestSmokeWorkspaceEnv)
		report.Gates.NoCredentialLeak = !codingPullRequestSmokeContainsSensitiveShape(report)
		return report
	}
	preview, err := a.PrepareCodingPullRequest(workspacePath)
	report.Preview = sanitizeCodingPullRequestPreview(preview)
	if err != nil {
		report.Error = fmt.Sprintf("prepare pull request: %v", err)
		report.Gates.NoCredentialLeak = !codingPullRequestSmokeContainsSensitiveShape(report)
		return report
	}
	report.Gates.PreparedPreview = true
	report.Gates.PreviewForPrivateMilkSU = preview.Repository == "MilkSU-Official/milksu" &&
		preview.RepositoryURL == "https://github.com/MilkSU-Official/milksu" &&
		preview.Private &&
		preview.Remote == "origin"
	report.Gates.PreviewExistingDraftPR = preview.ExistingNumber > 0 &&
		strings.HasPrefix(preview.ExistingURL, "https://github.com/MilkSU-Official/milksu/pull/")
	report.Gates.ConfirmationTokenIssued = strings.TrimSpace(preview.ConfirmationToken) != ""
	if !report.Gates.PreviewExistingDraftPR {
		report.Error = "Coding PR smoke requires an existing open draft PR and will not create one"
		report.Gates.NoCredentialLeak = !codingPullRequestSmokeContainsSensitiveShape(report)
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
		report.Gates.NoCredentialLeak = !codingPullRequestSmokeContainsSensitiveShape(report)
		return report
	}
	report.Gates.PublishedByAppFacade = published.Repository == preview.Repository &&
		published.SourceBranch == preview.SourceBranch &&
		published.HeadCommit == preview.HeadCommit &&
		published.TargetBranch == preview.TargetBranch
	report.Gates.PublishReusedExistingPR = !published.Created &&
		published.Number == preview.ExistingNumber &&
		published.URL == preview.ExistingURL
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
	report.Gates.NoCredentialLeak = !codingPullRequestSmokeContainsSensitiveShape(report)
	if !report.Gates.PreparedPreview ||
		!report.Gates.PreviewForPrivateMilkSU ||
		!report.Gates.PreviewExistingDraftPR ||
		!report.Gates.ConfirmationTokenIssued ||
		!report.Gates.PublishedByAppFacade ||
		!report.Gates.PublishReusedExistingPR ||
		!report.Gates.PublishVerifiedReadback ||
		!report.Gates.ConfirmationTokenUsed ||
		!report.Gates.NoCredentialLeak {
		report.Error = "Coding PR publish smoke did not prove every gate"
	}
	return report
}

func sanitizeCodingPullRequestPreview(
	preview codingenv.PullRequestPreview,
) codingPullRequestSmokePreview {
	return codingPullRequestSmokePreview{
		Repository:             preview.Repository,
		RepositoryURL:          preview.RepositoryURL,
		Private:                preview.Private,
		Remote:                 preview.Remote,
		SourceBranch:           preview.SourceBranch,
		HeadCommit:             preview.HeadCommit,
		TargetBranch:           preview.TargetBranch,
		SuggestedTitle:         preview.SuggestedTitle,
		Draft:                  preview.Draft,
		ExistingNumber:         preview.ExistingNumber,
		ExistingURL:            preview.ExistingURL,
		ConfirmationTokenBytes: len(preview.ConfirmationToken),
		ExpiresAt:              preview.ExpiresAt,
	}
}

func writeCodingPullRequestSmokeReport(
	path string,
	report codingPullRequestSmokeReport,
) error {
	absolute, err := filepath.Abs(path)
	if err != nil {
		return fmt.Errorf("resolve Coding pull request smoke report path: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(absolute), 0o700); err != nil {
		return fmt.Errorf("create Coding pull request smoke report directory: %w", err)
	}
	payload, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		return fmt.Errorf("encode Coding pull request smoke report: %w", err)
	}
	payload = append(payload, '\n')
	temporary, err := os.CreateTemp(filepath.Dir(absolute), ".milksu-coding-pr-smoke-*")
	if err != nil {
		return fmt.Errorf("create temporary Coding pull request smoke report: %w", err)
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(0o600); err != nil {
		temporary.Close()
		return fmt.Errorf("protect temporary Coding pull request smoke report: %w", err)
	}
	if _, err := temporary.Write(payload); err != nil {
		temporary.Close()
		return fmt.Errorf("write temporary Coding pull request smoke report: %w", err)
	}
	if err := temporary.Sync(); err != nil {
		temporary.Close()
		return fmt.Errorf("sync temporary Coding pull request smoke report: %w", err)
	}
	if err := temporary.Close(); err != nil {
		return fmt.Errorf("close temporary Coding pull request smoke report: %w", err)
	}
	if err := os.Rename(temporaryPath, absolute); err != nil {
		return fmt.Errorf("install Coding pull request smoke report: %w", err)
	}
	return os.Chmod(absolute, 0o600)
}

func codingPullRequestSmokeContainsSensitiveShape(report codingPullRequestSmokeReport) bool {
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
