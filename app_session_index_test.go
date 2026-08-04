package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/MilkSU-Official/milksu/internal/appdata"
	"github.com/MilkSU-Official/milksu/internal/conversation"
	"github.com/MilkSU-Official/milksu/internal/sessionindex"
)

func TestAppSessionIndexRefreshesMilkSUOwnedHistory(t *testing.T) {
	root := filepath.Join(t.TempDir(), "appdata")
	t.Setenv(appdata.DirectoryOverrideEnv, root)
	dataDirectory, err := appdata.Ensure()
	if err != nil {
		t.Fatalf("Ensure() error = %v", err)
	}
	conversations, err := conversation.NewStore()
	if err != nil {
		t.Fatalf("conversation.NewStore() error = %v", err)
	}
	index, err := sessionindex.NewStore(filepath.Join(dataDirectory, "session-index", "obelisk.sqlite"))
	if err != nil {
		t.Fatalf("sessionindex.NewStore() error = %v", err)
	}
	toolName := "fetch_nvd_cve"
	if err := conversations.Save(conversation.StoredConversation{
		ID:            "cve-handoff",
		Title:         "CVE-2024-3400 Coding 接力",
		CreatedAt:     uint64(time.Date(2026, 8, 4, 9, 0, 0, 0, time.UTC).UnixMilli()),
		WorkspacePath: "/Users/milksu/code/milksu",
		ModelID:       "gpt-5",
		Messages: []conversation.StoredMessage{{
			ID:        "assistant-1",
			Role:      "assistant",
			Content:   "NVD CVE-2024-3400 已同步；OPENAI_API_KEY=sk-app-session-index-secret12345",
			Timestamp: uint64(time.Date(2026, 8, 4, 9, 10, 0, 0, time.UTC).UnixMilli()),
			ToolName:  &toolName,
		}},
	}); err != nil {
		t.Fatalf("save conversation: %v", err)
	}

	application := &App{
		dataDirectory: dataDirectory,
		conversations: conversations,
		sessionIndex:  index,
	}
	status, err := application.GetSessionIndexStatus()
	if err != nil {
		t.Fatalf("GetSessionIndexStatus() error = %v", err)
	}
	if !status.Available || status.SessionCount != 1 || status.MessageCount != 1 || status.ToolCallCount != 1 {
		t.Fatalf("unexpected session index status: %#v", status)
	}
	if !strings.HasPrefix(status.IndexPath, filepath.Join(dataDirectory, "session-index")) {
		t.Fatalf("session index escaped MilkSU data directory: %q", status.IndexPath)
	}

	response, err := application.SearchSessionHistory(sessionindex.SearchRequest{
		Query: "CVE-2024-3400",
		Limit: 3,
	})
	if err != nil {
		t.Fatalf("SearchSessionHistory() error = %v", err)
	}
	if len(response.Results) != 1 {
		t.Fatalf("SearchSessionHistory() returned %d results, want 1: %#v", len(response.Results), response.Results)
	}
	result := response.Results[0]
	if result.Source != "milksu-cve" || result.SessionName != "CVE-2024-3400 Coding 接力" {
		t.Fatalf("unexpected result metadata: %#v", result)
	}
	if strings.Contains(result.Snippet, "sk-app-session-index-secret") {
		t.Fatalf("search result leaked credential: %q", result.Snippet)
	}
	if !strings.Contains(result.Snippet, "CVE-2024-3400") || !strings.Contains(result.Snippet, "[credential redacted]") {
		t.Fatalf("unexpected search snippet: %q", result.Snippet)
	}
}

