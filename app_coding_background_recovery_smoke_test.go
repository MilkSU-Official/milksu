package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/MilkSU-Official/milksu/internal/engine"
)

func TestCodingBackgroundRecoverySmokeReportFlagsSensitiveShapes(t *testing.T) {
	report := codingBackgroundRecoverySmokeReport{
		Schema:         codingBackgroundRecoverySmokeSchema,
		ConversationID: "coding-bg-recovery",
		Workspace:      "/tmp/workspace",
		Task: &engine.BackgroundTask{
			ID:      "bg_test",
			Status:  "running",
			LogTail: "OPENAI_API_KEY=should-not-enter-report",
		},
	}
	if !codingBackgroundRecoverySmokeContainsSensitiveShape(report) {
		t.Fatal("expected sensitive shape to be detected")
	}
	report.Task.LogTail = "MILKSU_BG_RECOVERY_READY"
	if codingBackgroundRecoverySmokeContainsSensitiveShape(report) {
		payload, _ := json.Marshal(report)
		t.Fatalf("unexpected sensitive shape in safe report: %s", payload)
	}
}

func TestWriteCodingBackgroundRecoverySmokeReportIsPrivate(t *testing.T) {
	path := filepath.Join(t.TempDir(), "background-recovery.json")
	report := codingBackgroundRecoverySmokeReport{
		Schema: codingBackgroundRecoverySmokeSchema,
		Gates:  codingBackgroundRecoverySmokeGates{NoCredentialLeak: true},
	}
	if err := writeCodingBackgroundRecoverySmokeReport(path, report); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("report permissions = %o, want 600", info.Mode().Perm())
	}
}
