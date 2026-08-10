package main

import (
	"path/filepath"
	"testing"
)

func TestCodingBrowserEvidenceWorkspaceUsesOnlyTrustedAppState(t *testing.T) {
	explicit, err := codingBrowserEvidenceWorkspace(
		"/tmp/project",
		"/tmp/app-data",
	)
	if err != nil || explicit != "/tmp/project" {
		t.Fatalf("unexpected explicit workspace: %q, %v", explicit, err)
	}
	temporary, err := codingBrowserEvidenceWorkspace("", "/tmp/app-data")
	if err != nil {
		t.Fatalf("derive temporary workspace: %v", err)
	}
	if temporary != filepath.Join("/tmp/app-data", "agent-workspace") {
		t.Fatalf("unexpected temporary workspace: %q", temporary)
	}
	if _, err := codingBrowserEvidenceWorkspace("", ""); err == nil {
		t.Fatal("expected missing trusted app data directory to be rejected")
	}
}
