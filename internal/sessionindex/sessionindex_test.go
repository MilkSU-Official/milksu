package sessionindex

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/MilkSU-Official/milksu/internal/conversation"
	_ "modernc.org/sqlite"
)

func TestStoreInitializesMilkSUOwnedObeliskSchema(t *testing.T) {
	path := filepath.Join(t.TempDir(), "session-index", "obelisk.sqlite")
	store, err := NewStore(path)
	if err != nil {
		t.Fatalf("NewStore() error = %v", err)
	}
	store.Now = fixedNow

	status, err := store.Status(context.Background())
	if err != nil {
		t.Fatalf("Status() error = %v", err)
	}
	if !status.Available {
		t.Fatalf("Status().Available = false, reason = %q", status.Reason)
	}
	if status.Mode != "milksu-obelisk-core" || !status.ReadOnly {
		t.Fatalf("unexpected mode/readOnly: %#v", status)
	}
	if status.IndexPath != path {
		t.Fatalf("Status().IndexPath = %q, want %q", status.IndexPath, path)
	}
	if status.CheckedAt != fixedNow().UTC().Format(time.RFC3339Nano) {
		t.Fatalf("unexpected checkedAt: %s", status.CheckedAt)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat session index: %v", err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("session index mode = %o, want 0600", info.Mode().Perm())
	}
}

func TestRefreshMilkSUConversationsIndexesSessionsToolsAndRedactsSecrets(t *testing.T) {
	path := filepath.Join(t.TempDir(), "session-index", "obelisk.sqlite")
	store, err := NewStore(path)
	if err != nil {
		t.Fatalf("NewStore() error = %v", err)
	}
	store.Now = fixedNow
	duration := int64(1234)
	toolName := "computer_use.click"
	toolCallID := "tool-call-1"
	approvalInput := `{"text":"Bearer approval-token-secret123"}`
	result, err := store.RefreshMilkSUConversations(context.Background(), []conversation.StoredConversation{{
		ID:            "coding-1",
		Title:         "Computer Use validation",
		CreatedAt:     uint64(time.Date(2026, 8, 4, 9, 0, 0, 0, time.UTC).UnixMilli()),
		WorkspacePath: "/Users/milksu/code/milksu",
		ModelID:       "gpt-5",
		Messages: []conversation.StoredMessage{{
			ID:        "user-1",
			Role:      "user",
			Content:   "请验证 Computer Use 外部 App 点击",
			Timestamp: uint64(time.Date(2026, 8, 4, 9, 1, 0, 0, time.UTC).UnixMilli()),
		}, {
			ID:            "tool-1",
			Role:          "tool",
			Content:       "clicked OK; OPENAI_API_KEY=sk-session-index-secret12345",
			Timestamp:     uint64(time.Date(2026, 8, 4, 9, 2, 0, 0, time.UTC).UnixMilli()),
			ToolName:      &toolName,
			ToolCallID:    &toolCallID,
			DurationMS:    &duration,
			ApprovalInput: &approvalInput,
		}},
	}, {
		ID:            "ctf-1",
		Title:         "NSSCTF P3879",
		CreatedAt:     uint64(time.Date(2026, 8, 4, 8, 0, 0, 0, time.UTC).UnixMilli()),
		WorkspacePath: "/Users/milksu/code/milksu",
		CTFJobID:      "job-1",
		Messages: []conversation.StoredMessage{{
			ID:        "assistant-1",
			Role:      "assistant",
			Content:   "Judge 返回 correct=true",
			Timestamp: uint64(time.Date(2026, 8, 4, 8, 30, 0, 0, time.UTC).UnixMilli()),
		}},
	}, {
		ID:            "cve-1",
		Title:         "CVE-2024-3400 接力",
		CreatedAt:     uint64(time.Date(2026, 8, 4, 7, 0, 0, 0, time.UTC).UnixMilli()),
		WorkspacePath: "/Users/milksu/code/milksu",
		Messages: []conversation.StoredMessage{{
			ID:        "assistant-1",
			Role:      "assistant",
			Content:   "NVD CVE-2024-3400 同步完成；Bearer cve-secret-token12345",
			Timestamp: uint64(time.Date(2026, 8, 4, 7, 20, 0, 0, time.UTC).UnixMilli()),
		}},
	}})
	if err != nil {
		t.Fatalf("RefreshMilkSUConversations() error = %v", err)
	}
	if result.SessionCount != 3 || result.MessageCount != 4 || result.ToolCallCount != 1 {
		t.Fatalf("unexpected refresh result: %#v", result)
	}

	status, err := store.Status(context.Background())
	if err != nil {
		t.Fatalf("Status() after refresh error = %v", err)
	}
	if status.SessionCount != 3 || status.MessageCount != 4 || status.ToolCallCount != 1 {
		t.Fatalf("unexpected status counts: %#v", status)
	}
	if sources := sourceMap(status.Sources); sources["milksu-coding"] != 1 || sources["milksu-ctf"] != 1 || sources["milksu-cve"] != 1 {
		t.Fatalf("unexpected sources: %#v", status.Sources)
	}

	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatalf("open session index: %v", err)
	}
	defer db.Close()
	var indexedText string
	if err := db.QueryRow(`SELECT group_concat(text, char(10)) FROM messages`).Scan(&indexedText); err != nil {
		t.Fatalf("read indexed messages: %v", err)
	}
	if strings.Contains(indexedText, "sk-session-index-secret") || strings.Contains(indexedText, "cve-secret-token") {
		t.Fatalf("indexed messages leaked credentials: %q", indexedText)
	}
	var inputJSON string
	if err := db.QueryRow(`SELECT input_json FROM tool_calls WHERE name = 'computer_use.click'`).Scan(&inputJSON); err != nil {
		t.Fatalf("read indexed tool call: %v", err)
	}
	if strings.Contains(inputJSON, "approval-token-secret") {
		t.Fatalf("indexed tool call input leaked credential: %q", inputJSON)
	}
}

