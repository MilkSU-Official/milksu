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
	codingPullRequestWebViewSmokeResultEnv    = "MILKSU_CODING_PR_PUBLISH_WEBVIEW_SMOKE_RESULT"
	codingPullRequestWebViewSmokeWorkspaceEnv = "MILKSU_CODING_PR_PUBLISH_WEBVIEW_SMOKE_WORKSPACE"

	codingPullRequestWebViewSmokeSchema = "milksu-coding-pr-publish-webview-smoke/v1"
)

type codingPullRequestWebViewSmokeRequest struct {
	Enabled       bool   `json:"enabled"`
	WorkspacePath string `json:"workspacePath,omitempty"`
}

type codingPullRequestWebViewSmokeReport struct {
	Schema            string                             `json:"schema"`
	RanAt             string                             `json:"ranAt"`
	DataDirectory     string                             `json:"dataDirectory"`
	Workspace         string                             `json:"workspace"`
	PullRequestNumber int                                `json:"pullRequestNumber,omitempty"`
	PullRequestURL    string                             `json:"pullRequestUrl,omitempty"`
	HeadCommit        string                             `json:"headCommit,omitempty"`
	Gates             codingPullRequestWebViewSmokeGates `json:"gates"`
	Observations      []string                           `json:"observations,omitempty"`
	Error             string                             `json:"error,omitempty"`
}

type codingPullRequestWebViewSmokeGates struct {
	CodingPageOpened         bool `json:"codingPageOpened"`
	WorkspaceBound           bool `json:"workspaceBound"`
	ChangesPanelOpened       bool `json:"changesPanelOpened"`
	PrepareButtonClicked     bool `json:"prepareButtonClicked"`
	ExistingDraftDialogShown bool `json:"existingDraftDialogShown"`
	ConfirmButtonClicked     bool `json:"confirmButtonClicked"`
	PublishVerified          bool `json:"publishVerified"`
	RawTokenOmitted          bool `json:"rawTokenOmitted"`
}

func (a *App) codingPullRequestWebViewSmokeRequest() codingPullRequestWebViewSmokeRequest {
	resultPath := strings.TrimSpace(os.Getenv(codingPullRequestWebViewSmokeResultEnv))
	if resultPath == "" {
		return codingPullRequestWebViewSmokeRequest{}
	}
	return codingPullRequestWebViewSmokeRequest{
		Enabled:       true,
		WorkspacePath: strings.TrimSpace(os.Getenv(codingPullRequestWebViewSmokeWorkspaceEnv)),
	}
}

func (a *App) completeCodingPullRequestWebViewSmoke(report codingPullRequestWebViewSmokeReport) error {
	resultPath := strings.TrimSpace(os.Getenv(codingPullRequestWebViewSmokeResultEnv))
	if resultPath == "" {
		return errors.New("Coding pull request WebView smoke is not enabled")
	}
	report.Schema = codingPullRequestWebViewSmokeSchema
	report.RanAt = time.Now().UTC().Format(time.RFC3339Nano)
	report.DataDirectory = a.dataDirectory
	report.Gates.RawTokenOmitted = true
	if codingPullRequestWebViewSmokeContainsSensitiveShape(report) {
		return errors.New("Coding pull request WebView smoke report contains token-shaped content")
	}
	return writeCodingPullRequestWebViewSmokeReport(resultPath, report)
}

func writeCodingPullRequestWebViewSmokeReport(
	path string,
	report codingPullRequestWebViewSmokeReport,
) error {
	absolute, err := filepath.Abs(path)
	if err != nil {
		return fmt.Errorf("resolve Coding pull request WebView smoke report path: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(absolute), 0o700); err != nil {
		return fmt.Errorf("create Coding pull request WebView smoke report directory: %w", err)
	}
	payload, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		return fmt.Errorf("encode Coding pull request WebView smoke report: %w", err)
	}
	payload = append(payload, '\n')
	temporary, err := os.CreateTemp(filepath.Dir(absolute), ".milksu-coding-pr-webview-smoke-*")
	if err != nil {
		return fmt.Errorf("create temporary Coding pull request WebView smoke report: %w", err)
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(0o600); err != nil {
		temporary.Close()
		return fmt.Errorf("protect temporary Coding pull request WebView smoke report: %w", err)
	}
	if _, err := temporary.Write(payload); err != nil {
		temporary.Close()
		return fmt.Errorf("write temporary Coding pull request WebView smoke report: %w", err)
	}
	if err := temporary.Sync(); err != nil {
		temporary.Close()
		return fmt.Errorf("sync temporary Coding pull request WebView smoke report: %w", err)
	}
	if err := temporary.Close(); err != nil {
		return fmt.Errorf("close temporary Coding pull request WebView smoke report: %w", err)
	}
	if err := os.Rename(temporaryPath, absolute); err != nil {
		return fmt.Errorf("install Coding pull request WebView smoke report: %w", err)
	}
	return os.Chmod(absolute, 0o600)
}

func codingPullRequestWebViewSmokeContainsSensitiveShape(report codingPullRequestWebViewSmokeReport) bool {
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
		"confirmationtoken",
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
