package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/MilkSU-Official/milksu/internal/appdata"
)

func TestBuildStartupRecoverySmokeReportDetectsAbnormalPreviousRun(t *testing.T) {
	root := t.TempDir()
	if _, _, err := appdata.BeginLifespan(root, 1234); err != nil {
		t.Fatal(err)
	}
	start, handle, err := appdata.BeginLifespan(root, os.Getpid())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = appdata.MarkCleanExit(root, handle)
	})

	application := &App{
		dataDirectory: root,
		lifespanStart: start,
	}
	report := application.buildStartupRecoverySmokeReport()
	if report.Error != "" {
		t.Fatalf("unexpected smoke error: %s", report.Error)
	}
	if report.Schema != startupRecoverySmokeSchema {
		t.Fatalf("schema = %q, want %q", report.Schema, startupRecoverySmokeSchema)
	}
	if !report.Gates.DetectedPreviousAbnormalExit ||
		!report.Gates.PreviousPIDRecorded ||
		!report.Gates.CurrentRunMarkedRunning ||
		!report.Gates.CurrentPIDRecorded ||
		!report.Gates.AbnormalCountIncremented ||
		!report.Gates.NoSessionContent {
		t.Fatalf("unexpected gates: %+v", report.Gates)
	}
	if report.Startup.PreviousPID != 1234 {
		t.Fatalf("previous pid = %d, want 1234", report.Startup.PreviousPID)
	}
	if report.Persisted.LastExit != appdata.LifespanExitRunning {
		t.Fatalf("persisted exit = %q, want running", report.Persisted.LastExit)
	}
	encoded, err := json.Marshal(report)
	if err != nil {
		t.Fatal(err)
	}
	for _, forbidden := range []string{"api_key", "authorization", "sk-", "message content", "tool output"} {
		if strings.Contains(strings.ToLower(string(encoded)), forbidden) {
			t.Fatalf("startup recovery report leaked forbidden shape %q: %s", forbidden, encoded)
		}
	}
}

func TestWriteStartupRecoverySmokeReportIsPrivate(t *testing.T) {
	path := filepath.Join(t.TempDir(), "startup-recovery.json")
	report := startupRecoverySmokeReport{
		Schema: startupRecoverySmokeSchema,
		Gates:  startupRecoverySmokeGates{NoSessionContent: true},
	}
	if err := writeStartupRecoverySmokeReport(path, report); err != nil {
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
