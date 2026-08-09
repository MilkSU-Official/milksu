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

	graph, err := application.GetSessionHistoryGraph(sessionindex.GraphRequest{
		Query:    "CVE-2024-3400",
		Module:   "cve",
		MaxNodes: 20,
		MaxEdges: 30,
	})
	if err != nil {
		t.Fatalf("GetSessionHistoryGraph() error = %v", err)
	}
	if len(graph.Nodes) == 0 {
		t.Fatalf("GetSessionHistoryGraph() returned no nodes: %#v", graph)
	}
	foundSource := false
	for _, node := range graph.Nodes {
		if strings.Contains(node.Detail, "sk-app-session-index-secret") || strings.Contains(node.Quote, "sk-app-session-index-secret") {
			t.Fatalf("history graph leaked credential: %#v", node)
		}
		for _, source := range node.Sources {
			if source.ConversationID == "cve-handoff" {
				foundSource = true
			}
		}
	}
	if !foundSource {
		t.Fatalf("history graph did not retain source conversation: %#v", graph.Nodes)
	}
}
