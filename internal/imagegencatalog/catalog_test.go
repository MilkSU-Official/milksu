package imagegencatalog

import "testing"

func TestBuiltinKeepsChatModelsOut(t *testing.T) {
	snapshot := Builtin()
	if snapshot.Schema != Schema {
		t.Fatalf("schema = %q", snapshot.Schema)
	}
	if len(snapshot.Models) < 3 {
		t.Fatalf("expected curated image models, got %d", len(snapshot.Models))
	}
	chatLike := map[string]struct{}{
		"deepseek/deepseek-flash": {},
		"gpt-5.6":                 {},
		"claude-opus-5":           {},
		"grok-4.6":                {},
	}
	seen := map[string]struct{}{}
	for _, model := range snapshot.Models {
		if model.ID == "" || model.Name == "" || model.Platform == "" {
			t.Fatalf("incomplete model: %#v", model)
		}
		if _, duplicate := seen[model.ID]; duplicate {
			t.Fatalf("duplicate image model id %q", model.ID)
		}
		seen[model.ID] = struct{}{}
		if _, bad := chatLike[model.ID]; bad {
			t.Fatalf("chat model leaked into ImageGen catalog: %q", model.ID)
		}
	}
	for _, id := range []string{
		"openai/gpt-image-2",
		"xai/grok-imagine-image",
		"google/imagen-4.0-generate-001",
	} {
		if !KnownID(id) {
			t.Fatalf("expected TokenFlux-routable image model %q", id)
		}
	}
}

func TestLookup(t *testing.T) {
	model, ok := Lookup(" openai/gpt-image-2 ")
	if !ok || model.Name != "GPT Image 2" || !model.SupportsEdit {
		t.Fatalf("lookup = %#v ok=%v", model, ok)
	}
	if _, ok := Lookup("deepseek/deepseek-flash"); ok {
		t.Fatal("chat model must not resolve in ImageGen catalog")
	}
}
