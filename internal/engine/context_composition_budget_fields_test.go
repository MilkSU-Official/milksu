package engine

import (
	"encoding/json"
	"testing"
)

// The engine re-encodes the sidecar's context_composition payload through the
// typed ContextComposition struct on its way to the UI, so any field that is not
// declared there is dropped before the usage panel can see it. β.135 shipped a
// "usable input budget" marker that never appeared for exactly that reason: the
// sidecar sent maxOutput/usableWindow and this struct silently discarded them.
func TestContextCompositionKeepsBudgetFields(t *testing.T) {
	raw := []byte(`{"estimatedTokens":646000,"contextWindow":1000000,"maxOutput":384000,` +
		`"usableWindow":616000,"categories":[{"id":"conversation","tokens":629000}]}`)

	var composition ContextComposition
	if err := json.Unmarshal(raw, &composition); err != nil {
		t.Fatalf("unmarshal context composition: %v", err)
	}
	if composition.MaxOutput != 384000 {
		t.Fatalf("maxOutput was dropped on the way in: got %d", composition.MaxOutput)
	}
	if composition.UsableWindow != 616000 {
		t.Fatalf("usableWindow was dropped on the way in: got %d", composition.UsableWindow)
	}

	encoded, err := json.Marshal(composition)
	if err != nil {
		t.Fatalf("marshal context composition: %v", err)
	}
	var wire map[string]any
	if err := json.Unmarshal(encoded, &wire); err != nil {
		t.Fatalf("unmarshal the re-encoded event: %v", err)
	}
	if wire["maxOutput"] != float64(384000) {
		t.Fatalf("maxOutput is missing from the event the UI receives: %v", wire)
	}
	if wire["usableWindow"] != float64(616000) {
		t.Fatalf("usableWindow is missing from the event the UI receives: %v", wire)
	}
	if wire["estimatedTokens"] != float64(646000) {
		t.Fatalf("the existing fields must keep flowing: %v", wire)
	}
}
