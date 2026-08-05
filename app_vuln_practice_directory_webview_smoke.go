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
	vulnerabilityPracticeDirectoryWebViewSmokeResultEnv    = "MILKSU_VULN_PRACTICE_DIRECTORY_WEBVIEW_SMOKE_RESULT"
	vulnerabilityPracticeDirectoryWebViewSmokeCVEIDEnv     = "MILKSU_VULN_PRACTICE_DIRECTORY_WEBVIEW_SMOKE_CVE_ID"
	vulnerabilityPracticeDirectoryWebViewSmokeDirectoryEnv = "MILKSU_VULN_PRACTICE_DIRECTORY_WEBVIEW_SMOKE_DIRECTORY"
	defaultVulnerabilityPracticeDirectoryWebViewCVE        = "CVE-2023-46604"
)

type vulnerabilityPracticeDirectoryWebViewSmokeRequest struct {
	Enabled           bool   `json:"enabled"`
	CVEID             string `json:"cveId,omitempty"`
	DirectoryBasename string `json:"directoryBasename,omitempty"`
}

type vulnerabilityPracticeDirectoryWebViewSmokeReport struct {
	Schema            string                                         `json:"schema"`
	RanAt             string                                         `json:"ranAt"`
	DataDirectory     string                                         `json:"dataDirectory"`
	CVEID             string                                         `json:"cveId"`
	SelectedTitle     string                                         `json:"selectedTitle,omitempty"`
	DirectoryBasename string                                         `json:"directoryBasename,omitempty"`
	Gates             vulnerabilityPracticeDirectoryWebViewSmokeGate `json:"gates"`
	Observations      []string                                       `json:"observations,omitempty"`
	Error             string                                         `json:"error,omitempty"`
}

type vulnerabilityPracticeDirectoryWebViewSmokeGate struct {
	VulnerabilityPageOpened bool `json:"vulnerabilityPageOpened"`
	TargetCVESelected       bool `json:"targetCveSelected"`
	PracticePlanConfirmed   bool `json:"practicePlanConfirmed"`
	DirectoryChooserInvoked bool `json:"directoryChooserInvoked"`
	VulhubDirectoryVisible  bool `json:"vulhubDirectoryVisible"`
	StartButtonVisible      bool `json:"startButtonVisible"`
	RuntimeNotStarted       bool `json:"runtimeNotStarted"`
	RawDirectoryOmitted     bool `json:"rawDirectoryOmitted"`
}

func vulnerabilityPracticeDirectoryWebViewSmokeDirectoryOverride() (string, bool, error) {
	if strings.TrimSpace(os.Getenv(vulnerabilityPracticeDirectoryWebViewSmokeResultEnv)) == "" {
		return "", false, nil
	}
	directory := strings.TrimSpace(os.Getenv(vulnerabilityPracticeDirectoryWebViewSmokeDirectoryEnv))
	if directory == "" {
		return "", false, nil
	}
	absolute, err := filepath.Abs(directory)
	if err != nil {
		return "", true, fmt.Errorf("resolve vulnerability practice directory WebView smoke directory: %w", err)
	}
	info, err := os.Stat(absolute)
	if err != nil {
		return "", true, fmt.Errorf("inspect vulnerability practice directory WebView smoke directory: %w", err)
	}
	if !info.IsDir() {
		return "", true, fmt.Errorf("vulnerability practice directory WebView smoke path is not a directory")
	}
	return absolute, true, nil
}

func (a *App) GetVulnerabilityPracticeDirectoryWebViewSmokeRequest() vulnerabilityPracticeDirectoryWebViewSmokeRequest {
	resultPath := strings.TrimSpace(os.Getenv(vulnerabilityPracticeDirectoryWebViewSmokeResultEnv))
	if resultPath == "" {
		return vulnerabilityPracticeDirectoryWebViewSmokeRequest{}
	}
	cveID := strings.ToUpper(strings.TrimSpace(os.Getenv(vulnerabilityPracticeDirectoryWebViewSmokeCVEIDEnv)))
	if cveID == "" {
		cveID = defaultVulnerabilityPracticeDirectoryWebViewCVE
	}
	directoryBasename := ""
	if directory, ok, err := vulnerabilityPracticeDirectoryWebViewSmokeDirectoryOverride(); ok && err == nil {
		directoryBasename = filepath.Base(directory)
	}
	return vulnerabilityPracticeDirectoryWebViewSmokeRequest{
		Enabled:           true,
		CVEID:             cveID,
		DirectoryBasename: directoryBasename,
	}
}

func (a *App) CompleteVulnerabilityPracticeDirectoryWebViewSmoke(
	report vulnerabilityPracticeDirectoryWebViewSmokeReport,
) error {
	resultPath := strings.TrimSpace(os.Getenv(vulnerabilityPracticeDirectoryWebViewSmokeResultEnv))
	if resultPath == "" {
		return errors.New("vulnerability practice directory WebView smoke is not enabled")
	}
	report.Schema = "milksu-vuln-practice-directory-webview-smoke/v1"
	report.RanAt = time.Now().UTC().Format(time.RFC3339Nano)
	report.DataDirectory = a.dataDirectory
	report.Gates.RawDirectoryOmitted = true
	return writeVulnerabilityPracticeDirectoryWebViewSmokeReport(resultPath, report)
}

func writeVulnerabilityPracticeDirectoryWebViewSmokeReport(
	path string,
	report vulnerabilityPracticeDirectoryWebViewSmokeReport,
) error {
	absolute, err := filepath.Abs(path)
	if err != nil {
		return fmt.Errorf("resolve vulnerability practice directory WebView smoke report path: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(absolute), 0o700); err != nil {
		return fmt.Errorf("create vulnerability practice directory WebView smoke report directory: %w", err)
	}
	payload, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		return fmt.Errorf("encode vulnerability practice directory WebView smoke report: %w", err)
	}
	payload = append(payload, '\n')
	temporary, err := os.CreateTemp(filepath.Dir(absolute), ".milksu-vuln-practice-directory-webview-smoke-*")
	if err != nil {
		return fmt.Errorf("create temporary vulnerability practice directory WebView smoke report: %w", err)
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(0o600); err != nil {
		temporary.Close()
		return fmt.Errorf("protect temporary vulnerability practice directory WebView smoke report: %w", err)
	}
	if _, err := temporary.Write(payload); err != nil {
		temporary.Close()
		return fmt.Errorf("write temporary vulnerability practice directory WebView smoke report: %w", err)
	}
	if err := temporary.Sync(); err != nil {
		temporary.Close()
		return fmt.Errorf("sync temporary vulnerability practice directory WebView smoke report: %w", err)
	}
	if err := temporary.Close(); err != nil {
		return fmt.Errorf("close temporary vulnerability practice directory WebView smoke report: %w", err)
	}
	if err := os.Rename(temporaryPath, absolute); err != nil {
		return fmt.Errorf("install vulnerability practice directory WebView smoke report: %w", err)
	}
	if err := os.Chmod(absolute, 0o600); err != nil {
		return fmt.Errorf("protect vulnerability practice directory WebView smoke report: %w", err)
	}
	return nil
}
