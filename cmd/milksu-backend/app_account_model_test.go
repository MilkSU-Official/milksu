package main

import (
	"testing"

	"github.com/MilkSU-Official/milksu/internal/modelcatalog"
)

func TestAccountCatalogModelUsesExactAvailableID(t *testing.T) {
	models := []modelcatalog.Model{
		{ID: "grok-4.3"},
		{ID: "grok-4.5"},
		{ID: "grok-4.6"},
	}
	if got := accountCatalogModel("x-ai/grok-4.6", models); got != "grok-4.6" {
		t.Fatalf("accountCatalogModel() = %q, want grok-4.6", got)
	}
	if got := accountCatalogModel("grok-4.5", models); got != "grok-4.5" {
		t.Fatalf("accountCatalogModel() exact match = %q, want grok-4.5", got)
	}
}

func TestAccountCatalogModelAlignsCompositeAndBareIDs(t *testing.T) {
	// Catalog ids are authoritative. Alignment only maps a saved selection onto
	// an exact catalog id, or the bare form of a prefix/model selection.
	composite := []modelcatalog.Model{
		{ID: "x-ai/grok-4.5"},
		{ID: "GPT/gpt-4.1"},
		{ID: "Claude/claude-sonnet-4.6"},
	}
	if got := accountCatalogModel("x-ai/grok-4.5", composite); got != "x-ai/grok-4.5" {
		t.Fatalf("accountCatalogModel exact = %q, want x-ai/grok-4.5", got)
	}
	if got := accountCatalogModel("gpt-4.1", composite); got != "GPT/gpt-4.1" {
		t.Fatalf("accountCatalogModel(bare->catalog) = %q, want GPT/gpt-4.1", got)
	}

	bare := []modelcatalog.Model{{ID: "claude-sonnet-4.6"}, {ID: "gpt-4.1"}}
	if got := accountCatalogModel("Claude/claude-sonnet-4.6", bare); got != "claude-sonnet-4.6" {
		t.Fatalf("accountCatalogModel(prefixed->bare) = %q, want claude-sonnet-4.6", got)
	}
}

func TestAccountCatalogModelFallsBackToBestAssignedModel(t *testing.T) {
	models := []modelcatalog.Model{
		{ID: "grok-4.3"},
		{ID: "grok-4.6"},
	}
	if got := accountCatalogModel("openai/gpt-4.1", models); got != "grok-4.6" {
		t.Fatalf("accountCatalogModel() = %q, want grok-4.6", got)
	}
	if got := accountCatalogModel("", nil); got != "" {
		t.Fatalf("accountCatalogModel() empty catalog = %q, want empty", got)
	}
}