func TestAppImportsExternalSessionHistoryFromExplicitPath(t *testing.T) {
	root := filepath.Join(t.TempDir(), "appdata")
	t.Setenv(appdata.DirectoryOverrideEnv, root)
	dataDirectory, err := appdata.Ensure()
	if err != nil {
		t.Fatalf("Ensure() error = %v", err)
	}
	conversations, err := conversation.NewStore()
	if err != nil {
		t.Fatalf("conversation.NewStore() error = %v", err)
	}
	index, err := sessionindex.NewStore(filepath.Join(dataDirectory, "session-index", "obelisk.sqlite"))
	if err != nil {
		t.Fatalf("sessionindex.NewStore() error = %v", err)
	}
	historyPath := filepath.Join(t.TempDir(), "claude-history.jsonl")
	if err := os.WriteFile(historyPath, []byte(`{"sessionId":"claude-a","title":"Claude handoff","timestamp":"2026-08-05T02:00:00Z","message":{"role":"assistant","content":[{"type":"text","text":"Claude remembered CVE-2023-46604 Vulhub practice; OPENAI_API_KEY=sk-app-import-secret12345"}]}}`+"\n"), 0o600); err != nil {
		t.Fatalf("write external history: %v", err)
	}

	application := &App{
		dataDirectory: dataDirectory,
		conversations: conversations,
		sessionIndex:  index,
	}
	result, err := application.ImportExternalSessionHistory(sessionindex.ExternalImportRequest{
		Source:      "claude",
		Path:        historyPath,
		Project:     "milksu",
		ProjectPath: "/Users/milksu/code/milksu",
	})
	if err != nil {
		t.Fatalf("ImportExternalSessionHistory() error = %v", err)
	}
	if result.SessionCount != 1 || result.MessageCount != 1 {
		t.Fatalf("unexpected import result: %#v", result)
	}
	if !strings.HasPrefix(result.IndexPath, filepath.Join(dataDirectory, "session-index")) {
		t.Fatalf("session index escaped MilkSU data directory: %q", result.IndexPath)
	}

	response, err := application.SearchSessionHistory(sessionindex.SearchRequest{
		Query:  "Vulhub practice",
		Source: "claude",
		Limit:  3,
	})
	if err != nil {
		t.Fatalf("SearchSessionHistory() error = %v", err)
	}
	if len(response.Results) != 1 {
		t.Fatalf("SearchSessionHistory() returned %d results, want 1: %#v", len(response.Results), response.Results)
	}
	if strings.Contains(response.Results[0].Snippet, "sk-app-import-secret") {
		t.Fatalf("imported external history leaked credential: %q", response.Results[0].Snippet)
	}
}

