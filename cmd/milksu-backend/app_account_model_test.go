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
	composite := []modelcatalog.Model{
		{ID: "x-ai/grok-4.5"},
		{ID: "openai/gpt-4.1"},
		{ID: "anthropic/claude-sonnet-4.6"},
		{ID: "google/gemini-2.5-pro"},
		{ID: "qwen/qwen3-coder-plus"},
	}
	if got := accountCatalogModel("grok-4.5", composite); got != "x-ai/grok-4.5" {
		t.Fatalf("accountCatalogModel(grok) = %q, want x-ai/grok-4.5", got)
	}
	if got := accountCatalogModel("gpt-4.1", composite); got != "openai/gpt-4.1" {
		t.Fatalf("accountCatalogModel(gpt) = %q, want openai/gpt-4.1", got)
	}
	if got := accountCatalogModel("claude-sonnet-4.6", composite); got != "anthropic/claude-sonnet-4.6" {
		t.Fatalf("accountCatalogModel(claude) = %q, want anthropic/claude-sonnet-4.6", got)
	}
	if got := accountCatalogModel("gemini-2.5-pro", composite); got != "google/gemini-2.5-pro" {
		t.Fatalf("accountCatalogModel(gemini) = %q, want google/gemini-2.5-pro", got)
	}
	if got := accountCatalogModel("qwen3-coder-plus", composite); got != "qwen/qwen3-coder-plus" {
		t.Fatalf("accountCatalogModel(qwen) = %q, want qwen/qwen3-coder-plus", got)
	}

	bare := []modelcatalog.Model{{ID: "claude-sonnet-4.6"}, {ID: "gpt-4.1"}}
	if got := accountCatalogModel("anthropic/claude-sonnet-4.6", bare); got != "claude-sonnet-4.6" {
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
