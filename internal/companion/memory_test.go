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
	proposed, err := memory.Propose(MemoryProposal{Title: "Name", Markdown: "Call the user MilkSU."})
	if err != nil {
		t.Fatal(err)
	}
	proposal, _ := proposed["proposal"].(MemoryProposal)
	if _, err := memory.Approve(proposal.ID); err != nil {
		t.Fatal(err)
	}
	if len(memory.ApprovedForAssembly()) != 1 {
		t.Fatal("approved memory should appear in assembly")
	}
	if _, err := memory.Forget(proposal.ID); err != nil {
		t.Fatal(err)
	}
	if len(memory.ApprovedForAssembly()) != 0 {
		t.Fatal("forgotten memory must leave assembly")
	}
	if !memory.Forgotten(proposal.ID) {
		t.Fatal("forgotten id must be recorded")
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
