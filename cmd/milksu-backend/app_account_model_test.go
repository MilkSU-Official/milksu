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