func TestSearchFindsMilkSUIndexedHistory(t *testing.T) {
	path := filepath.Join(t.TempDir(), "session-index", "obelisk.sqlite")
	store, err := NewStore(path)
	if err != nil {
		t.Fatalf("NewStore() error = %v", err)
	}
	store.Now = fixedNow
	if _, err := store.RefreshMilkSUConversations(context.Background(), []conversation.StoredConversation{{
		ID:            "cve-1",
		Title:         "CVE feed import",
		CreatedAt:     uint64(time.Date(2026, 8, 4, 7, 0, 0, 0, time.UTC).UnixMilli()),
		WorkspacePath: "/Users/milksu/code/milksu",
		Messages: []conversation.StoredMessage{{
			ID:        "assistant-1",
			Role:      "assistant",
			Content:   "NVD CVE-2024-3400 同步完成；OPENAI_API_KEY=sk-obelisk-secret12345",
			Timestamp: uint64(time.Date(2026, 8, 4, 7, 10, 0, 0, time.UTC).UnixMilli()),
		}},
	}, {
		ID:            "coding-1",
		Title:         "Coding NVD note",
		CreatedAt:     uint64(time.Date(2026, 8, 4, 8, 0, 0, 0, time.UTC).UnixMilli()),
		WorkspacePath: "/Users/milksu/code/milksu",
		Messages: []conversation.StoredMessage{{
			ID:        "assistant-1",
			Role:      "assistant",
			Content:   "Coding 提到 NVD 同步按钮，但这条不应该进入 CVE 面板的模块过滤。",
			Timestamp: uint64(time.Date(2026, 8, 4, 8, 10, 0, 0, time.UTC).UnixMilli()),
		}},
	}}); err != nil {
		t.Fatalf("RefreshMilkSUConversations() error = %v", err)
	}

	response, err := store.Search(context.Background(), SearchRequest{
		Query:  "NVD",
		Limit:  4,
		Module: "cve",
	})
	if err != nil {
		t.Fatalf("Search() error = %v", err)
	}
	if !response.Status.Available {
		t.Fatalf("Search().Status.Available = false")
	}
	if len(response.Results) != 1 {
		t.Fatalf("Search() returned %d results, want 1: %#v", len(response.Results), response.Results)
	}
	result := response.Results[0]
	if result.Source != "milksu-cve" || result.SessionName != "CVE feed import" {
		t.Fatalf("unexpected result metadata: %#v", result)
	}
	if !strings.Contains(result.Snippet, "NVD") {
		t.Fatalf("missing query in snippet: %q", result.Snippet)
	}
	if strings.Contains(result.Snippet, "sk-obelisk-secret") {
		t.Fatalf("snippet leaked credential: %q", result.Snippet)
	}
	if !strings.Contains(response.FactBoundary, "Obelisk 结果只是历史线索") {
		t.Fatalf("missing response fact boundary: %q", response.FactBoundary)
	}
}

