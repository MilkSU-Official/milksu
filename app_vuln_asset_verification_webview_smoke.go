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
	vulnerabilityAssetVerificationWebViewSmokeResultEnv       = "MILKSU_VULN_ASSET_VERIFICATION_WEBVIEW_SMOKE_RESULT"
	vulnerabilityAssetVerificationWebViewSmokeCVEIDEnv        = "MILKSU_VULN_ASSET_VERIFICATION_WEBVIEW_SMOKE_CVE_ID"
	vulnerabilityAssetVerificationWebViewSmokeAssetNameEnv    = "MILKSU_VULN_ASSET_VERIFICATION_WEBVIEW_SMOKE_ASSET_NAME"
	vulnerabilityAssetVerificationWebViewSmokeAssetAddressEnv = "MILKSU_VULN_ASSET_VERIFICATION_WEBVIEW_SMOKE_ASSET_ADDRESS"
	vulnerabilityAssetVerificationWebViewSmokeEnvironmentEnv  = "MILKSU_VULN_ASSET_VERIFICATION_WEBVIEW_SMOKE_ENVIRONMENT"
	defaultVulnerabilityAssetVerificationWebViewCVE           = "CVE-2023-46604"
	defaultVulnerabilityAssetVerificationWebViewAssetName     = "packaged-smoke-activemq"
	defaultVulnerabilityAssetVerificationWebViewAssetAddress  = "tcp://127.0.0.1:61616"
	defaultVulnerabilityAssetVerificationWebViewEnvironment   = "isolated-local"
)

type vulnerabilityAssetVerificationWebViewSmokeRequest struct {
	Enabled     bool   `json:"enabled"`
	CVEID       string `json:"cveId,omitempty"`
	AssetName   string `json:"assetName,omitempty"`
	Address     string `json:"address,omitempty"`
	Environment string `json:"environment,omitempty"`
}

type vulnerabilityAssetVerificationWebViewSmokeReport struct {
	Schema                 string                                    `json:"schema"`
	RanAt                  string                                    `json:"ranAt"`
	DataDirectory          string                                    `json:"dataDirectory"`
	CVEID                  string                                    `json:"cveId"`
	SelectedTitle          string                                    `json:"selectedTitle,omitempty"`
	WorkspaceJob           string                                    `json:"workspaceJobId,omitempty"`
	AssetVerificationCount int                                       `json:"assetVerificationCount"`
	Gates                  vulnerabilityAssetVerificationWebViewGate `json:"gates"`
	Observations           []string                                  `json:"observations,omitempty"`
	Error                  string                                    `json:"error,omitempty"`
}

type vulnerabilityAssetVerificationWebViewGate struct {
	VulnerabilityPageOpened bool `json:"vulnerabilityPageOpened"`
	TargetCVESelected       bool `json:"targetCveSelected"`
	AssetFormOpened         bool `json:"assetFormOpened"`
	AssetSubmitted          bool `json:"assetSubmitted"`
	AssetVisible            bool `json:"assetVisible"`
	FormalArchiveVisible    bool `json:"formalArchiveVisible"`
	AssetProjected          bool `json:"assetProjected"`
	RawAssetAddressOmitted  bool `json:"rawAssetAddressOmitted"`
}

func (a *App) GetVulnerabilityAssetVerificationWebViewSmokeRequest() vulnerabilityAssetVerificationWebViewSmokeRequest {
	resultPath := strings.TrimSpace(os.Getenv(vulnerabilityAssetVerificationWebViewSmokeResultEnv))
	if resultPath == "" {
		return vulnerabilityAssetVerificationWebViewSmokeRequest{}
	}
	cveID := strings.ToUpper(strings.TrimSpace(os.Getenv(vulnerabilityAssetVerificationWebViewSmokeCVEIDEnv)))
	if cveID == "" {
		cveID = defaultVulnerabilityAssetVerificationWebViewCVE
	}
	assetName := strings.TrimSpace(os.Getenv(vulnerabilityAssetVerificationWebViewSmokeAssetNameEnv))
	if assetName == "" {
		assetName = defaultVulnerabilityAssetVerificationWebViewAssetName
	}
	address := strings.TrimSpace(os.Getenv(vulnerabilityAssetVerificationWebViewSmokeAssetAddressEnv))
	if address == "" {
		address = defaultVulnerabilityAssetVerificationWebViewAssetAddress
	}
	environment := strings.TrimSpace(os.Getenv(vulnerabilityAssetVerificationWebViewSmokeEnvironmentEnv))
	if environment == "" {
		environment = defaultVulnerabilityAssetVerificationWebViewEnvironment
	}
	return vulnerabilityAssetVerificationWebViewSmokeRequest{
		Enabled:     true,
		CVEID:       cveID,
		AssetName:   assetName,
		Address:     address,
		Environment: environment,
	}
}

func (a *App) CompleteVulnerabilityAssetVerificationWebViewSmoke(
	report vulnerabilityAssetVerificationWebViewSmokeReport,
) error {
	resultPath := strings.TrimSpace(os.Getenv(vulnerabilityAssetVerificationWebViewSmokeResultEnv))
	if resultPath == "" {
		return errors.New("vulnerability asset verification WebView smoke is not enabled")
	}
	report.Schema = "milksu-vuln-asset-verification-webview-smoke/v1"
	report.RanAt = time.Now().UTC().Format(time.RFC3339Nano)
	report.DataDirectory = a.dataDirectory
	report.Gates.RawAssetAddressOmitted = true
	return writeVulnerabilityAssetVerificationWebViewSmokeReport(resultPath, report)
}

func writeVulnerabilityAssetVerificationWebViewSmokeReport(
	path string,
	report vulnerabilityAssetVerificationWebViewSmokeReport,
) error {
	absolute, err := filepath.Abs(path)
	if err != nil {
		return fmt.Errorf("resolve vulnerability asset verification WebView smoke report path: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(absolute), 0o700); err != nil {
		return fmt.Errorf("create vulnerability asset verification WebView smoke report directory: %w", err)
	}
	payload, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		return fmt.Errorf("encode vulnerability asset verification WebView smoke report: %w", err)
	}
	payload = append(payload, '\n')
	temporary, err := os.CreateTemp(filepath.Dir(absolute), ".milksu-vuln-asset-verification-webview-smoke-*")
	if err != nil {
		return fmt.Errorf("create temporary vulnerability asset verification WebView smoke report: %w", err)
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(0o600); err != nil {
		temporary.Close()
		return fmt.Errorf("protect temporary vulnerability asset verification WebView smoke report: %w", err)
	}
	if _, err := temporary.Write(payload); err != nil {
		temporary.Close()
		return fmt.Errorf("write temporary vulnerability asset verification WebView smoke report: %w", err)
	}
	if err := temporary.Sync(); err != nil {
		temporary.Close()
		return fmt.Errorf("sync temporary vulnerability asset verification WebView smoke report: %w", err)
	}
	if err := temporary.Close(); err != nil {
		return fmt.Errorf("close temporary vulnerability asset verification WebView smoke report: %w", err)
	}
	if err := os.Rename(temporaryPath, absolute); err != nil {
		return fmt.Errorf("install vulnerability asset verification WebView smoke report: %w", err)
	}
	if err := os.Chmod(absolute, 0o600); err != nil {
		return fmt.Errorf("protect vulnerability asset verification WebView smoke report: %w", err)
	}
	return nil
}
