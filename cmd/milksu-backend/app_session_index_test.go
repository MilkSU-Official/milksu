package main

import (
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
	if _, err := application.refreshSessionIndex(); err != nil {
		t.Fatalf("refreshSessionIndex() error = %v", err)
	}
	status, err := application.sessionIndex.Status(application.commandContext())
	if err != nil {
		t.Fatalf("sessionIndex.Status() error = %v", err)
	}
	if !status.Available || status.SessionCount != 1 || status.MessageCount != 1 || status.ToolCallCount != 1 {
		t.Fatalf("unexpected session index status: %#v", status)
	}
	if !strings.HasPrefix(status.IndexPath, filepath.Join(dataDirectory, "session-index")) {
		t.Fatalf("session index escaped MilkSU data directory: %q", status.IndexPath)
	}

	response, err := application.sessionIndex.Search(application.commandContext(), sessionindex.SearchRequest{
		Query: "CVE-2024-3400",
		Limit: 3,
	})
	if err != nil {
		t.Fatalf("sessionIndex.Search() error = %v", err)
	}
	if len(response.Results) != 1 {
		t.Fatalf("sessionIndex.Search() returned %d results, want 1: %#v", len(response.Results), response.Results)
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

	graphContext, err := index.BuildGraphContext(application.commandContext(), sessionindex.GraphRequest{
		Query:  "CVE-2024-3400",
		Module: "cve",
	}, sessionindex.GraphInput{})
	if err != nil {
		t.Fatalf("BuildGraphContext() error = %v", err)
	}
	if len(graphContext.Seeds) == 0 {
		t.Fatalf("BuildGraphContext() returned no seeds: %#v", graphContext)
	}
	foundSource := false
	for _, seed := range graphContext.Seeds {
		if strings.Contains(seed.Excerpt, "sk-app-session-index-secret") {
			t.Fatalf("history graph context leaked credential: %#v", seed)
		}
		if seed.Source.ConversationID == "cve-handoff" {
			foundSource = true
		}
	}
	if !foundSource {
		t.Fatalf("history graph context did not retain source conversation: %#v", graphContext.Seeds)
	}
}
