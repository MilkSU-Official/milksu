package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestVulnerabilityLearningWritebackWebViewSmokeRequestAndReport(t *testing.T) {
	reportPath := filepath.Join(t.TempDir(), "vuln-learning-writeback-webview-smoke.json")
	t.Setenv(vulnerabilityLearningWritebackWebViewSmokeResultEnv, reportPath)
	t.Setenv(vulnerabilityLearningWritebackWebViewSmokeCVEIDEnv, " cve-2023-46604 ")
	t.Setenv(vulnerabilityLearningWritebackWebViewSmokeConclusionEnv, "User-confirmed UI smoke note.")
	application := &App{dataDirectory: t.TempDir()}

	request := application.GetVulnerabilityLearningWritebackWebViewSmokeRequest()
	if !request.Enabled || request.CVEID != "CVE-2023-46604" || request.Conclusion == "" {
		t.Fatalf("unexpected WebView smoke request: %#v", request)
	}
	err := application.CompleteVulnerabilityLearningWritebackWebViewSmoke(
		vulnerabilityLearningWritebackWebViewSmokeReport{
			CVEID:         "CVE-2023-46604",
			SelectedTitle: "Apache ActiveMQ OpenWire RCE",
			WorkspaceJob:  "job_smoke",
			LearningCount: 1,
			Gates: vulnerabilityLearningWritebackWebViewGate{
				VulnerabilityPageOpened: true,
				TargetCVESelected:       true,
				ImportFormOpened:        true,
				ConclusionSubmitted:     true,
				FormalArchiveVisible:    true,
				LearningProjected:       true,
			},
		},
	)
	if err != nil {
		t.Fatalf("CompleteVulnerabilityLearningWritebackWebViewSmoke() error = %v", err)
	}
	payload, err := os.ReadFile(reportPath)
	if err != nil {
		t.Fatalf("read WebView smoke report: %v", err)
	}
	var report vulnerabilityLearningWritebackWebViewSmokeReport
	if err := json.Unmarshal(payload, &report); err != nil {
		t.Fatalf("decode WebView smoke report: %v", err)
	}
	if report.Schema != "milksu-vuln-learning-writeback-webview-smoke/v1" ||
		report.DataDirectory != application.dataDirectory ||
		!report.Gates.RawContentOmitted {
		t.Fatalf("unexpected WebView smoke report: %#v", report)
	}
	if strings.Contains(string(payload), request.Conclusion) {
		t.Fatalf("WebView smoke report leaked raw conclusion: %s", payload)
	}
	info, err := os.Stat(reportPath)
	if err != nil {
		t.Fatalf("stat WebView smoke report: %v", err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("WebView smoke report mode = %o, want 0600", info.Mode().Perm())
	}
}

func TestVulnerabilityLearningWritebackWebViewSmokeDisabled(t *testing.T) {
	application := &App{}
	if request := application.GetVulnerabilityLearningWritebackWebViewSmokeRequest(); request.Enabled {
		t.Fatalf("WebView smoke should be disabled without env, got %#v", request)
	}
	if err := application.CompleteVulnerabilityLearningWritebackWebViewSmoke(
		vulnerabilityLearningWritebackWebViewSmokeReport{},
	); err == nil {
		t.Fatal("expected disabled WebView smoke error")
	}
}
