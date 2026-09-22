package engine

import (
	"strings"
	"testing"

	"github.com/MilkSU-Official/milksu/internal/config"
)

func TestResolveImageGenCredentialAccount(t *testing.T) {
	settings := config.AppSettings{
		ImageGenProvider: "tokenflux",
		ImageGenModel:    "openai/gpt-image-2",
		ImageGenSource:   "account",
		Relay: &config.RelayConfig{
			Enabled: true,
			Key:     "account-imagegen-key",
			URL:     "https://tokenflux.dev/v1",
		},
		ActiveProvider: "tokenflux",
		ActiveModel:    "deepseek/deepseek-flash",
		Providers: map[string]config.ProviderConfig{
			"tokenflux": {Enabled: true, APIKey: "personal-chat-key"},
		},
	}
	credential, ok := ResolveImageGenCredential(settings)
	if !ok {
		t.Fatal("expected account ImageGen credential")
	}
	if credential.APIKey != "account-imagegen-key" {
		t.Fatalf("api key = %q, want account key", credential.APIKey)
	}
	if credential.Model != "openai/gpt-image-2" {
		t.Fatalf("model = %q", credential.Model)
	}
	if credential.Model == settings.ActiveModel {
		t.Fatal("ImageGen must not reuse the chat active_model")
	}
}

func TestResolveImageGenCredentialRejectsMissingModel(t *testing.T) {
	settings := config.AppSettings{
		Relay: &config.RelayConfig{Enabled: true, Key: "account-key"},
		Providers: map[string]config.ProviderConfig{
			"tokenflux": {Enabled: true, APIKey: "personal"},
		},
	}
	if _, ok := ResolveImageGenCredential(settings); ok {
		t.Fatal("empty ImageGen selection must be unavailable")
	}
}

func TestAppendImageGenEnvironmentIsolatesRoute(t *testing.T) {
	baseURL := "https://tokenflux.dev/v1"
	settings := config.AppSettings{
		ImageGenProvider: "tokenflux",
		ImageGenModel:    "xai/grok-imagine-image",
		ImageGenSource:   "personal",
		Providers: map[string]config.ProviderConfig{
			"tokenflux": {
				Enabled: true,
				APIKey:  "personal-imagegen",
				BaseURL: &baseURL,
			},
		},
	}
	env := appendImageGenEnvironment(nil, settings)
	joined := strings.Join(env, "\n")
	if !strings.Contains(joined, "MILKSU_IMAGEGEN_MODEL=xai/grok-imagine-image") {
		t.Fatalf("missing model env: %v", env)
	}
	if !strings.Contains(joined, "MILKSU_IMAGEGEN_API_KEY=personal-imagegen") {
		t.Fatalf("missing key env: %v", env)
	}
	if strings.Contains(joined, "OPENAI_API_KEY=") {
		t.Fatal("ImageGen must not inject OPENAI_API_KEY")
	}
}
