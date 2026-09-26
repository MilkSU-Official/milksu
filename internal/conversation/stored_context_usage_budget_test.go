package conversation

import (
	"encoding/json"
	"testing"
)

// A reopened conversation builds its usage panel from the persisted
// lastContextUsage record. The sidecar sends maxOutput/usableWindow on
// context.composition; if this struct does not declare them, the input budget
// silently disappears whenever the reader reopens the conversation.
func TestStoredContextUsageKeepsBudgetFields(t *testing.T) {
	raw := []byte(`{"inputTokens":565,"outputTokens":108000,"cacheReadTokens":108000,` +
		`"totalTokens":216565,"contextWindow":1000000,"estimatedTokens":646000,` +
		`"maxOutput":384000,"usableWindow":616000,` +
		`"categories":[{"id":"conversation","tokens":629000}]}`)

	var stored StoredContextUsage
	if err := json.Unmarshal(raw, &stored); err != nil {
		t.Fatalf("unmarshal stored context usage: %v", err)
	}
	if stored.MaxOutput != 384000 {
		t.Fatalf("maxOutput was dropped when persisting: got %d", stored.MaxOutput)
	}
	if stored.UsableWindow != 616000 {
		t.Fatalf("usableWindow was dropped when persisting: got %d", stored.UsableWindow)
	}

	encoded, err := json.Marshal(stored)
	if err != nil {
		t.Fatalf("marshal stored context usage: %v", err)
	}
	var wire map[string]any
	if err := json.Unmarshal(encoded, &wire); err != nil {
		t.Fatalf("unmarshal the re-encoded record: %v", err)
	}
	if wire["maxOutput"] != float64(384000) {
		t.Fatalf("maxOutput is missing from the reopened panel payload: %v", wire)
	}
	if wire["usableWindow"] != float64(616000) {
		t.Fatalf("usableWindow is missing from the reopened panel payload: %v", wire)
	}
	if wire["estimatedTokens"] != float64(646000) {
		t.Fatalf("existing fields must keep flowing: %v", wire)
	}
}
