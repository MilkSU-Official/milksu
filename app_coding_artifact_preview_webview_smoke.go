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
	codingArtifactPreviewWebViewSmokeResultEnv = "MILKSU_CODING_ARTIFACT_PREVIEW_WEBVIEW_SMOKE_RESULT"
	codingArtifactPreviewWebViewSmokePathEnv   = "MILKSU_CODING_ARTIFACT_PREVIEW_WEBVIEW_SMOKE_PATH"
	defaultCodingArtifactPreviewWebViewPath    = "reports/dangerous.html"
)

type codingArtifactPreviewWebViewSmokeRequest struct {
	Enabled      bool   `json:"enabled"`
	Workspace    string `json:"workspace,omitempty"`
	RelativePath string `json:"relativePath,omitempty"`
}

type codingArtifactPreviewWebViewSmokeReport struct {
	Schema           string                       `json:"schema"`
	RanAt            string                       `json:"ranAt"`
	DataDirectory    string                       `json:"dataDirectory"`
	Workspace        string                       `json:"workspace"`
	RelativePath     string                       `json:"relativePath"`
	Kind             string                       `json:"kind"`
	MediaType        string                       `json:"mediaType"`
	SandboxAttribute string                       `json:"sandboxAttribute"`
	CSP              string                       `json:"csp"`
	Gates            map[string]bool              `json:"gates"`
	Observations     []string                     `json:"observations,omitempty"`
	Summary          codingArtifactWebViewSummary `json:"summary"`
	Error            string                       `json:"error,omitempty"`
}

type codingArtifactWebViewSummary struct {
	SourceBytes         int    `json:"sourceBytes"`
	SanitizedBytes      int    `json:"sanitizedBytes"`
	RedactedMarkerCount int    `json:"redactedMarkerCount"`
	BodyText            string `json:"bodyText"`
}

func (a *App) GetCodingArtifactPreviewWebViewSmokeRequest() codingArtifactPreviewWebViewSmokeRequest {
	resultPath := strings.TrimSpace(os.Getenv(codingArtifactPreviewWebViewSmokeResultEnv))
	if resultPath == "" {
		return codingArtifactPreviewWebViewSmokeRequest{}
	}
	relativePath := strings.TrimSpace(os.Getenv(codingArtifactPreviewWebViewSmokePathEnv))
	if relativePath == "" {
		relativePath = defaultCodingArtifactPreviewWebViewPath
	}
	return codingArtifactPreviewWebViewSmokeRequest{
		Enabled:      true,
		Workspace:    strings.TrimSpace(os.Getenv(codingArtifactPreviewSmokeWorkspaceEnv)),
		RelativePath: relativePath,
	}
}

func (a *App) CompleteCodingArtifactPreviewWebViewSmoke(
	report codingArtifactPreviewWebViewSmokeReport,
) error {
	resultPath := strings.TrimSpace(os.Getenv(codingArtifactPreviewWebViewSmokeResultEnv))
	if resultPath == "" {
		return errors.New("Coding artifact preview WebView smoke is not enabled")
	}
	report.Schema = "milksu-coding-artifact-preview-webview-smoke/v1"
	report.RanAt = time.Now().UTC().Format(time.RFC3339Nano)
	report.DataDirectory = a.dataDirectory
	if report.Gates == nil {
		report.Gates = map[string]bool{}
	}
	return writeCodingArtifactPreviewWebViewSmokeReport(resultPath, report)
}

func writeCodingArtifactPreviewWebViewSmokeReport(
	path string,
	report codingArtifactPreviewWebViewSmokeReport,
) error {
	absolute, err := filepath.Abs(path)
	if err != nil {
		return fmt.Errorf("resolve artifact preview WebView smoke report path: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(absolute), 0o700); err != nil {
		return fmt.Errorf("create artifact preview WebView smoke report directory: %w", err)
	}
	payload, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		return fmt.Errorf("encode artifact preview WebView smoke report: %w", err)
	}
	payload = append(payload, '\n')
	temporary, err := os.CreateTemp(filepath.Dir(absolute), ".milksu-artifact-preview-webview-smoke-*")
	if err != nil {
		return fmt.Errorf("create temporary artifact preview WebView smoke report: %w", err)
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(0o600); err != nil {
		temporary.Close()
		return fmt.Errorf("protect temporary artifact preview WebView smoke report: %w", err)
	}
	if _, err := temporary.Write(payload); err != nil {
		temporary.Close()
		return fmt.Errorf("write temporary artifact preview WebView smoke report: %w", err)
	}
	if err := temporary.Sync(); err != nil {
		temporary.Close()
		return fmt.Errorf("sync temporary artifact preview WebView smoke report: %w", err)
	}
	if err := temporary.Close(); err != nil {
		return fmt.Errorf("close temporary artifact preview WebView smoke report: %w", err)
	}
	if err := os.Rename(temporaryPath, absolute); err != nil {
		return fmt.Errorf("install artifact preview WebView smoke report: %w", err)
	}
	if err := os.Chmod(absolute, 0o600); err != nil {
		return fmt.Errorf("protect artifact preview WebView smoke report: %w", err)
	}
	return nil
}