func TestImportExternalJSONLIndexesToolHistoryAndRedactsSecrets(t *testing.T) {
	path := filepath.Join(t.TempDir(), "session-index", "obelisk.sqlite")
	store, err := NewStore(path)
	if err != nil {
		t.Fatalf("NewStore() error = %v", err)
	}
	store.Now = fixedNow
	historyPath := filepath.Join(t.TempDir(), "codex-history.jsonl")
	writeLines(t, historyPath, []string{
		`{"session_id":"codex-a","title":"Codex self boot","timestamp":"2026-08-05T01:00:00Z","role":"user","content":[{"type":"input_text","text":"Find the Computer Use screenshot route; OPENAI_API_KEY=sk-external-history-secret12345"}],"cwd":"/Users/milksu/code/milksu","model":"gpt-5"}`,
		`{"session_id":"codex-a","timestamp":"2026-08-05T01:02:00Z","type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Computer Use screenshot route is in the bridge policy."},{"type":"tool_use","name":"computer_use.observe","input":{"target":"Calculator","api_key":"sk-tool-input-secret12345"}}]},"cwd":"/Users/milksu/code/milksu"}`,
		`{"sessionId":"codex-b","title":"CVE handoff","timestamp":1785901380000,"role":"assistant","content":"CVE-2023-46604 Vulhub mapping found with Bearer imported-token-secret12345","project_path":"/Users/milksu/code/milksu"}`,
		`not json`,
	})

	result, err := store.ImportExternalJSONL(context.Background(), ExternalImportRequest{
		Source:      "codex",
		Path:        historyPath,
		Project:     "milksu",
		ProjectPath: "/Users/milksu/code/milksu",
	})
	if err != nil {
		t.Fatalf("ImportExternalJSONL() error = %v", err)
	}
	if result.SessionCount != 2 || result.MessageCount != 3 || result.ToolCallCount != 1 || result.SkippedLineCount != 1 {
		t.Fatalf("unexpected import result: %#v", result)
	}
	if result.Source != "codex" || result.Path != historyPath {
		t.Fatalf("unexpected import metadata: %#v", result)
	}

	status, err := store.Status(context.Background())
	if err != nil {
		t.Fatalf("Status() error = %v", err)
	}
	if sources := sourceMap(status.Sources); sources["codex"] != 2 {
		t.Fatalf("unexpected sources after import: %#v", status.Sources)
	}

	response, err := store.Search(context.Background(), SearchRequest{
		Query:  "Computer Use screenshot",
		Source: "codex",
		Limit:  4,
	})
	if err != nil {
		t.Fatalf("Search() error = %v", err)
	}
	if len(response.Results) == 0 {
		t.Fatalf("Search() returned no imported history")
	}
	if !strings.HasPrefix(response.Results[0].SessionID, "external:codex:") {
		t.Fatalf("unexpected external session id: %#v", response.Results[0])
	}
	if strings.Contains(response.Results[0].Snippet, "sk-external-history-secret") {
		t.Fatalf("search result leaked credential: %q", response.Results[0].Snippet)
	}

	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatalf("open session index: %v", err)
	}
	defer db.Close()
	var indexedText string
	if err := db.QueryRow(`SELECT group_concat(text || char(10) || COALESCE(input_json, ''), char(10)) FROM messages LEFT JOIN tool_calls ON tool_calls.message_uuid = messages.uuid`).Scan(&indexedText); err != nil {
		t.Fatalf("read indexed text: %v", err)
	}
	for _, leaked := range []string{"sk-external-history-secret", "sk-tool-input-secret", "imported-token-secret"} {
		if strings.Contains(indexedText, leaked) {
			t.Fatalf("external import leaked credential %q in %q", leaked, indexedText)
		}
	}
	if strings.Contains(indexedText, "redacted] redacted]") {
		t.Fatalf("external import repeated redaction marker: %q", indexedText)
	}

	second, err := store.ImportExternalJSONL(context.Background(), ExternalImportRequest{
		Source:      "codex",
		Path:        historyPath,
		Project:     "milksu",
		ProjectPath: "/Users/milksu/code/milksu",
	})
	if err != nil {
		t.Fatalf("ImportExternalJSONL() second pass error = %v", err)
	}
	if second.SessionCount != result.SessionCount || second.MessageCount != result.MessageCount || second.ToolCallCount != result.ToolCallCount {
		t.Fatalf("second import changed counts: %#v -> %#v", result, second)
	}
	status, err = store.Status(context.Background())
	if err != nil {
		t.Fatalf("Status() after second import error = %v", err)
	}
	if status.SessionCount != 2 || status.MessageCount != 3 || status.ToolCallCount != 1 {
		t.Fatalf("second import created duplicates: %#v", status)
	}
}

