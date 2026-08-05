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
	vulnerabilityLearningWritebackWebViewSmokeResultEnv     = "MILKSU_VULN_LEARNING_WRITEBACK_WEBVIEW_SMOKE_RESULT"
	vulnerabilityLearningWritebackWebViewSmokeCVEIDEnv      = "MILKSU_VULN_LEARNING_WRITEBACK_WEBVIEW_SMOKE_CVE_ID"
	vulnerabilityLearningWritebackWebViewSmokeConclusionEnv = "MILKSU_VULN_LEARNING_WRITEBACK_WEBVIEW_SMOKE_CONCLUSION"
	defaultVulnerabilityLearningWritebackWebViewCVE         = "CVE-2023-46604"
	defaultVulnerabilityLearningWritebackWebViewConclusion  = "User confirmed advisory and dependency impact notes through the CVE UI. No exploit, trigger bytes, credential, or external target access was used."
)

type vulnerabilityLearningWritebackWebViewSmokeRequest struct {
	Enabled    bool   `json:"enabled"`
	CVEID      string `json:"cveId,omitempty"`
	Conclusion string `json:"conclusion,omitempty"`
}

type vulnerabilityLearningWritebackWebViewSmokeReport struct {
	Schema        string                                    `json:"schema"`
	RanAt         string                                    `json:"ranAt"`
	DataDirectory string                                    `json:"dataDirectory"`
	CVEID         string                                    `json:"cveId"`
	SelectedTitle string                                    `json:"selectedTitle,omitempty"`
	WorkspaceJob  string                                    `json:"workspaceJobId,omitempty"`
	LearningCount int                                       `json:"learningCount"`
	Gates         vulnerabilityLearningWritebackWebViewGate `json:"gates"`
	Observations  []string                                  `json:"observations,omitempty"`
	Error         string                                    `json:"error,omitempty"`
}

type vulnerabilityLearningWritebackWebViewGate struct {
	VulnerabilityPageOpened bool `json:"vulnerabilityPageOpened"`
	TargetCVESelected       bool `json:"targetCveSelected"`
	ImportFormOpened        bool `json:"importFormOpened"`
	ConclusionSubmitted     bool `json:"conclusionSubmitted"`
	FormalArchiveVisible    bool `json:"formalArchiveVisible"`
	LearningProjected       bool `json:"learningProjected"`
	RawContentOmitted       bool `json:"rawContentOmitted"`
}

func (a *App) vulnerabilityLearningWritebackWebViewSmokeRequest() vulnerabilityLearningWritebackWebViewSmokeRequest {
	resultPath := strings.TrimSpace(os.Getenv(vulnerabilityLearningWritebackWebViewSmokeResultEnv))
	if resultPath == "" {
		return vulnerabilityLearningWritebackWebViewSmokeRequest{}
	}
	cveID := strings.ToUpper(strings.TrimSpace(os.Getenv(vulnerabilityLearningWritebackWebViewSmokeCVEIDEnv)))
	if cveID == "" {
		cveID = defaultVulnerabilityLearningWritebackWebViewCVE
	}
	conclusion := strings.TrimSpace(os.Getenv(vulnerabilityLearningWritebackWebViewSmokeConclusionEnv))
	if conclusion == "" {
		conclusion = defaultVulnerabilityLearningWritebackWebViewConclusion
	}
	return vulnerabilityLearningWritebackWebViewSmokeRequest{
		Enabled:    true,
		CVEID:      cveID,
		Conclusion: conclusion,
	}
}

func (a *App) completeVulnerabilityLearningWritebackWebViewSmoke(
	report vulnerabilityLearningWritebackWebViewSmokeReport,
) error {
	resultPath := strings.TrimSpace(os.Getenv(vulnerabilityLearningWritebackWebViewSmokeResultEnv))
	if resultPath == "" {
		return errors.New("vulnerability learning writeback WebView smoke is not enabled")
	}
	report.Schema = "milksu-vuln-learning-writeback-webview-smoke/v1"
	report.RanAt = time.Now().UTC().Format(time.RFC3339Nano)
	report.DataDirectory = a.dataDirectory
	report.Gates.RawContentOmitted = true
	return writeVulnerabilityLearningWritebackWebViewSmokeReport(resultPath, report)
}

func writeVulnerabilityLearningWritebackWebViewSmokeReport(
	path string,
	report vulnerabilityLearningWritebackWebViewSmokeReport,
) error {
	absolute, err := filepath.Abs(path)
	if err != nil {
		return fmt.Errorf("resolve vulnerability learning writeback WebView smoke report path: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(absolute), 0o700); err != nil {
		return fmt.Errorf("create vulnerability learning writeback WebView smoke report directory: %w", err)
	}
	payload, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		return fmt.Errorf("encode vulnerability learning writeback WebView smoke report: %w", err)
	}
	payload = append(payload, '\n')
	temporary, err := os.CreateTemp(filepath.Dir(absolute), ".milksu-vuln-learning-writeback-webview-smoke-*")
	if err != nil {
		return fmt.Errorf("create temporary vulnerability learning writeback WebView smoke report: %w", err)
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(0o600); err != nil {
		temporary.Close()
		return fmt.Errorf("protect temporary vulnerability learning writeback WebView smoke report: %w", err)
	}
	if _, err := temporary.Write(payload); err != nil {
		temporary.Close()
		return fmt.Errorf("write temporary vulnerability learning writeback WebView smoke report: %w", err)
	}
	if err := temporary.Sync(); err != nil {
		temporary.Close()
		return fmt.Errorf("sync temporary vulnerability learning writeback WebView smoke report: %w", err)
	}
	if err := temporary.Close(); err != nil {
		return fmt.Errorf("close temporary vulnerability learning writeback WebView smoke report: %w", err)
	}
	if err := os.Rename(temporaryPath, absolute); err != nil {
		return fmt.Errorf("install vulnerability learning writeback WebView smoke report: %w", err)
	}
	if err := os.Chmod(absolute, 0o600); err != nil {
		return fmt.Errorf("protect vulnerability learning writeback WebView smoke report: %w", err)
	}
	return nil
}
