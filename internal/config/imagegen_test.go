package config

import "testing"

func TestNormalizeImageGenSettingsClearsChatModels(t *testing.T) {
	settings := AppSettings{
		ImageGenProvider: "tokenflux",
		ImageGenModel:    "deepseek/deepseek-flash",
		ImageGenSource:   "account",
	}
	next := normalizeImageGenSettings(settings)
	if next.ImageGenProvider != "" || next.ImageGenModel != "" || next.ImageGenSource != "" {
		t.Fatalf("chat model should clear ImageGen, got %#v", next)
	}
	bare := normalizeImageGenSettings(AppSettings{
		ImageGenProvider: "tokenflux",
		ImageGenModel:    "openai/gpt-image-2",
		ImageGenSource:   "account",
	})
	if bare.ImageGenModel != "" {
		t.Fatalf("prefix without -image is not an image route: %#v", bare)
	}
}

func TestNormalizeImageGenSettingsKeepsLiveImageRoute(t *testing.T) {
	settings := AppSettings{
		ImageGenProvider: "tokenflux",
		ImageGenModel:    "openai-image/gpt-image-2",
		ImageGenSource:   "personal",
	}
	next := normalizeImageGenSettings(settings)
	if next.ImageGenModel != "openai-image/gpt-image-2" || next.ImageGenSource != "personal" {
		t.Fatalf("image route = %#v", next)
	}
}

func TestNormalizeImageGenSettingsEmptyMeansOff(t *testing.T) {
	next := normalizeImageGenSettings(AppSettings{})
	if next.ImageGenProvider != "" || next.ImageGenModel != "" || next.ImageGenSource != "" {
		t.Fatalf("expected empty ImageGen selection, got %#v", next)
	}
	partial := normalizeImageGenSettings(AppSettings{ImageGenProvider: "tokenflux"})
	if partial.ImageGenModel != "" || partial.ImageGenProvider != "" {
		t.Fatalf("provider without a model must stay off, got %#v", partial)
	}
}

func TestResolveImageGenModelConfigured(t *testing.T) {
	settings := AppSettings{
		ImageGenProvider: "tokenflux",
		ImageGenModel:    "x-ai-image/grok-imagine-image-2.0",
		ImageGenSource:   "personal",
	}
	selection, ok := ResolveImageGenModel(settings)
	if !ok {
		t.Fatal("expected configured ImageGen selection")
	}
	if selection.Model != "x-ai-image/grok-imagine-image-2.0" || selection.Source != "personal" {
		t.Fatalf("selection = %#v", selection)
	}
}
