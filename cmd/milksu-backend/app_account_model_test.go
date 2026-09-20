package main

import (
	"testing"

	"github.com/MilkSU-Official/milksu/internal/config"
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

func TestAccountCatalogModelUsesCatalogThinkingSuffix(t *testing.T) {
	models := []modelcatalog.Model{
		{ID: "deepseek/deepseek-flash"},
		{ID: "google/gemini-3.1-pro-high"},
		{ID: "google/gemini-3.8-flash-tiered"},
	}
	if got := accountCatalogModel("google/gemini-3.8-flash", models); got != "google/gemini-3.8-flash-tiered" {
		t.Fatalf("accountCatalogModel(flash->tiered) = %q, want google/gemini-3.8-flash-tiered", got)
	}
	if got := accountCatalogModel("gemini-3.8-flash", models); got != "google/gemini-3.8-flash-tiered" {
		t.Fatalf("accountCatalogModel(bare flash->tiered) = %q, want google/gemini-3.8-flash-tiered", got)
	}
	if got := accountCatalogModel("google/gemini-3.8-flash-tiered", models); got != "google/gemini-3.8-flash-tiered" {
		t.Fatalf("accountCatalogModel exact tiered = %q", got)
	}
}

func TestAlignCompanionModelFollowsCatalogSuffix(t *testing.T) {
	settings := config.DefaultSettings()
	settings.CompanionProvider = "tokenflux"
	settings.CompanionModel = "google/gemini-3.8-flash"
	next := alignCompanionModel(settings, modelcatalog.Snapshot{
		Models: []modelcatalog.Model{
			{ID: "google/gemini-3.8-flash-tiered"},
			{ID: "google/gemini-3.1-pro-high"},
		},
	})
	if next.CompanionModel != "google/gemini-3.8-flash-tiered" {
		t.Fatalf("companion model = %q, want google/gemini-3.8-flash-tiered", next.CompanionModel)
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
