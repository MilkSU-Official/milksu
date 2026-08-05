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
	codingArtifactPreviewSmokeResultEnv    = "MILKSU_CODING_ARTIFACT_PREVIEW_SMOKE_RESULT"
	codingArtifactPreviewSmokeWorkspaceEnv = "MILKSU_CODING_ARTIFACT_PREVIEW_SMOKE_WORKSPACE"
)

type codingArtifactPreviewSmokeReport struct {
	Schema        string                      `json:"schema"`
	RanAt         string                      `json:"ranAt"`
	DataDirectory string                      `json:"dataDirectory"`
	Workspace     string                      `json:"workspace"`
	Previews      []codingenv.ArtifactPreview `json:"previews"`
	Rejected      map[string]string           `json:"rejected"`
	Error         string                      `json:"error,omitempty"`
}

func (a *App) maybeRunCodingArtifactPreviewSmoke() {
	resultPath := strings.TrimSpace(os.Getenv(codingArtifactPreviewSmokeResultEnv))
	if resultPath == "" {
		return
	}
	report := codingArtifactPreviewSmokeReport{
		Schema:        "milksu-coding-artifact-preview-smoke/v1",
		RanAt:         time.Now().UTC().Format(time.RFC3339Nano),
		DataDirectory: a.dataDirectory,
		Workspace:     strings.TrimSpace(os.Getenv(codingArtifactPreviewSmokeWorkspaceEnv)),
		Rejected:      make(map[string]string),
	}
	defer func() {
		if err := writeCodingArtifactPreviewSmokeReport(resultPath, report); err != nil {
			a.diagnostics.Record("coding", "error", "packaged artifact preview smoke report failed")
		}
	}()
	if report.Workspace == "" {
		report.Error = fmt.Sprintf("%s is required", codingArtifactPreviewSmokeWorkspaceEnv)
		return
	}

	for _, relativePath := range []string{
		"reports/summary.md",
		"reports/result.html",
		"images/screenshot.png",
	} {
		preview, err := a.GetCodingArtifactPreview(report.Workspace, relativePath)
		if err != nil {
			report.Error = fmt.Sprintf("preview %s: %v", relativePath, err)
			return
		}
		report.Previews = append(report.Previews, preview)
	}
	for _, relativePath := range []string{
		"../outside.md",
		"images/spoofed.png",
		"archive/result.svg",
	} {
		if _, err := a.GetCodingArtifactPreview(report.Workspace, relativePath); err != nil {
			report.Rejected[relativePath] = err.Error()
			continue
		}
		report.Error = fmt.Sprintf("artifact preview unexpectedly accepted %s", relativePath)
		return
	}
}

func writeCodingArtifactPreviewSmokeReport(
	path string,
	report codingArtifactPreviewSmokeReport,
) error {
	absolute, err := filepath.Abs(path)
	if err != nil {
		return fmt.Errorf("resolve artifact preview smoke report path: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(absolute), 0o700); err != nil {
		return fmt.Errorf("create artifact preview smoke report directory: %w", err)
	}
	payload, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		return fmt.Errorf("encode artifact preview smoke report: %w", err)
	}
	payload = append(payload, '\n')
	temporary, err := os.CreateTemp(filepath.Dir(absolute), ".milksu-artifact-preview-smoke-*")
	if err != nil {
		return fmt.Errorf("create temporary artifact preview smoke report: %w", err)
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(0o600); err != nil {
		temporary.Close()
		return fmt.Errorf("protect temporary artifact preview smoke report: %w", err)
	}
	if _, err := temporary.Write(payload); err != nil {
		temporary.Close()
		return fmt.Errorf("write temporary artifact preview smoke report: %w", err)
	}
	if err := temporary.Sync(); err != nil {
		temporary.Close()
		return fmt.Errorf("sync temporary artifact preview smoke report: %w", err)
	}
	if err := temporary.Close(); err != nil {
		return fmt.Errorf("close temporary artifact preview smoke report: %w", err)
	}
	if err := os.Rename(temporaryPath, absolute); err != nil {
		return fmt.Errorf("install artifact preview smoke report: %w", err)
	}
	if err := os.Chmod(absolute, 0o600); err != nil {
		return fmt.Errorf("protect artifact preview smoke report: %w", err)
	}
	return nil
}
