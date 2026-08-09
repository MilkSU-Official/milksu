package sessionindex

import (
	"context"
	"database/sql"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestBuildGraphContextUsesHumanHistoryAndFormalEvidenceWithoutToolTelemetry(t *testing.T) {
	path := filepath.Join(t.TempDir(), "session-index", "obelisk.sqlite")
	store, err := NewStore(path)
	if err != nil {
		t.Fatal(err)
	}
	store.Now = fixedNow
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	fixtureExec(t, db, `INSERT INTO sessions(id, title, project, project_path, started_at, source) VALUES
		('milksu:semantic-coding', '自举与 Computer Use', 'milksu', '/workspace/milksu', '2026-08-09T01:00:00Z', 'milksu-coding')`)
	fixtureExec(t, db, `INSERT INTO messages(uuid, session_id, timestamp, role, text, visibility, source) VALUES
		('user-1', 'milksu:semantic-coding', '2026-08-09T01:01:00Z', 'user', 'Computer Use 应该验证另一份 MilkSU Beta，API_KEY=sk-semantic-secret12345', 'visible', 'milksu-coding'),
		('assistant-1', 'milksu:semantic-coding', '2026-08-09T01:02:00Z', 'assistant', 'Computer Use 与 worktree 共同构成安全自举边界。', 'visible', 'milksu-coding'),
		('tool-1', 'milksu:semantic-coding', '2026-08-09T01:03:00Z', 'tool', 'bash browser_snapshot read grep', 'visible', 'milksu-coding')`)
	fixtureExec(t, db, `INSERT INTO memories(id, session_id, project, path, summary, created_at) VALUES
		('memory-1', 'milksu:semantic-coding', 'milksu', 'self-bootstrap', 'Computer Use 的验证对象必须与正式 App 数据隔离。', '2026-08-09T01:04:00Z')`)
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}

	graphContext, err := store.BuildGraphContext(context.Background(), GraphRequest{
		Query: "Computer Use",
	}, GraphInput{Archives: []GraphArchive{{
		ID: "ctf-1", Module: "ctf", Title: "Computer Use CTF 验收", Timestamp: "2026-08-09T02:00:00Z",
		Evidence: []GraphArchiveEvidence{{Claim: "Computer Use 完成可见窗口验证", Provenance: "Judge receipt"}},
	}}})
	if err != nil {
		t.Fatal(err)
	}
	if len(graphContext.Seeds) != 4 {
		t.Fatalf("seeds = %#v", graphContext.Seeds)
	}
	seenKinds := map[string]bool{}
	for index, seed := range graphContext.Seeds {
		seenKinds[seed.Kind] = true
		if seed.ID == "" || seed.Source.Excerpt == "" {
			t.Fatalf("seed %d is not traceable: %#v", index, seed)
		}
		joined := seed.Label + " " + seed.Excerpt + " " + seed.Source.Excerpt
		if strings.Contains(joined, "sk-semantic-secret") || strings.Contains(joined, "bash browser_snapshot") {
			t.Fatalf("semantic context leaked credential or tool telemetry: %#v", seed)
		}
	}
	for _, kind := range []string{"memory", "conversation", "formal-evidence"} {
		if !seenKinds[kind] {
			t.Fatalf("missing %s seed: %#v", kind, graphContext.Seeds)
		}
	}
	prompt, err := SemanticGraphPrompt(graphContext)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(prompt, "给人阅读") || !strings.Contains(prompt, "禁止把 bash") {
		t.Fatalf("prompt does not preserve the human semantic boundary: %s", prompt)
	}
}

func TestProjectSemanticGraphValidatesSourcesAndMarksInference(t *testing.T) {
	graphContext := GraphContext{
		Query: "自举", Status: Status{Available: true}, Projects: []string{"milksu"},
		Seeds: []GraphSeed{{
			ID:     "source-01",
			Source: GraphSource{Kind: "conversation", SessionID: "milksu:s1", ConversationID: "s1", MessageUUID: "m1", SessionName: "自举", Excerpt: "正式与 Beta 隔离"},
		}, {
			ID:     "source-02",
			Source: GraphSource{Kind: "memory", SessionID: "milksu:s2", SessionName: "验证", Excerpt: "Computer Use 验收"},
		}},
	}
	raw := `{"title":"自举能力图谱","summary":"以隔离和可见验收为核心","clusters":[{"id":"boundary","label":"安全边界"}],"nodes":[
		{"id":"a","type":"capability","label":"双 App 自举","summary":"正式 App 驱动 MilkSU Beta","cluster":"boundary","importance":5,"status":"planned","sourceIds":["source-01"]},
		{"id":"b","type":"evidence","label":"Computer Use 验收","summary":"通过可见交互证明链路","cluster":"boundary","importance":4,"status":"current","sourceIds":["source-02"]},
		{"id":"c","type":"problem","label":"API_KEY=sk-output-secret12345","summary":"权限隔离尚待验证","cluster":"missing","importance":3,"status":"uncertain","sourceIds":["source-01"]},
		{"id":"hallucinated","type":"topic","label":"无来源节点","summary":"不应保留","cluster":"boundary","importance":2,"status":"current","sourceIds":["source-99"]}],
		"edges":[{"source":"b","target":"a","type":"validates","rationale":"可见验收支持自举能力","confidence":0.82},{"source":"hallucinated","target":"a","type":"supports","rationale":"无效","confidence":1}]}`
	response, err := ProjectSemanticGraph(raw, graphContext, "tokenflux", "grok-4.5", fixedNow())
	if err != nil {
		t.Fatal(err)
	}
	if len(response.Nodes) != 3 || len(response.Edges) != 1 {
		t.Fatalf("unexpected projection: %#v", response)
	}
	for _, node := range response.Nodes {
		if !node.Inferred || len(node.Sources) == 0 {
			t.Fatalf("node lost inference/source boundary: %#v", node)
		}
		if strings.Contains(node.Label+node.Summary, "sk-output-secret") {
			t.Fatalf("node leaked model-output credential: %#v", node)
		}
	}
	if !response.Edges[0].Inferred || response.Edges[0].Type != "validates" {
		t.Fatalf("edge = %#v", response.Edges[0])
	}
	if !strings.Contains(response.FactBoundary, "仅供人阅读") {
		t.Fatalf("missing human-facing fact boundary: %q", response.FactBoundary)
	}
}

func TestProjectSemanticGraphRejectsUnsourcedOutput(t *testing.T) {
	graphContext := GraphContext{Query: "MCP", Seeds: []GraphSeed{{ID: "source-01"}}}
	raw := `{"title":"MCP","summary":"","clusters":[],"nodes":[
		{"id":"a","type":"topic","label":"A","summary":"","cluster":"","importance":1,"status":"current","sourceIds":["missing"]},
		{"id":"b","type":"topic","label":"B","summary":"","cluster":"","importance":1,"status":"current","sourceIds":["missing"]},
		{"id":"c","type":"topic","label":"C","summary":"","cluster":"","importance":1,"status":"current","sourceIds":["missing"]}],"edges":[]}`
	if _, err := ProjectSemanticGraph(raw, graphContext, "", "", time.Now()); err == nil {
		t.Fatal("expected unsourced model output to fail")
	}
}
