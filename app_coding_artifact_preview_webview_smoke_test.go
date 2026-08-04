package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/MilkSU-Official/milksu/internal/appdata"
)

func TestCodingArtifactPreviewWebViewSmokeRequestAndReport(t *testing.T) {
	workspace := t.TempDir()
	reportPath := filepath.Join(t.TempDir(), "artifact-preview-webview-smoke.json")
	t.Setenv(codingArtifactPreviewSmokeWorkspaceEnv, workspace)
	t.Setenv(codingArtifactPreviewWebViewSmokeResultEnv, reportPath)

	application := &App{
		dataDirectory: t.TempDir(),
		diagnostics:   appdata.NewDiagnosticRecorder(32),
	}
	request := application.GetCodingArtifactPreviewWebViewSmokeRequest()
	if !request.Enabled ||
		request.Workspace != workspace ||
		request.RelativePath != defaultCodingArtifactPreviewWebViewPath {
		t.Fatalf("unexpected WebView smoke request: %#v", request)
	}

	err := application.CompleteCodingArtifactPreviewWebViewSmoke(
		codingArtifactPreviewWebViewSmokeReport{
			Workspace:        workspace,
			RelativePath:     request.RelativePath,
			Kind:             "html",
			MediaType:        "text/html",
			SandboxAttribute: "",
			CSP:              "default-src 'none'; connect-src 'none'; script-src 'none'",
			Gates: map[string]bool{
				"backendHTMLRead":                    true,
				"iframeSandboxPresent":               true,
				"iframeSandboxDoesNotAllowScripts":   true,
				"sanitizerRemovedExecutableElements": true,
				"sanitizerRemovedExternalResources":  true,
				"cspBlocksNetworkAndScripts":         true,
				"credentialRedacted":                 true,
				"parentNotMutated":                   true,
			},
			Summary: codingArtifactWebViewSummary{
				SourceBytes:         256,
				SanitizedBytes:      128,
				RedactedMarkerCount: 1,
				BodyText:            "Dangerous HTML smoke",
			},
		},
	)
	if err != nil {
		t.Fatalf("CompleteCodingArtifactPreviewWebViewSmoke() error = %v", err)
	}

	payload, err := os.ReadFile(reportPath)
	if err != nil {
		t.Fatalf("read WebView smoke report: %v", err)
	}
	var report codingArtifactPreviewWebViewSmokeReport
	if err := json.Unmarshal(payload, &report); err != nil {
		t.Fatalf("decode WebView smoke report: %v", err)
	}
	if report.Schema != "milksu-coding-artifact-preview-webview-smoke/v1" ||
		report.Error != "" ||
		report.DataDirectory != application.dataDirectory ||
		!report.Gates["iframeSandboxDoesNotAllowScripts"] {
		t.Fatalf("unexpected WebView smoke report: %#v", report)
	}
	if strings.Contains(string(payload), "sk-artifact-webview-secret") {
		t.Fatalf("WebView smoke report leaked fixture credential: %s", payload)
	}
	info, err := os.Stat(reportPath)
	if err != nil {
		t.Fatalf("stat WebView smoke report: %v", err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("WebView smoke report mode = %o, want 0600", info.Mode().Perm())
	}
}

func TestCodingArtifactPreviewWebViewSmokeDisabled(t *testing.T) {
	application := &App{dataDirectory: t.TempDir()}
	if request := application.GetCodingArtifactPreviewWebViewSmokeRequest(); request.Enabled {
		t.Fatalf("WebView smoke should be disabled without env, got %#v", request)
	}
	if err := application.CompleteCodingArtifactPreviewWebViewSmoke(
		codingArtifactPreviewWebViewSmokeReport{},
	); err == nil || !strings.Contains(err.Error(), "not enabled") {
		t.Fatalf("expected disabled WebView smoke error, got %v", err)
	}
}
