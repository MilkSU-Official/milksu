package appdata

import (
	"archive/zip"
	"context"
	"database/sql"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestExportDiagnosticsReportsHealthWithoutCopyingSecrets(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(
		filepath.Join(root, "settings.json"),
		[]byte(`{"api_key":"must-not-leak"}`),
		0o600,
	); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(
		filepath.Join(root, "credentials.db"),
		[]byte("credential-payload-must-not-leak"),
		0o600,
	); err != nil {
		t.Fatal(err)
	}
	memoryPath := filepath.Join(root, "ctf", "memory.sqlite3")
	if err := os.MkdirAll(filepath.Dir(memoryPath), 0o700); err != nil {
		t.Fatal(err)
	}
	database, err := sql.Open("sqlite", memoryPath)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := database.Exec(`CREATE TABLE memory (id TEXT PRIMARY KEY)`); err != nil {
		database.Close()
		t.Fatal(err)
	}
	if err := database.Close(); err != nil {
		t.Fatal(err)
	}

	destination := filepath.Join(t.TempDir(), "MilkSU-diagnostics.zip")
	exported, err := ExportDiagnostics(
		context.Background(),
		root,
		destination,
		DiagnosticInput{
			AppVersion: "0.1.0",
			Runtime: DiagnosticRuntime{
				DefaultEngine:       "pi",
				Running:             true,
				SessionCount:        2,
				Protocol:            "jsonl-stdio/v1alpha1",
				BackgroundTaskCount: 1,
			},
			Settings: DiagnosticSettings{
				ActiveProvider:     "deepseek",
				ActiveModel:        "deepseek-v4-flash",
				DefaultMode:        "auto",
				ModelVerified:      true,
				ConfiguredProvider: []string{"deepseek", "deepseek"},
				ArenaTokenPresent:  true,
			},
			Lifespan: LifespanStart{
				PreviousExit:             LifespanExitAbnormal,
				PreviousStartedAt:        "2026-08-03T04:00:00Z",
				ConsecutiveAbnormalExits: 2,
				PreviousPID:              4242,
				StartedAt:                "2026-08-03T05:00:00Z",
			},
			Events: []DiagnosticEvent{{
				Category: "engine",
				Level:    "error",
				Message:  "request failed api_key=must-not-leak Bearer secret-bearer-value",
			}},
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if exported.Path != destination || exported.EventCount != 1 || exported.Bytes <= 0 {
		t.Fatalf("unexpected export: %#v", exported)
	}
	info, err := os.Stat(destination)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("diagnostic archive permissions = %o, want 600", info.Mode().Perm())
	}

	report := readDiagnosticReportForTest(t, destination)
	if report.Schema != DiagnosticsSchema || report.AppVersion != "0.1.0" {
		t.Fatalf("unexpected report identity: %#v", report)
	}
	if report.Data.Directory != filepath.Join("<user-data>", filepath.Base(root)) {
		t.Fatalf("diagnostic leaked or lost data-root label: %q", report.Data.Directory)
	}
	if len(report.Settings.ConfiguredProvider) != 1 ||
		report.Settings.ConfiguredProvider[0] != "deepseek" {
		t.Fatalf("provider summary was not normalized: %#v", report.Settings)
	}
	if len(report.RecentEvents) != 1 ||
		!strings.Contains(report.RecentEvents[0].Message, "[REDACTED]") {
		t.Fatalf("diagnostic event was not redacted: %#v", report.RecentEvents)
	}
	if report.Lifespan.PreviousExit != LifespanExitAbnormal ||
		report.Lifespan.ConsecutiveAbnormalExits != 2 ||
		report.Lifespan.PreviousStartedAt != "2026-08-03T04:00:00Z" {
		t.Fatalf("diagnostic lifespan summary was lost: %#v", report.Lifespan)
	}
	var credentialHealth, memoryHealth *DiagnosticDatabase
	for index := range report.Databases {
		switch report.Databases[index].Path {
		case "credentials.db":
			credentialHealth = &report.Databases[index]
		case "ctf/memory.sqlite3":
			memoryHealth = &report.Databases[index]
		}
	}
	if credentialHealth == nil || !credentialHealth.Exists ||
		credentialHealth.QuickCheck != "" || credentialHealth.Error == "" {
		t.Fatalf("invalid credential database should only expose health metadata: %#v", credentialHealth)
	}
	if memoryHealth == nil || memoryHealth.QuickCheck != "ok" || memoryHealth.Error != "" {
		t.Fatalf("valid database health was not reported: %#v", memoryHealth)
	}

	payload := readDiagnosticArchiveBytes(t, destination)
	for _, forbidden := range []string{
		"must-not-leak",
		"secret-bearer-value",
		"credential-payload-must-not-leak",
		root,
	} {
		if strings.Contains(payload, forbidden) {
			t.Fatalf("diagnostic archive leaked %q: %s", forbidden, payload)
		}
	}
}

func TestExportDiagnosticsDoesNotCopyRuntimeLogsOrRawToolOutput(t *testing.T) {
	root := t.TempDir()
	logPath := filepath.Join(root, "runtime", "milksu.log")
	if err := os.MkdirAll(filepath.Dir(logPath), 0o700); err != nil {
		t.Fatal(err)
	}
	rawLog := strings.Join([]string{
		"user session body must-not-enter-diagnostics",
		"tool raw output api_key=raw-tool-secret",
		"assistant reply Bearer raw-bearer-secret",
	}, "\n")
	if err := os.WriteFile(logPath, []byte(rawLog), 0o600); err != nil {
		t.Fatal(err)
	}

	destination := filepath.Join(t.TempDir(), "MilkSU-diagnostics.zip")
	if _, err := ExportDiagnostics(
		context.Background(),
		root,
		destination,
		DiagnosticInput{
			Events: []DiagnosticEvent{{
				Category: "coding-engine",
				Level:    "error",
				Message:  "structured event token=structured-event-secret",
			}},
		},
	); err != nil {
		t.Fatal(err)
	}

	archive, err := zip.OpenReader(destination)
	if err != nil {
		t.Fatal(err)
	}
	defer archive.Close()
	if len(archive.File) != 1 || archive.File[0].Name != "diagnostics.json" {
		names := make([]string, 0, len(archive.File))
		for _, entry := range archive.File {
			names = append(names, entry.Name)
		}
		t.Fatalf("diagnostic archive copied unexpected files: %#v", names)
	}

	payload := readDiagnosticArchiveBytes(t, destination)
	for _, forbidden := range []string{
		"must-not-enter-diagnostics",
		"raw-tool-secret",
		"raw-bearer-secret",
		"structured-event-secret",
		"milksu.log",
	} {
		if strings.Contains(payload, forbidden) {
			t.Fatalf("diagnostic archive leaked %q: %s", forbidden, payload)
		}
	}
	if !strings.Contains(payload, "[REDACTED]") {
		t.Fatalf("structured diagnostic event was not redacted: %s", payload)
	}
}

func TestDiagnosticRecorderBoundsAndRedactsEntries(t *testing.T) {
	recorder := NewDiagnosticRecorder(2)
	recorder.Record("engine", "error", "first sk-secretcredentialvalue")
	recorder.Record("engine", "error", "second token=another-secret-value")
	recorder.Record("bridge", "warning", "third https://example.test/?api_key=query-secret-value")

	events := recorder.Snapshot()
	if len(events) != 2 {
		t.Fatalf("event count = %d, want 2: %#v", len(events), events)
	}
	if strings.Contains(events[0].Message, "another-secret-value") ||
		strings.Contains(events[1].Message, "query-secret-value") {
		t.Fatalf("recorder leaked secrets: %#v", events)
	}
	if !strings.Contains(events[0].Message, "[REDACTED]") ||
		!strings.Contains(events[1].Message, "[REDACTED]") {
		t.Fatalf("recorder did not preserve redaction markers: %#v", events)
	}

	snapshot := recorder.Snapshot()
	snapshot[0].Message = "mutated"
	if recorder.Snapshot()[0].Message == "mutated" {
		t.Fatal("recorder snapshot aliases internal storage")
	}
}

func TestDiagnosticRecorderRedactsProviderKeyShapes(t *testing.T) {
	recorder := NewDiagnosticRecorder(8)
	recorder.Record("engine", "error", "query https://provider.invalid/v1?key=synthetic-query-value")
	recorder.Record("engine", "error", "provider gsk_syntheticcredentialvalue")
	recorder.Record("engine", "error", "provider AIzaSyntheticCredentialValue")

	events := recorder.Snapshot()
	if len(events) != 3 {
		t.Fatalf("event count = %d, want 3: %#v", len(events), events)
	}
	for _, event := range events {
		if !strings.Contains(event.Message, "[REDACTED]") ||
			strings.Contains(event.Message, "synthetic") {
			t.Fatalf("provider credential shape was not redacted: %#v", event)
		}
	}
}

func TestExportDiagnosticsRejectsDestinationInsideDataRoot(t *testing.T) {
	root := t.TempDir()
	_, err := ExportDiagnostics(
		context.Background(),
		root,
		filepath.Join(root, "diagnostics.zip"),
		DiagnosticInput{},
	)
	if err == nil {
		t.Fatal("expected destination inside data root to be rejected")
	}
}

func readDiagnosticArchiveBytes(t *testing.T, path string) string {
	t.Helper()
	archive, err := zip.OpenReader(path)
	if err != nil {
		t.Fatal(err)
	}
	defer archive.Close()
	var builder strings.Builder
	for _, entry := range archive.File {
		reader, err := entry.Open()
		if err != nil {
			t.Fatal(err)
		}
		payload, err := io.ReadAll(reader)
		reader.Close()
		if err != nil {
			t.Fatal(err)
		}
		builder.Write(payload)
	}
	return builder.String()
}

func readDiagnosticReportForTest(t *testing.T, path string) DiagnosticReport {
	t.Helper()
	archive, err := zip.OpenReader(path)
	if err != nil {
		t.Fatal(err)
	}
	defer archive.Close()
	for _, entry := range archive.File {
		if entry.Name != "diagnostics.json" {
			continue
		}
		reader, err := entry.Open()
		if err != nil {
			t.Fatal(err)
		}
		payload, err := io.ReadAll(reader)
		reader.Close()
		if err != nil {
			t.Fatal(err)
		}
		var report DiagnosticReport
		if err := json.Unmarshal(payload, &report); err != nil {
			t.Fatal(err)
		}
		return report
	}
	t.Fatal("diagnostics.json is missing")
	return DiagnosticReport{}
}
