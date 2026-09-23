package companion

import (
	"strings"
	"testing"
)

type recordingSearcher struct {
	calls int
}

func (r *recordingSearcher) Search(query string, limit int, scope string) ([]MemoryHit, error) {
	r.calls++
	return []MemoryHit{{SessionID: "s1", Snippet: query}}, nil
}

func TestProposeMemoryDoesNotWriteDurableMemory(t *testing.T) {
	searcher := &recordingSearcher{}
	memory := NewMemory(searcher, nil)
	result, err := memory.Propose(MemoryProposal{Title: "Pref", Markdown: "short answers"})
	if err != nil {
		t.Fatal(err)
	}
	written, _ := result["written"].(bool)
	if written {
		t.Fatal("propose_memory must not write a durable memory")
	}
	if len(memory.ApprovedForAssembly()) != 0 {
		t.Fatal("pending proposal must not enter assembly")
	}
	if len(memory.Snapshot().Pending) != 0 {
		t.Fatal("propose_memory must not queue an approval")
	}
	search, err := memory.Search("auth", 5, "")
	if err != nil {
		t.Fatal(err)
	}
	if search["written"] != false {
		t.Fatalf("search must stay read-only: %#v", search)
	}
	if searcher.calls != 1 {
		t.Fatalf("search calls: %d", searcher.calls)
	}
}

func TestForgetRemovesMemoryFromAssembly(t *testing.T) {
	memory := NewMemory(nil, nil)
	memory.Commit("叫我 Milk", []MemoryCommit{{
		Action:   "create",
		Title:    "称呼",
		Markdown: "称呼用户 Milk",
		Evidence: "叫我 Milk",
	}})
	approved := memory.ApprovedForAssembly()
	if len(approved) != 1 {
		t.Fatal("committed memory should appear in assembly")
	}
	if _, err := memory.Forget(approved[0].ID); err != nil {
		t.Fatal(err)
	}
	if len(memory.ApprovedForAssembly()) != 0 {
		t.Fatal("forgotten memory must leave assembly")
	}
	if !memory.Forgotten(approved[0].ID) {
		t.Fatal("forgotten id must be recorded")
	}
}

func TestCommitWritesQuotedMemoryWithoutPending(t *testing.T) {
	memory := NewMemory(nil, nil)
	first := memory.Commit("以后都用中文回复我", []MemoryCommit{{
		Action:   "create",
		Title:    "回复语言",
		Markdown: "回复保持简体中文",
		Evidence: "以后都用中文回复我",
	}})
	if first["count"] != 1 {
		t.Fatalf("create count: %#v", first)
	}
	if len(memory.Snapshot().Pending) != 0 {
		t.Fatal("commit must not create a pending proposal")
	}
	approved := memory.ApprovedForAssembly()
	if len(approved) != 1 || approved[0].Markdown != "回复保持简体中文" || approved[0].At == "" || approved[0].Evidence != "以后都用中文回复我" {
		t.Fatalf("approved: %#v", approved)
	}
	rejected := memory.Commit("以后都用中文回复我", []MemoryCommit{{
		Action:   "create",
		Title:    "英文",
		Markdown: "不要用英文",
		Evidence: "不要用英文回复",
	}})
	if rejected["count"] != 0 || len(memory.ApprovedForAssembly()) != 1 {
		t.Fatalf("paraphrase was stored: %#v", rejected)
	}
	updated := memory.Commit("英文也可以", []MemoryCommit{{
		Action:     "update",
		ExistingID: approved[0].ID,
		Title:      "回复语言",
		Markdown:   "回复可以用英文",
		Evidence:   "英文也可以",
	}})
	if updated["count"] != 1 {
		t.Fatalf("update count: %#v", updated)
	}
	current := memory.ApprovedForAssembly()
	if len(current) != 1 || current[0].ID != approved[0].ID || current[0].Markdown != "回复可以用英文" {
		t.Fatalf("update replaced the row: %#v", current)
	}
	if current[0].At != approved[0].At {
		t.Fatal("update should keep the original timestamp")
	}
	if current[0].Evidence != "英文也可以" {
		t.Fatalf("update should replace the quote: %#v", current[0])
	}
	if memory.Revision() < 2 {
		t.Fatalf("revision: %d", memory.Revision())
	}
}

func TestCommitDoesNotRestoreAForgottenMemory(t *testing.T) {
	memory := NewMemory(nil, nil)
	created := memory.Commit("以后都用中文回复我", []MemoryCommit{{
		Action:   "create",
		Title:    "回复语言",
		Markdown: "回复保持简体中文",
		Evidence: "以后都用中文回复我",
	}})
	approved := memory.ApprovedForAssembly()
	if len(approved) != 1 {
		t.Fatalf("approved: %#v", approved)
	}
	createdRevision, _ := created["revision"].(uint64)
	if _, err := memory.Forget(approved[0].ID); err != nil {
		t.Fatal(err)
	}
	if memory.Revision() <= createdRevision {
		t.Fatal("forget should advance the memory revision")
	}
	updated := memory.Commit("英文也可以", []MemoryCommit{{
		Action:     "update",
		ExistingID: approved[0].ID,
		Title:      "回复语言",
		Markdown:   "回复可以用英文",
		Evidence:   "英文也可以",
	}})
	if updated["count"] != 0 || len(memory.ApprovedForAssembly()) != 0 {
		t.Fatalf("forgotten memory was written back: %#v", updated)
	}
	if !memory.Forgotten(approved[0].ID) {
		t.Fatal("forgotten id should stay forgotten")
	}
}

func TestApprovedAssemblyIsOldestFirst(t *testing.T) {
	memory := NewMemory(nil, nil)
	memory.Commit("先记住中文", []MemoryCommit{{
		Action:   "create",
		Title:    "语言",
		Markdown: "用中文",
		Evidence: "先记住中文",
	}})
	memory.Commit("再记住称呼", []MemoryCommit{{
		Action:   "create",
		Title:    "称呼",
		Markdown: "叫 Milk",
		Evidence: "再记住称呼",
	}})
	rows := memory.ApprovedForAssembly()
	if len(rows) != 2 {
		t.Fatalf("rows: %#v", rows)
	}
	if rows[0].At > rows[1].At || (rows[0].At == rows[1].At && rows[0].ID > rows[1].ID) {
		t.Fatalf("order: %#v", rows)
	}
}

func TestSearchEmptyQueryDoesNotWrite(t *testing.T) {
	memory := NewMemory(nil, nil)
	result, err := memory.Search("", 0, "")
	if err != nil {
		t.Fatal(err)
	}
	if result["written"] != false {
		t.Fatalf("empty search wrote: %#v", result)
	}
	if _, err := memory.Handle(map[string]any{"action": "search", "query": "x"}); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(fmtSprint(result), "api_key") {
		t.Fatal("memory result leaked a key field")
	}
}

func fmtSprint(value any) string {
	return strings.ToLower(strings.TrimSpace(stringValue(value)))
}