func TestSessionIndexPackagedSmokeRunsAppSearch(t *testing.T) {
	root := filepath.Join(t.TempDir(), "appdata")
	t.Setenv(appdata.DirectoryOverrideEnv, root)
	t.Setenv(sessionIndexSmokeQueryEnv, "SessionIndexPackagedSmoke")
	reportPath := filepath.Join(t.TempDir(), "session-index-smoke.json")
	t.Setenv(sessionIndexSmokeResultEnv, reportPath)
	dataDirectory, err := appdata.Ensure()
	if err != nil {
		t.Fatalf("Ensure() error = %v", err)
	}
	conversations, err := conversation.NewStore()
	if err != nil {
		t.Fatalf("conversation.NewStore() error = %v", err)
	}
	index, err := sessionindex.NewStore(filepath.Join(dataDirectory, "session-index", "obelisk.sqlite"))
	if err != nil {
		t.Fatalf("sessionindex.NewStore() error = %v", err)
	}
	toolName := "packaged_session_index_smoke"
	if err := conversations.Save(conversation.StoredConversation{
		ID:            "session-index-smoke",
		Title:         "Session Index packaged smoke",
		CreatedAt:     uint64(time.Date(2026, 8, 5, 0, 0, 0, 0, time.UTC).UnixMilli()),
		WorkspacePath: "/Users/milksu/code/milksu",
		ModelID:       "packaged-smoke",
		Messages: []conversation.StoredMessage{{
			ID:        "tool-1",
			Role:      "tool",
			Content:   "SessionIndexPackagedSmoke completed with OPENAI_API_KEY=package-smoke-session-index-secret-never-log",
			Timestamp: uint64(time.Date(2026, 8, 5, 0, 0, 2, 0, time.UTC).UnixMilli()),
			ToolName:  &toolName,
		}},
	}); err != nil {
		t.Fatalf("save conversation: %v", err)
	}

	application := &App{
		dataDirectory: dataDirectory,
		diagnostics:   appdata.NewDiagnosticRecorder(32),
		conversations: conversations,
		sessionIndex:  index,
	}
	application.maybeRunSessionIndexSmoke()

	payload, err := os.ReadFile(reportPath)
	if err != nil {
		t.Fatalf("read smoke report: %v", err)
	}
	if strings.Contains(string(payload), "package-smoke-session-index-secret-never-log") {
		t.Fatalf("smoke report leaked the fixture secret: %s", payload)
	}
	var report sessionIndexSmokeReport
	if err := json.Unmarshal(payload, &report); err != nil {
		t.Fatalf("decode smoke report: %v", err)
	}
	if report.Schema != "milksu-session-index-packaged-smoke/v1" || report.Error != "" {
		t.Fatalf("unexpected smoke report: %#v", report)
	}
	if report.ResultCount != 1 || report.FirstResult == nil || report.FirstResult.Source != "milksu-coding" {
		t.Fatalf("smoke report did not include the Coding search result: %#v", report)
	}
	if !strings.Contains(report.FirstResult.Snippet, "SessionIndexPackagedSmoke") ||
		!strings.Contains(report.FirstResult.Snippet, "[credential redacted]") {
		t.Fatalf("unexpected smoke snippet: %q", report.FirstResult.Snippet)
	}
	info, err := os.Stat(reportPath)
	if err != nil {
		t.Fatalf("stat smoke report: %v", err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("smoke report mode = %o, want 0600", info.Mode().Perm())
	}
}

func TestExternalSessionHistoryImportPackagedSmokeRunsImportAndSearch(t *testing.T) {
	root := filepath.Join(t.TempDir(), "appdata")
	t.Setenv(appdata.DirectoryOverrideEnv, root)
	dataDirectory, err := appdata.Ensure()
	if err != nil {
		t.Fatalf("Ensure() error = %v", err)
	}
	historyPath := filepath.Join(t.TempDir(), "codex-history.jsonl")
	if err := os.WriteFile(historyPath, []byte(`{"session_id":"codex-smoke","timestamp":"2026-08-05T03:00:00Z","role":"assistant","content":"ExternalHistoryPackagedSmoke imported from Codex with OPENAI_API_KEY=sk-import-smoke-secret12345"}`+"\n"), 0o600); err != nil {
		t.Fatalf("write external history: %v", err)
	}
	reportPath := filepath.Join(t.TempDir(), "session-history-import-smoke.json")
	t.Setenv(sessionHistoryImportSmokeResultEnv, reportPath)
	t.Setenv(sessionHistoryImportSmokePathEnv, historyPath)
	t.Setenv(sessionHistoryImportSmokeSourceEnv, "codex")
	t.Setenv(sessionHistoryImportSmokeQueryEnv, "ExternalHistoryPackagedSmoke")
	index, err := sessionindex.NewStore(filepath.Join(dataDirectory, "session-index", "obelisk.sqlite"))
	if err != nil {
		t.Fatalf("sessionindex.NewStore() error = %v", err)
	}
	conversations, err := conversation.NewStore()
	if err != nil {
		t.Fatalf("conversation.NewStore() error = %v", err)
	}
	application := &App{
		dataDirectory: dataDirectory,
		conversations: conversations,
		sessionIndex:  index,
	}

	application.maybeRunExternalSessionImportSmoke()

	data, err := os.ReadFile(reportPath)
	if err != nil {
		t.Fatalf("read external import smoke report: %v", err)
	}
	var report sessionHistoryImportSmokeReport
	if err := json.Unmarshal(data, &report); err != nil {
		t.Fatalf("decode external import smoke report: %v", err)
	}
	if report.Schema != "milksu-session-history-import-packaged-smoke/v1" || report.Error != "" {
		t.Fatalf("unexpected external import smoke report: %#v", report)
	}
	if report.Import.Source != "codex" || report.Import.SessionCount != 1 || report.Import.MessageCount != 1 {
		t.Fatalf("unexpected external import counts: %#v", report.Import)
	}
	if report.ResultCount != 1 || report.FirstResult == nil {
		t.Fatalf("external import smoke did not return search result: %#v", report)
	}
	if report.FirstResult.Source != "codex" || !strings.Contains(report.FirstResult.Snippet, "ExternalHistoryPackagedSmoke") {
		t.Fatalf("unexpected external import search result: %#v", report.FirstResult)
	}
	serialized := string(data)
	if strings.Contains(serialized, "sk-import-smoke-secret") {
		t.Fatalf("external import smoke report leaked credential: %s", serialized)
	}
}
