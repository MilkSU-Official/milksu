package companion

import (
	"fmt"
	"strings"
	"sync"
)

type Memory struct {
	mu        sync.Mutex
	searcher  SessionSearcher
	catalog   Catalog
	pending   map[string]MemoryProposal
	approved  map[string]ApprovedMemory
	forgotten map[string]bool
}

func NewMemory(searcher SessionSearcher, catalog Catalog) *Memory {
	return &Memory{
		searcher:  searcher,
		catalog:   catalog,
		pending:   make(map[string]MemoryProposal),
		approved:  make(map[string]ApprovedMemory),
		forgotten: make(map[string]bool),
	}
}

func (m *Memory) Handle(input map[string]any) (any, error) {
	action := strings.TrimSpace(stringValue(input["action"]))
	switch action {
	case "search":
		return m.Search(
			strings.TrimSpace(stringValue(input["query"])),
			intValue(input["limit"]),
			strings.TrimSpace(stringValue(input["scope"])),
		)
	case "recall":
		return m.Recall(
			strings.TrimSpace(stringValue(input["sessionId"])),
			strings.TrimSpace(stringValue(input["cursor"])),
		)
	case "propose_memory":
		return m.Propose(MemoryProposal{
			Title:            strings.TrimSpace(stringValue(input["title"])),
			Markdown:         strings.TrimSpace(stringValue(input["markdown"])),
			SourceSessionIDs: stringSlice(input["sourceSessionIds"]),
		})
	case "forget":
		return m.Forget(strings.TrimSpace(stringValue(input["memoryId"])))
	default:
		return nil, fmt.Errorf("unknown companion_memory action %q", action)
	}
}

func (m *Memory) Search(query string, limit int, scope string) (map[string]any, error) {
	query = strings.TrimSpace(query)
	if query == "" {
		return map[string]any{
			"written": false,
			"results": []MemoryHit{},
		}, nil
	}
	if limit <= 0 {
		limit = 8
	}
	if limit > 50 {
		limit = 50
	}
	results := []MemoryHit{}
	if m.searcher != nil {
		hits, err := m.searcher.Search(query, limit, scope)
		if err != nil {
			return map[string]any{
				"written": false,
				"results": []MemoryHit{},
				"error":   err.Error(),
			}, nil
		}
		results = hits
	}
	return map[string]any{
		"written": false,
		"results": results,
	}, nil
}

func (m *Memory) Recall(sessionID, cursor string) (map[string]any, error) {
	sessionID = strings.TrimSpace(sessionID)
	if sessionID == "" {
		return nil, fmt.Errorf("recall requires sessionId")
	}
	if m.catalog == nil {
		return map[string]any{
			"written":   false,
			"sessionId": sessionID,
			"cursor":    cursor,
			"messages":  []any{},
		}, nil
	}
	ref, err := m.catalog.Lookup(sessionID)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"written":   false,
		"sessionId": ref.ID,
		"title":     ref.Title,
		"cursor":    cursor,
		"kind":      ref.Kind,
	}, nil
}

func (m *Memory) Propose(proposal MemoryProposal) (map[string]any, error) {
	if strings.TrimSpace(proposal.Title) == "" || strings.TrimSpace(proposal.Markdown) == "" {
		return nil, fmt.Errorf("propose_memory requires title and markdown")
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	id := newPrefixedID("mem")
	proposal.ID = id
	proposal.Pending = true
	m.pending[id] = proposal
	return map[string]any{
		"written":  false,
		"proposal": proposal,
	}, nil
}

func (m *Memory) Forget(memoryID string) (map[string]any, error) {
	memoryID = strings.TrimSpace(memoryID)
	if memoryID == "" {
		return nil, fmt.Errorf("forget requires memoryId")
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.pending, memoryID)
	delete(m.approved, memoryID)
	m.forgotten[memoryID] = true
	return map[string]any{
		"forgotten": memoryID,
		"written":   false,
	}, nil
}

func (m *Memory) Approve(memoryID string) (ApprovedMemory, error) {
	memoryID = strings.TrimSpace(memoryID)
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.forgotten[memoryID] {
		return ApprovedMemory{}, fmt.Errorf("memory %s was forgotten", memoryID)
	}
	proposal, ok := m.pending[memoryID]
	if !ok {
		return ApprovedMemory{}, fmt.Errorf("pending memory %s was not found", memoryID)
	}
	approved := ApprovedMemory{
		ID:               proposal.ID,
		Title:            proposal.Title,
		Markdown:         proposal.Markdown,
		SourceSessionIDs: append([]string(nil), proposal.SourceSessionIDs...),
	}
	delete(m.pending, memoryID)
	m.approved[memoryID] = approved
	return approved, nil
}

func (m *Memory) ApprovedForAssembly() []ApprovedMemory {
	m.mu.Lock()
	defer m.mu.Unlock()
	result := make([]ApprovedMemory, 0, len(m.approved))
	for _, memory := range m.approved {
		if m.forgotten[memory.ID] {
			continue
		}
		result = append(result, memory)
	}
	return result
}

func (m *Memory) Forgotten(id string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.forgotten[strings.TrimSpace(id)]
}

func (m *Memory) Replace(pending []MemoryProposal, approved []ApprovedMemory, forgotten []string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.pending = make(map[string]MemoryProposal, len(pending))
	for _, proposal := range pending {
		if strings.TrimSpace(proposal.ID) == "" {
			continue
		}
		m.pending[proposal.ID] = proposal
	}
	m.approved = make(map[string]ApprovedMemory, len(approved))
	for _, memory := range approved {
		if strings.TrimSpace(memory.ID) == "" {
			continue
		}
		m.approved[memory.ID] = memory
	}
	m.forgotten = make(map[string]bool, len(forgotten))
	for _, id := range forgotten {
		if strings.TrimSpace(id) != "" {
			m.forgotten[id] = true
		}
	}
}

type MemorySnapshot struct {
	Pending  []MemoryProposal `json:"pending"`
	Approved []ApprovedMemory `json:"approved"`
}

func (m *Memory) Snapshot() MemorySnapshot {
	pending, approved, _ := m.Persist()
	if pending == nil {
		pending = []MemoryProposal{}
	}
	if approved == nil {
		approved = []ApprovedMemory{}
	}
	return MemorySnapshot{Pending: pending, Approved: approved}
}

func (m *Memory) Persist() (pending []MemoryProposal, approved []ApprovedMemory, forgotten []string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, proposal := range m.pending {
		pending = append(pending, proposal)
	}
	for _, memory := range m.approved {
		approved = append(approved, memory)
	}
	for id := range m.forgotten {
		forgotten = append(forgotten, id)
	}
	return pending, approved, forgotten
}
