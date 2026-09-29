package appdata

import (
	"archive/zip"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"strings"
	"syscall"
	"testing"
	"time"
)

func TestExportDiagnosticsReportsHealthWithoutCopyingSecrets(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "config"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(
		filepath.Join(root, "config", "settings.json"),
		[]byte(`{"api_key":"must-not-leak"}`),
		0o600,
	); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(
		filepath.Join(root, "config", "credentials.db"),
		[]byte("credential-payload-must-not-leak"),
		0o600,
	); err != nil {
		t.Fatal(err)
	}
	memoryPath := filepath.Join(root, "data", "domain", "ctf", "memory.sqlite3")
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
	// Windows ACLs do not expose Unix permission bits; the 0o600 hardening
	// contract is only assertable on Unix-like platforms.
	if runtime.GOOS != "windows" && info.Mode().Perm() != 0o600 {
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
		case "config/credentials.db":
			credentialHealth = &report.Databases[index]
		case "data/domain/ctf/memory.sqlite3":
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
	logPath := filepath.Join(root, "data", "runtime", "milksu.log")
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

func TestExportDiagnosticsMergesAndBoundsRendererEvents(t *testing.T) {
	root := t.TempDir()
	destination := filepath.Join(t.TempDir(), "MilkSU-diagnostics.zip")
	backendEvents := make([]DiagnosticEvent, 255)
	for index := range backendEvents {
		backendEvents[index] = DiagnosticEvent{
			Category: "runtime",
			Level:    "info",
			Message:  "backend-event",
		}
	}
	rendererEvents := []DiagnosticEvent{
		{
			Timestamp: "2026-09-27T15:04:05.000Z",
			Category:  "anything",
			Level:     "warning",
			Message:   "rpc method=get_settings",
		},
		{
			Timestamp: "2026-09-27T15:04:06.000Z",
			Category:  "anything",
			Level:     "warning",
			Message:   "catalog-search status=ok count=2 durationMs=10",
		},
		{
			Timestamp: "2026-09-27T15:04:07.000Z",
			Category:  "anything",
			Level:     "error",
			Message:   "catalog-search status=ok path=/home/user/session-body tool_output=secret",
		},
		{
			Timestamp: "2026-09-27T15:04:08.000Z",
			Category:  "anything",
			Level:     "error",
			Message:   "rpc method=get_settings api_key=renderer-secret Bearer renderer-bearer",
		},
	}

	exported, err := ExportDiagnostics(
		context.Background(),
		root,
		destination,
		DiagnosticInput{Events: backendEvents, RendererEvents: rendererEvents},
	)
	if err != nil {
		t.Fatal(err)
	}
	if exported.EventCount != 256 {
		t.Fatalf("event count = %d, want 256", exported.EventCount)
	}
	if runtime.GOOS != "windows" {
		info, err := os.Stat(destination)
		if err != nil {
			t.Fatal(err)
		}
		if info.Mode().Perm() != 0o600 {
			t.Fatalf("diagnostic archive permissions = %o, want 600", info.Mode().Perm())
		}
	}

	report := readDiagnosticReportForTest(t, destination)
	messages := make([]string, 0, len(report.RecentEvents))
	for _, event := range report.RecentEvents {
		messages = append(messages, event.Message)
	}
	payload := readDiagnosticArchiveBytes(t, destination)
	if !slices.Contains(messages, "rpc method=get_settings") ||
		!slices.Contains(messages, "catalog-search status=ok count=2 durationMs=10") {
		t.Fatalf("renderer events were not merged: %#v", report.RecentEvents[len(report.RecentEvents)-4:])
	}
	for _, forbidden := range []string{
		"/home/user/session-body",
		"tool_output=secret",
		"renderer-secret",
		"renderer-bearer",
	} {
		if strings.Contains(payload, forbidden) {
			t.Fatalf("renderer diagnostic leaked %q: %s", forbidden, payload)
		}
	}
}

func TestMergeDiagnosticEventsOrdersByTimestamp(t *testing.T) {
	backend := []DiagnosticEvent{
		{Timestamp: "2026-09-27T15:04:05.000Z", Message: "backend-early"},
		{Timestamp: "2026-09-27T15:04:09.000Z", Message: "backend-late"},
		{Timestamp: "", Message: "backend-no-timestamp"},
	}
	renderer := []DiagnosticEvent{
		{Timestamp: "2026-09-27T15:04:07.000Z", Message: "renderer-middle"},
		{Timestamp: "2026-09-27T15:04:11.000Z", Message: "renderer-last"},
	}

	merged := mergeDiagnosticEvents(backend, renderer)
	messages := make([]string, 0, len(merged))
	for _, event := range merged {
		messages = append(messages, event.Message)
	}
	want := []string{
		"backend-no-timestamp",
		"backend-early",
		"renderer-middle",
		"backend-late",
		"renderer-last",
	}
	if !slices.Equal(messages, want) {
		t.Fatalf("merged order = %#v, want %#v", messages, want)
	}
	if backend[0].Message != "backend-early" || backend[2].Message != "backend-no-timestamp" {
		t.Fatal("mergeDiagnosticEvents mutated backend input")
	}
}

func TestExportDiagnosticsTruncationKeepsRecentEventsAcrossSources(t *testing.T) {
	root := t.TempDir()
	destination := filepath.Join(t.TempDir(), "MilkSU-diagnostics.zip")
	rendererBase := time.Date(2026, 9, 27, 15, 4, 5, 0, time.UTC)
	rendererEvents := make([]DiagnosticEvent, 0, 200)
	for index := 0; index < 200; index++ {
		rendererEvents = append(rendererEvents, DiagnosticEvent{
			Timestamp: rendererBase.Add(time.Duration(index) * time.Second).Format(time.RFC3339Nano),
			Message:   "rpc method=get_settings",
		})
	}
	backendBase := time.Date(2026, 9, 28, 0, 0, 0, 0, time.UTC)
	backendEvents := make([]DiagnosticEvent, 0, 100)
	for index := 0; index < 100; index++ {
		backendEvents = append(backendEvents, DiagnosticEvent{
			Timestamp: backendBase.Add(time.Duration(index) * time.Second).Format(time.RFC3339Nano),
			Category:  "runtime",
			Level:     "info",
			Message:   fmt.Sprintf("backend-event-%d", index),
		})
	}

	exported, err := ExportDiagnostics(
		context.Background(),
		root,
		destination,
		DiagnosticInput{Events: backendEvents, RendererEvents: rendererEvents},
	)
	if err != nil {
		t.Fatal(err)
	}
	if exported.EventCount != 256 {
		t.Fatalf("event count = %d, want 256", exported.EventCount)
	}

	report := readDiagnosticReportForTest(t, destination)
	messages := make([]string, 0, len(report.RecentEvents))
	for _, event := range report.RecentEvents {
		messages = append(messages, event.Message)
	}
	if !slices.Contains(messages, "backend-event-0") || !slices.Contains(messages, "backend-event-99") {
		t.Fatalf("timestamp merge squeezed out newer backend events: %#v", messages[:8])
	}
	rendererKept := 0
	for _, message := range messages {
		if message == "rpc method=get_settings" {
			rendererKept++
		}
	}
	if rendererKept != 156 {
		t.Fatalf("kept renderer events = %d, want 156 after truncating the 44 oldest", rendererKept)
	}
}

func TestExportDiagnosticsInjectsIOFailuresWithoutLeavingArtifacts(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*diagnosticIO)
		want   string
	}{
		{
			name: "destination permission",
			mutate: func(ops *diagnosticIO) {
				ops.mkdirAll = func(string, os.FileMode) error { return os.ErrPermission }
			},
			want: "create diagnostic destination",
		},
		{
			name: "disk full",
			mutate: func(ops *diagnosticIO) {
				ops.sync = func(*os.File) error { return syscall.ENOSPC }
			},
			want: "sync diagnostic archive",
		},
		{
			name: "rename failure",
			mutate: func(ops *diagnosticIO) {
				ops.rename = func(string, string) error { return syscall.EXDEV }
			},
			want: "install diagnostic archive",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			root := t.TempDir()
			destinationDirectory := t.TempDir()
			destination := filepath.Join(destinationDirectory, "diagnostics.zip")
			ops := systemDiagnosticIO()
			tt.mutate(&ops)

			_, err := exportDiagnostics(context.Background(), root, destination, DiagnosticInput{}, ops)
			if err == nil || !strings.Contains(err.Error(), tt.want) {
				t.Fatalf("error = %v, want %q", err, tt.want)
			}
			if _, err := os.Stat(destination); !os.IsNotExist(err) {
				t.Fatalf("destination exists after failed export: %v", err)
			}
			entries, err := os.ReadDir(destinationDirectory)
			if err != nil {
				t.Fatal(err)
			}
			if len(entries) != 0 {
				t.Fatalf("temporary archive was not cleaned up: %#v", entries)
			}
		})
	}
}