func TestRedactSnippetIsIdempotentForAlreadyRedactedValues(t *testing.T) {
	once := strings.Join([]string{
		"OPENAI_API_KEY=[credential redacted]",
		"Authorization: Bearer [credential redacted]",
		"https://provider.example.test/v1?api_key=[credential redacted]&model=x",
		"https://provider.example.test/v1?x-api-key=[credential redacted]&model=x",
		"api-key=[credential redacted]",
		"x-api-key: [credential redacted]",
	}, " ")

	redacted := RedactSnippet(once)
	if got := RedactSnippet(redacted); got != redacted {
		t.Fatalf("RedactSnippet() second pass = %q, want idempotent %q", got, redacted)
	}
	if strings.Contains(redacted, "redacted] redacted]") {
		t.Fatalf("RedactSnippet() repeated the redaction marker: %q", redacted)
	}
	if strings.Contains(redacted, "redacted]&model=x redacted]") {
		t.Fatalf("RedactSnippet() repeated the query redaction marker: %q", redacted)
	}
}

func TestRedactSnippetCollapsesPreviouslyExpandedMarkers(t *testing.T) {
	polluted := strings.Join([]string{
		"OPENAI_API_KEY=[credential redacted] redacted] redacted]",
		"https://provider.example.test/v1?api_key=[credential redacted]&model=x redacted]",
	}, " ")

	redacted := RedactSnippet(polluted)
	if !strings.Contains(redacted, "OPENAI_API_KEY=[credential redacted]") {
		t.Fatalf("RedactSnippet() removed redaction marker context: %q", redacted)
	}
	if !strings.Contains(redacted, "?api_key=[credential redacted]&model=x") {
		t.Fatalf("RedactSnippet() removed query context: %q", redacted)
	}
	if strings.Contains(redacted, "redacted] redacted]") {
		t.Fatalf("RedactSnippet() kept expanded redaction markers: %q", redacted)
	}
	if strings.Contains(redacted, "redacted]&model=x redacted]") {
		t.Fatalf("RedactSnippet() kept expanded query redaction marker: %q", redacted)
	}
	if got := RedactSnippet(redacted); got != redacted {
		t.Fatalf("RedactSnippet() second pass = %q, want idempotent %q", got, redacted)
	}
}

