package config

import "testing"

func TestNormalizeImageGenSettingsRejectsChatModelsOnTokenFlux(t *testing.T) {
	settings := AppSettings{
		ImageGenProvider: "tokenflux",
		ImageGenModel:    "deepseek/deepseek-flash",
		ImageGenSource:   "account",
	}
	next := normalizeImageGenSettings(settings)
	if next.ImageGenModel != DefaultImageGenModel {
		t.Fatalf("model = %q, want curated default %q", next.ImageGenModel, DefaultImageGenModel)
	}
}

func TestNormalizeImageGenSettingsEmptyMeansOff(t *testing.T) {
	next := normalizeImageGenSettings(AppSettings{})
	if next.ImageGenProvider != "" || next.ImageGenModel != "" || next.ImageGenSource != "" {
		t.Fatalf("expected empty ImageGen selection, got %#v", next)
	}
}

func TestResolveImageGenModelConfigured(t *testing.T) {
	settings := AppSettings{
		ImageGenProvider: "tokenflux",
		ImageGenModel:    "xai/grok-imagine-image",
		ImageGenSource:   "personal",
	}
	selection, ok := ResolveImageGenModel(settings)
	if !ok {
		t.Fatal("expected configured ImageGen selection")
	}
	if selection.Model != "xai/grok-imagine-image" || selection.Source != "personal" {
		t.Fatalf("selection = %#v", selection)
	}
}
