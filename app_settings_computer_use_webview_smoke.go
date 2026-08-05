package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/MilkSU-Official/milksu/internal/computercap"
)

const settingsComputerUseWebViewSmokeResultEnv = "MILKSU_SETTINGS_COMPUTER_USE_WEBVIEW_SMOKE_RESULT"

type settingsComputerUseWebViewSmokeRequest struct {
	Enabled bool `json:"enabled"`
}

type settingsComputerUseWebViewSmokeReport struct {
	Schema          string                               `json:"schema"`
	RanAt           string                               `json:"ranAt"`
	DataDirectory   string                               `json:"dataDirectory"`
	InitialStatus   computercap.Status                   `json:"initialStatus"`
	RefreshedStatus computercap.Status                   `json:"refreshedStatus"`
	Gates           settingsComputerUseWebViewSmokeGates `json:"gates"`
	Observations    []string                             `json:"observations,omitempty"`
	Error           string                               `json:"error,omitempty"`
}

type settingsComputerUseWebViewSmokeGates struct {
	SettingsOpened            bool `json:"settingsOpened"`
	ComputerUseSectionVisible bool `json:"computerUseSectionVisible"`
	InitialStatusRead         bool `json:"initialStatusRead"`
	RefreshButtonClicked      bool `json:"refreshButtonClicked"`
	RefreshedStatusRead       bool `json:"refreshedStatusRead"`
	RefreshNoticeVisible      bool `json:"refreshNoticeVisible"`
	SigningDiagnosticVisible  bool `json:"signingDiagnosticVisible"`
	NoCredentialLeak          bool `json:"noCredentialLeak"`
}

func (a *App) GetSettingsComputerUseWebViewSmokeRequest() settingsComputerUseWebViewSmokeRequest {
	return settingsComputerUseWebViewSmokeRequest{
		Enabled: strings.TrimSpace(os.Getenv(settingsComputerUseWebViewSmokeResultEnv)) != "",
	}
}

func (a *App) CompleteSettingsComputerUseWebViewSmoke(
	report settingsComputerUseWebViewSmokeReport,
) error {
	resultPath := strings.TrimSpace(os.Getenv(settingsComputerUseWebViewSmokeResultEnv))
	if resultPath == "" {
		return errors.New("settings Computer Use WebView smoke is not enabled")
	}
	report.Schema = "milksu-settings-computer-use-webview-smoke/v1"
	report.RanAt = time.Now().UTC().Format(time.RFC3339Nano)
	report.DataDirectory = a.dataDirectory
	report.Gates.NoCredentialLeak = !settingsComputerUseWebViewSmokeContainsSensitiveShape(report)
	return writeSettingsComputerUseWebViewSmokeReport(resultPath, report)
}

func writeSettingsComputerUseWebViewSmokeReport(
	path string,
	report settingsComputerUseWebViewSmokeReport,
) error {
	absolute, err := filepath.Abs(path)
	if err != nil {
		return fmt.Errorf("resolve settings Computer Use WebView smoke report path: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(absolute), 0o700); err != nil {
		return fmt.Errorf("create settings Computer Use WebView smoke report directory: %w", err)
	}
	payload, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		return fmt.Errorf("encode settings Computer Use WebView smoke report: %w", err)
	}
	payload = append(payload, '\n')
	temporary, err := os.CreateTemp(filepath.Dir(absolute), ".milksu-settings-computer-use-webview-smoke-*")
	if err != nil {
		return fmt.Errorf("create temporary settings Computer Use WebView smoke report: %w", err)
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(0o600); err != nil {
		temporary.Close()
		return fmt.Errorf("protect temporary settings Computer Use WebView smoke report: %w", err)
	}
	if _, err := temporary.Write(payload); err != nil {
		temporary.Close()
		return fmt.Errorf("write temporary settings Computer Use WebView smoke report: %w", err)
	}
	if err := temporary.Sync(); err != nil {
		temporary.Close()
		return fmt.Errorf("sync temporary settings Computer Use WebView smoke report: %w", err)
	}
	if err := temporary.Close(); err != nil {
		return fmt.Errorf("close temporary settings Computer Use WebView smoke report: %w", err)
	}
	if err := os.Rename(temporaryPath, absolute); err != nil {
		return fmt.Errorf("install settings Computer Use WebView smoke report: %w", err)
	}
	return os.Chmod(absolute, 0o600)
}

func settingsComputerUseWebViewSmokeContainsSensitiveShape(report settingsComputerUseWebViewSmokeReport) bool {
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
		"openai_api_key",
		"anthropic_api_key",
		"deepseek_api_key",
	} {
		if strings.Contains(lower, forbidden) {
			return true
		}
	}
	return false
}
