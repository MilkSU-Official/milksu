package companion

import (
	"fmt"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

var (
	memorySecretKeyPattern    = regexp.MustCompile(`\bsk-[A-Za-z0-9_-]{12,}\b`)
	memorySecretBearerPattern = regexp.MustCompile(`(?i)\bBearer\s+[A-Za-z0-9._~+/=-]{12,}`)
	memorySecretFlagPattern   = regexp.MustCompile(`(?i)\b(?:flag|nssctf|ctf)\{[^}\r\n]{1,512}\}`)
)

func redactMemoryText(value string) string {
	value = memorySecretFlagPattern.ReplaceAllString(value, "[redacted]")
	value = memorySecretKeyPattern.ReplaceAllString(value, "[redacted]")
	value = memorySecretBearerPattern.ReplaceAllString(value, "[redacted]")
	return value
}

const memoryCommitLimit = 3

type Memory struct {
	mu        sync.Mutex
	searcher  SessionSearcher
	catalog   Catalog
	pending   map[string]MemoryProposal
	approved  map[string]ApprovedMemory
	forgotten map[string]bool
	// revision increments whenever approved or forgotten memory changes.
	// Publishers send it with the snapshot so a slower writer cannot
	// put an older list back over a newer forget or commit.
	revision uint64
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
	case "commit":
		return m.Commit(strings.TrimSpace(stringValue(input["userText"])), commitItems(input["items"])), nil
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

type MemoryCommit struct {
	Action     string
	ExistingID string
	Title      string
	Markdown   string
	Evidence   string
}

func commitItems(value any) []MemoryCommit {
	rows, ok := value.([]any)
	if !ok {
		return nil
	}
	items := make([]MemoryCommit, 0, len(rows))
	for _, row := range rows {
		item, ok := row.(map[string]any)
		if !ok {
			continue
		}
		items = append(items, MemoryCommit{
			Action:     strings.TrimSpace(stringValue(item["action"])),
			ExistingID: strings.TrimSpace(stringValue(item["existingId"])),
			Title:      strings.TrimSpace(stringValue(item["title"])),
			Markdown:   strings.TrimSpace(stringValue(item["markdown"])),
			Evidence:   strings.TrimSpace(stringValue(item["evidence"])),
		})
	}
	return items
}

func (m *Memory) Commit(userText string, items []MemoryCommit) map[string]any {
	userText = strings.TrimSpace(userText)
	m.mu.Lock()
	defer m.mu.Unlock()
	written := 0
	for _, item := range items {
		if written >= memoryCommitLimit {
			break
		}
		title := strings.TrimSpace(item.Title)
		markdown := strings.TrimSpace(item.Markdown)
		evidence := strings.TrimSpace(item.Evidence)
		if title == "" || markdown == "" || evidence == "" || userText == "" || !strings.Contains(userText, evidence) {
			continue
		}
		title = redactMemoryText(title)
		markdown = redactMemoryText(markdown)
		evidence = redactMemoryText(evidence)
		if title == "" || markdown == "" || evidence == "" {
			continue
		}
		switch strings.TrimSpace(item.Action) {
		case "update":
			id := strings.TrimSpace(item.ExistingID)
			current, ok := m.approved[id]
			if !ok || m.forgotten[id] {
				continue
			}
			current.Title = title
			current.Markdown = markdown
			current.Evidence = evidence
			m.approved[id] = current
			written++
		case "create":
			id := newPrefixedID("mem")
			m.approved[id] = ApprovedMemory{
				ID:       id,
				Title:    title,
				Markdown: markdown,
				Evidence: evidence,
				At:       time.Now().UTC().Format(time.RFC3339Nano),
			}
			written++
		}
	}
	if written > 0 {
		m.bumpLocked()
	}
	return map[string]any{
		"written":  true,
		"count":    written,
		"revision": m.revision,
		"approved": approvedPayload(m.approved, m.forgotten),
	}
}

func approvedPayload(approved map[string]ApprovedMemory, forgotten map[string]bool) []map[string]string {
	payload := make([]map[string]string, 0, len(approved))
	for _, memory := range approved {
		if forgotten[memory.ID] {
			continue
		}
		payload = append(payload, map[string]string{
			"id":       memory.ID,
			"title":    memory.Title,
			"markdown": memory.Markdown,
		})
	}
	return payload
}

func (m *Memory) Propose(MemoryProposal) (map[string]any, error) {
	// Durable memory is written by the extract path. A model proposal must not
	// open an approval card or fail the turn.
	return map[string]any{"written": false}, nil
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
	m.bumpLocked()
	return map[string]any{
		"forgotten": memoryID,
		"written":   false,
		"revision":  m.revision,
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
	m.bumpLocked()
	return approved, nil
}

func (m *Memory) ApprovedForAssembly() []ApprovedMemory {
	_, approved := m.SnapshotApproved()
	return approved
}

func (m *Memory) Revision() uint64 {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.revision
}

func (m *Memory) SnapshotApproved() (uint64, []ApprovedMemory) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.revision, m.approvedLocked()
}

func (m *Memory) bumpLocked() {
	m.revision++
}

func (m *Memory) approvedLocked() []ApprovedMemory {
	result := make([]ApprovedMemory, 0, len(m.approved))
	for _, memory := range m.approved {
		if m.forgotten[memory.ID] {
			continue
		}
		result = append(result, memory)
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].At == result[j].At {
			return result[i].ID < result[j].ID
		}
		return result[i].At < result[j].At
	})
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
