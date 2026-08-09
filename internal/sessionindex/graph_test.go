package sessionindex

import (
	"context"
	"database/sql"
	"fmt"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/MilkSU-Official/milksu/internal/conversation"
)

func TestGraphProjectsDeterministicRelationsWithoutPersistingGraphState(t *testing.T) {
	path := filepath.Join(t.TempDir(), "session-index", "obelisk.sqlite")
	store, err := NewStore(path)
	if err != nil {
		t.Fatalf("NewStore() error = %v", err)
	}
	store.Now = fixedNow
	toolName := "browser_snapshot"
	conversations := []conversation.StoredConversation{{
		ID:            "coding-graph",
		Title:         "History graph implementation",
		CreatedAt:     uint64(time.Date(2026, 8, 4, 9, 0, 0, 0, time.UTC).UnixMilli()),
		WorkspacePath: "/Users/example/code/milksu",
		ModelID:       "grok-4.5",
		AgentSkills:   []string{"frontend-visual-qa"},
		AgentGoal: &conversation.StoredGoal{
			ID:        "goal-1",
			Text:      "完成关系图；OPENAI_API_KEY=sk-graph-goal-secret12345",
			Status:    "active",
			StartedAt: time.Date(2026, 8, 4, 9, 1, 0, 0, time.UTC).UnixMilli(),
			UpdatedAt: time.Date(2026, 8, 4, 9, 2, 0, 0, time.UTC).UnixMilli(),
		},
		Messages: []conversation.StoredMessage{{
			ID:        "user-1",
			Role:      "user",
			Content:   "关联 CVE-2024-3400，并查看附件。",
			Timestamp: uint64(time.Date(2026, 8, 4, 9, 3, 0, 0, time.UTC).UnixMilli()),
			Attachments: []conversation.StoredAttachment{{
				ID:        strings.Repeat("a", 64),
				SHA256:    strings.Repeat("a", 64),
				Name:      "history-map.png",
				MediaType: "image/png",
				Size:      128,
			}},
		}, {
			ID:        "tool-1",
			Role:      "tool",
			Content:   "snapshot complete; Bearer graph-tool-secret12345",
			Timestamp: uint64(time.Date(2026, 8, 4, 9, 4, 0, 0, time.UTC).UnixMilli()),
			ToolName:  &toolName,
		}},
	}, {
		ID:            "ctf-graph",
		Title:         "NSSCTF graph challenge",
		CreatedAt:     uint64(time.Date(2026, 8, 3, 9, 0, 0, 0, time.UTC).UnixMilli()),
		WorkspacePath: "/Users/example/code/milksu",
		CTFJobID:      "ctf-job-1",
		Messages: []conversation.StoredMessage{{
			ID:        "assistant-1",
			Role:      "assistant",
			Content:   "保留 Judge 回执。",
			Timestamp: uint64(time.Date(2026, 8, 3, 9, 10, 0, 0, time.UTC).UnixMilli()),
		}},
	}}
	if _, err := store.RefreshMilkSUConversations(context.Background(), conversations); err != nil {
		t.Fatalf("RefreshMilkSUConversations() error = %v", err)
	}

	response, err := store.Graph(context.Background(), GraphRequest{}, GraphInput{
		Conversations: conversations,
		Archives: []GraphArchive{{
			ID:        "ctf-job-1",
			Module:    "ctf",
			Title:     "NSSCTF graph challenge",
			Timestamp: "2026-08-03T10:00:00Z",
			Evidence: []GraphArchiveEvidence{{
				ID:          "evidence-1",
				Claim:       "Judge accepted the candidate",
				Provenance:  "runtime judge receipt",
				ArtifactIDs: []string{"artifact-1"},
			}},
			Artifacts: []GraphArchiveArtifact{{
				ID:           "artifact-1",
				Source:       "judge",
				MediaType:    "application/json",
				RelativePath: "judge/receipt.json",
				Size:         256,
			}},
		}, {
			ID:        "vuln-job-1",
			Module:    "cve",
			Title:     "CVE-2024-3400 tracking",
			Timestamp: "2026-08-04T08:00:00Z",
		}},
	})
	if err != nil {
		t.Fatalf("Graph() error = %v", err)
	}
	if response.Truncated {
		t.Fatalf("Graph().Truncated = true for small fixture")
	}
	if len(response.Projects) != 1 || response.Projects[0] != "milksu" {
		t.Fatalf("unexpected projects: %#v", response.Projects)
	}
	types := map[string]int{}
	for _, node := range response.Nodes {
		types[node.Type]++
		joined := node.Label + " " + node.Detail + " " + node.Quote
		for _, source := range node.Sources {
			joined += " " + source.SessionName
		}
		if strings.Contains(joined, "sk-graph-goal-secret") || strings.Contains(joined, "graph-tool-secret") {
			t.Fatalf("graph node leaked credential: %#v", node)
		}
	}
	for _, nodeType := range []string{"project", "session", "goal", "ctf", "cve", "model", "tool", "skill", "evidence", "artifact"} {
		if types[nodeType] == 0 {
			t.Fatalf("graph missing %s node: %#v", nodeType, types)
		}
	}
	if types["message"] != 0 {
		t.Fatalf("ordinary messages must not become graph nodes")
	}
	allowedEdges := map[string]bool{
		"contains": true, "uses": true, "calls": true, "loads": true,
		"focuses": true, "mentions": true, "derived-from": true,
	}
	nodeIDs := map[string]bool{}
	for _, node := range response.Nodes {
		nodeIDs[node.ID] = true
	}
	for _, edge := range response.Edges {
		if !allowedEdges[edge.Type] || !nodeIDs[edge.Source] || !nodeIDs[edge.Target] {
			t.Fatalf("invalid graph edge: %#v", edge)
		}
	}
	if !graphHasConversationSource(response.Nodes, "coding-graph") {
		t.Fatalf("graph nodes do not retain the source conversation")
	}

	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatalf("open graph database: %v", err)
	}
	defer db.Close()
	for _, table := range []string{"graph_nodes", "graph_edges", "entities", "relationships"} {
		var count int
		if err := db.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?`, table).Scan(&count); err != nil {
			t.Fatalf("inspect graph persistence: %v", err)
		}
		if count != 0 {
			t.Fatalf("Graph() persisted forbidden table %q", table)
		}
	}
}

func TestGraphAndSearchApplyModuleProjectTimeFilters(t *testing.T) {
	path := filepath.Join(t.TempDir(), "obelisk.sqlite")
	store, err := NewStore(path)
	if err != nil {
		t.Fatalf("NewStore() error = %v", err)
	}
	store.Now = fixedNow
	values := []conversation.StoredConversation{{
		ID:            "old-coding",
		Title:         "Old browser task",
		CreatedAt:     uint64(time.Date(2026, 7, 1, 9, 0, 0, 0, time.UTC).UnixMilli()),
		WorkspacePath: "/workspace/old-project",
		Messages: []conversation.StoredMessage{{
			ID: "m1", Role: "assistant", Content: "Browser task", Timestamp: uint64(time.Date(2026, 7, 1, 9, 5, 0, 0, time.UTC).UnixMilli()),
		}},
	}, {
		ID:            "new-cve",
		Title:         "CVE-2026-12345 browser task",
		CreatedAt:     uint64(time.Date(2026, 8, 4, 9, 0, 0, 0, time.UTC).UnixMilli()),
		WorkspacePath: "/workspace/current-project",
		Messages: []conversation.StoredMessage{{
			ID: "m2", Role: "assistant", Content: "Browser task for CVE-2026-12345", Timestamp: uint64(time.Date(2026, 8, 4, 9, 5, 0, 0, time.UTC).UnixMilli()),
		}},
	}, {
		ID:            "long-cve",
		Title:         "CVE-2026-23456 long-running browser task",
		CreatedAt:     uint64(time.Date(2026, 7, 1, 9, 0, 0, 0, time.UTC).UnixMilli()),
		WorkspacePath: "/workspace/current-project",
		Messages: []conversation.StoredMessage{{
			ID: "m3", Role: "assistant", Content: "Browser task resumed for CVE-2026-23456", Timestamp: uint64(time.Date(2026, 8, 5, 9, 5, 0, 0, time.UTC).UnixMilli()),
		}},
	}}
	if _, err := store.RefreshMilkSUConversations(context.Background(), values); err != nil {
		t.Fatalf("RefreshMilkSUConversations() error = %v", err)
	}
	request := GraphRequest{
		Query:   "Browser task",
		Module:  "cve",
		Project: "current-project",
		Since:   "2026-08-01T00:00:00Z",
	}
	graph, err := store.Graph(context.Background(), request, GraphInput{Conversations: values})
	if err != nil {
		t.Fatalf("Graph() error = %v", err)
	}
	for _, node := range graph.Nodes {
		for _, source := range node.Sources {
			if source.ConversationID == "old-coding" {
				t.Fatalf("graph filter retained old Coding source: %#v", node)
			}
		}
	}
	if !graphHasConversationSource(graph.Nodes, "new-cve") {
		t.Fatalf("graph filter lost matching CVE session")
	}
	if !graphHasConversationSource(graph.Nodes, "long-cve") {
		t.Fatalf("graph time filter ignored a recent message in a long-running session")
	}

	search, err := store.Search(context.Background(), SearchRequest{
		Query:   "Browser task",
		Module:  "cve",
		Project: "current-project",
		Since:   "2026-08-01T00:00:00Z",
	})
	if err != nil {
		t.Fatalf("Search() error = %v", err)
	}
	if len(search.Results) != 2 {
		t.Fatalf("list/graph filters diverged: %#v", search.Results)
	}
}

func TestGraphBoundsNodesAndReflectsRefreshDeletion(t *testing.T) {
	path := filepath.Join(t.TempDir(), "obelisk.sqlite")
	store, err := NewStore(path)
	if err != nil {
		t.Fatalf("NewStore() error = %v", err)
	}
	store.Now = fixedNow
	values := make([]conversation.StoredConversation, 0, 8)
	for index := 0; index < 8; index++ {
		values = append(values, conversation.StoredConversation{
			ID:            fmt.Sprintf("session-%d", index),
			Title:         fmt.Sprintf("Session %d", index),
			CreatedAt:     uint64(time.Date(2026, 8, 4, 9, index, 0, 0, time.UTC).UnixMilli()),
			WorkspacePath: fmt.Sprintf("/workspace/project-%d", index),
			ModelID:       fmt.Sprintf("model-%d", index),
			Messages: []conversation.StoredMessage{{
				ID: "message", Role: "assistant", Content: "bounded graph", Timestamp: uint64(time.Date(2026, 8, 4, 9, index, 0, 0, time.UTC).UnixMilli()),
			}},
		})
	}
	if _, err := store.RefreshMilkSUConversations(context.Background(), values); err != nil {
		t.Fatalf("RefreshMilkSUConversations() error = %v", err)
	}
	bounded, err := store.Graph(context.Background(), GraphRequest{MaxNodes: 5, MaxEdges: 5}, GraphInput{Conversations: values})
	if err != nil {
		t.Fatalf("Graph() error = %v", err)
	}
	if !bounded.Truncated || len(bounded.Nodes) > 5 || len(bounded.Edges) > 5 {
		t.Fatalf("graph limits not enforced: nodes=%d edges=%d truncated=%t", len(bounded.Nodes), len(bounded.Edges), bounded.Truncated)
	}

	if _, err := store.RefreshMilkSUConversations(context.Background(), nil); err != nil {
		t.Fatalf("empty refresh error = %v", err)
	}
	empty, err := store.Graph(context.Background(), GraphRequest{}, GraphInput{})
	if err != nil {
		t.Fatalf("empty Graph() error = %v", err)
	}
	if len(empty.Nodes) != 0 || len(empty.Edges) != 0 {
		t.Fatalf("graph retained deleted sessions: %#v", empty)
	}
}

func graphHasConversationSource(nodes []GraphNode, conversationID string) bool {
	for _, node := range nodes {
		for _, source := range node.Sources {
			if source.ConversationID == conversationID {
				return true
			}
		}
	}
	return false
}