func TestSearchFallsBackWhenFTSIsUnavailable(t *testing.T) {
	path := createObeliskFixtureWithoutFTS(t)
	store := Store{Path: path, Now: fixedNow}

	response, err := store.Search(context.Background(), SearchRequest{
		Query:   "Computer Use 外部 App",
		Project: "milksu",
		Limit:   2,
	})
	if err != nil {
		t.Fatalf("Search() error = %v", err)
	}
	if len(response.Results) != 1 {
		t.Fatalf("Search() returned %d results, want 1: %#v", len(response.Results), response.Results)
	}
	if response.Results[0].SessionID != "session-coding" {
		t.Fatalf("unexpected fallback result: %#v", response.Results[0])
	}
}

func createObeliskFixtureWithoutFTS(t *testing.T) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "obelisk.sqlite")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatalf("open fixture db: %v", err)
	}
	defer db.Close()

	statements := []string{
		`CREATE TABLE sessions (
			id TEXT PRIMARY KEY,
			title TEXT,
			project TEXT,
			project_path TEXT,
			started_at TEXT,
			ended_at TEXT,
			git_branch TEXT,
			version TEXT,
			message_count INTEGER DEFAULT 0,
			jsonl_path TEXT,
			source TEXT DEFAULT 'claude'
		)`,
		`CREATE TABLE messages (
			uuid TEXT PRIMARY KEY,
			session_id TEXT,
			type TEXT,
			parent_uuid TEXT,
			timestamp TEXT,
			role TEXT,
			text TEXT,
			content_type TEXT,
			is_meta INTEGER DEFAULT 0,
			visibility TEXT DEFAULT 'visible',
			model TEXT,
			is_sidechain INTEGER DEFAULT 0,
			agent_id TEXT,
			input_tokens INTEGER,
			output_tokens INTEGER,
			cwd TEXT,
			skill TEXT,
			turn_duration_ms INTEGER,
			source TEXT DEFAULT 'claude'
		)`,
		`CREATE TABLE tool_calls (
			id TEXT PRIMARY KEY,
			message_uuid TEXT,
			session_id TEXT,
			name TEXT,
			presentation TEXT DEFAULT 'default',
			input_json TEXT,
			file_path TEXT
		)`,
		`CREATE TABLE memories (
			id TEXT PRIMARY KEY,
			session_id TEXT,
			project TEXT,
			message_start TEXT,
			message_end TEXT,
			path TEXT,
			anchors TEXT,
			summary TEXT,
			created_at TEXT,
			deleted_at TEXT,
			deleted_reason TEXT
		)`,
	}
	for _, statement := range statements {
		if _, err := db.Exec(statement); err != nil {
			t.Fatalf("exec fixture statement: %v", err)
		}
	}
	fixtureExec(t, db, `INSERT INTO sessions(id, title, project, project_path, started_at, source) VALUES
		('session-coding', 'Computer Use validation', 'milksu', '/Users/milksu/code/milksu', '2026-08-04T02:00:00Z', 'pi')`)
	fixtureExec(t, db, `INSERT INTO messages(uuid, session_id, timestamp, role, text, model, cwd, source) VALUES
		('msg-coding', 'session-coding', '2026-08-04T02:10:00Z', 'assistant', 'Computer Use 外部 App 已观察，但还需要一次 click/type 硬验收。', 'gpt-5', '/Users/milksu/code/milksu', 'pi')`)
	if err := os.Chmod(path, 0o600); err != nil {
		t.Fatalf("chmod fixture: %v", err)
	}
	return path
}

func fixtureExec(t *testing.T, db *sql.DB, statement string) {
	t.Helper()
	if _, err := db.Exec(statement); err != nil {
		t.Fatalf("exec fixture insert: %v", err)
	}
}

func writeLines(t *testing.T, path string, lines []string) {
	t.Helper()
	data := strings.Join(lines, "\n") + "\n"
	if err := os.WriteFile(path, []byte(data), 0o600); err != nil {
		t.Fatalf("write fixture jsonl: %v", err)
	}
}

func sourceMap(values []SourceCount) map[string]int64 {
	result := make(map[string]int64, len(values))
	for _, value := range values {
		result[value.Source] = value.Count
	}
	return result
}

func fixedNow() time.Time {
	return time.Date(2026, 8, 4, 9, 30, 0, 0, time.UTC)
}
