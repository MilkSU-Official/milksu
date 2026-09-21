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
	settings.CompanionSource = config.ModelSourceAccount
	next, notice := alignCompanionModel(settings, modelcatalog.Snapshot{
		Models: []modelcatalog.Model{
			{ID: "google/gemini-3.8-flash-tiered"},
			{ID: "google/gemini-3.1-pro-high"},
		},
	})
	if next.CompanionModel != "google/gemini-3.8-flash-tiered" {
		t.Fatalf("companion model = %q, want google/gemini-3.8-flash-tiered", next.CompanionModel)
	}
	if notice {
		t.Fatal("a catalog suffix of the same model should not raise a replacement notice")
	}
}

func TestAlignCompanionModelKeepsAccountDeepSeekDefault(t *testing.T) {
	settings := config.DefaultSettings()
	settings.CompanionProvider = config.DefaultCompanionProvider
	settings.CompanionModel = config.DefaultCompanionModel
	settings.CompanionSource = config.DefaultCompanionSource
	next, notice := alignCompanionModel(settings, modelcatalog.Snapshot{
		Models: []modelcatalog.Model{
			{ID: "deepseek/deepseek-flash"},
			{ID: "google/gemini-3.8-flash-tiered"},
		},
	})
	if notice {
		t.Fatal("keeping the account default should not raise a replacement notice")
	}
	if next.CompanionProvider != "tokenflux" || next.CompanionModel != "deepseek/deepseek-flash" {
		t.Fatalf("companion default = %s/%s, want tokenflux/deepseek/deepseek-flash", next.CompanionProvider, next.CompanionModel)
	}
	if next.CompanionSource != "account" {
		t.Fatalf("companion source = %q, want account", next.CompanionSource)
	}
}

func TestAlignCompanionModelSkipsPersonalSource(t *testing.T) {
	settings := config.DefaultSettings()
	settings.CompanionSource = config.ModelSourcePersonal
	settings.CompanionProvider = "tokenflux"
	settings.CompanionModel = "my-personal-model"
	next, notice := alignCompanionModel(settings, modelcatalog.Snapshot{
		Models: []modelcatalog.Model{
			{ID: "grok-4.6"},
			{ID: "deepseek/deepseek-flash"},
		},
	})
	if next.CompanionModel != "my-personal-model" || next.CompanionSource != "personal" {
		t.Fatalf("personal companion model = %s/%s, want personal/my-personal-model", next.CompanionSource, next.CompanionModel)
	}
	if notice {
		t.Fatal("a personal companion model must not be rewritten when the account catalog refreshes")
	}
}

func TestAlignCompanionModelSkipsServiceSource(t *testing.T) {
	settings := config.DefaultSettings()
	settings.CompanionSource = "service"
	settings.CompanionProvider = "custom-relay-deepseek"
	settings.CompanionModel = "deepseek-chat"
	next, notice := alignCompanionModel(settings, modelcatalog.Snapshot{
		Models: []modelcatalog.Model{{ID: "grok-4.6"}},
	})
	if next.CompanionModel != "deepseek-chat" || next.CompanionProvider != "custom-relay-deepseek" {
		t.Fatalf("service companion model changed: %s/%s", next.CompanionProvider, next.CompanionModel)
	}
	if notice {
		t.Fatal("a service companion model must not be rewritten from the account catalog")
	}
}

func TestAlignCompanionModelNoticesWhenAccountModelLeavesCatalog(t *testing.T) {
	settings := config.DefaultSettings()
	settings.CompanionSource = config.ModelSourceAccount
	settings.CompanionProvider = "tokenflux"
	settings.CompanionModel = "openai/gpt-4.1"
	next, notice := alignCompanionModel(settings, modelcatalog.Snapshot{
		Models: []modelcatalog.Model{
			{ID: "grok-4.3"},
			{ID: "grok-4.6"},
		},
	})
	if next.CompanionModel != "grok-4.6" {
		t.Fatalf("account companion model = %q, want grok-4.6", next.CompanionModel)
	}
	if !notice {
		t.Fatal("an account companion model that left the catalog should raise a notice")
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