func TestExportDiagnosticsConcurrentArchivesAreIndependent(t *testing.T) {
	root := t.TempDir()
	const exports = 12
	type result struct {
		path  string
		event string
		err   error
	}
	results := make(chan result, exports)
	for index := 0; index < exports; index++ {
		index := index
		go func() {
			destination := filepath.Join(t.TempDir(), "diagnostics.zip")
			event := fmt.Sprintf("concurrent-event-%d", index)
			exported, err := ExportDiagnostics(context.Background(), root, destination, DiagnosticInput{
				Events: []DiagnosticEvent{{Category: "test", Level: "info", Message: event}},
			})
			if err == nil && exported.Path != destination {
				err = fmt.Errorf("path = %q, want %q", exported.Path, destination)
			}
			results <- result{path: destination, event: event, err: err}
		}()
	}

	for index := 0; index < exports; index++ {
		item := <-results
		if item.err != nil {
			t.Fatal(item.err)
		}
		report := readDiagnosticReportForTest(t, item.path)
		if len(report.RecentEvents) != 1 || report.RecentEvents[0].Message != item.event {
			t.Fatalf("archive %q contains %#v, want %q", item.path, report.RecentEvents, item.event)
		}
	}
}

func TestExportDiagnosticsArchiveIsReadableAcrossPlatforms(t *testing.T) {
	root := t.TempDir()
	destination := filepath.Join(t.TempDir(), "diagnostics.zip")
	if _, err := ExportDiagnostics(context.Background(), root, destination, DiagnosticInput{
		Events: []DiagnosticEvent{{Category: "portable", Level: "info", Message: "archive-readable"}},
	}); err != nil {
		t.Fatal(err)
	}

	archive, err := zip.OpenReader(destination)
	if err != nil {
		t.Fatal(err)
	}
	defer archive.Close()
	if len(archive.File) != 1 || archive.File[0].Name != "diagnostics.json" {
		t.Fatalf("archive entries = %#v", archive.File)
	}
	if mode := archive.File[0].Mode().Perm(); mode != 0o600 {
		t.Fatalf("diagnostics.json mode = %o, want 600", mode)
	}
	reader, err := archive.File[0].Open()
	if err != nil {
		t.Fatal(err)
	}
	var report DiagnosticReport
	if err := json.NewDecoder(reader).Decode(&report); err != nil {
		reader.Close()
		t.Fatal(err)
	}
	if err := reader.Close(); err != nil {
		t.Fatal(err)
	}
	if report.Schema != DiagnosticsSchema || report.RecentEvents[0].Message != "archive-readable" {
		t.Fatalf("unexpected report: %#v", report)
	}
	if runtime.GOOS != "windows" {
		info, err := os.Stat(destination)
		if err != nil {
			t.Fatal(err)
		}
		if info.Mode().Perm() != 0o600 {
			t.Fatalf("archive mode = %o, want 600", info.Mode().Perm())
		}
	}
}

func TestExportDiagnosticsRejectsActualReadOnlyDestinationDirectory(t *testing.T) {
	if runtime.GOOS == "windows" || os.Geteuid() == 0 {
		t.Skip("requires non-root Unix permissions")
	}
	root := t.TempDir()
	destinationDirectory := t.TempDir()
	if err := os.Chmod(destinationDirectory, 0o500); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(destinationDirectory, 0o700) })

	_, err := ExportDiagnostics(
		context.Background(),
		root,
		filepath.Join(destinationDirectory, "diagnostics.zip"),
		DiagnosticInput{},
	)
	if err == nil {
		t.Fatal("expected a read-only destination directory to fail")
	}
}
