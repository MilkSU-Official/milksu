package modelcatalog

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/MilkSU-Official/milksu/internal/config"
)

func TestRefreshUpdatesCatalogAndRestartLoadsCache(t *testing.T) {
	var requestedAuthorization string
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		requestedAuthorization = request.Header.Get("Authorization")
		writer.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(writer).Encode(map[string]any{
			"data": []map[string]any{
				{
					"id": "x-ai/grok-4.6", "name": "Grok 4.6", "type": "chat",
					"context_length": 500000,
					"architecture":   map[string]any{"input_modalities": []string{"text", "image", "file"}},
				},
				{
					"id": "qwen/embedding", "name": "Embedding", "type": "embedding",
					"context_length": 8192,
					"architecture":   map[string]any{"input_modalities": []string{"text"}},
				},
			},
		})
	}))
	defer server.Close()

	baseURL := server.URL + "/v1"
	settings := config.DefaultSettings()
	settings.Providers[ProviderTokenFlux] = config.ProviderConfig{
		APIKey: "catalog-secret", BaseURL: &baseURL, Enabled: true,
	}
	dataDirectory := t.TempDir()
	now := time.Date(2026, 8, 13, 12, 30, 0, 0, time.UTC)
	service, err := New(dataDirectory, func() config.AppSettings { return settings }, Options{
		Client: server.Client(), Now: func() time.Time { return now },
		PublicCatalogURL: server.URL + "/public-models",
	})
	if err != nil {
		t.Fatal(err)
	}
	refreshed, err := service.Refresh(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if requestedAuthorization != "Bearer catalog-secret" {
		t.Fatalf("authenticated relay catalog was not preferred: %q", requestedAuthorization)
	}
	if refreshed.Source != "remote" || refreshed.RefreshedAt != "2026-08-13T12:30:00Z" {
		t.Fatalf("unexpected refreshed snapshot: %#v", refreshed)
	}
	if len(refreshed.Models) != 1 || refreshed.Models[0].ID != "x-ai/grok-4.6" {
		t.Fatalf("unexpected models: %#v", refreshed.Models)
	}
	if strings.Join(refreshed.Models[0].Input, ",") != "text,image" {
		t.Fatalf("unsupported input modalities were not removed: %#v", refreshed.Models[0].Input)
	}
	info, err := os.Stat(service.CachePath())
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("catalog cache permissions = %o, want 600", info.Mode().Perm())
	}

	restarted, err := New(dataDirectory, func() config.AppSettings { return config.DefaultSettings() }, Options{
		Client: server.Client(), PublicCatalogURL: server.URL + "/public-models",
	})
	if err != nil {
		t.Fatal(err)
	}
	cached := restarted.Snapshot()
	if cached.Source != "cache" || len(cached.Models) != 1 || cached.Models[0].ID != "x-ai/grok-4.6" {
		t.Fatalf("restart did not load last-known-good catalog: %#v", cached)
	}
}

func TestRefreshFailureKeepsBundledCatalog(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		http.Error(writer, "unavailable", http.StatusServiceUnavailable)
	}))
	defer server.Close()
	service, err := New(t.TempDir(), func() config.AppSettings { return config.DefaultSettings() }, Options{
		Client: server.Client(), PublicCatalogURL: server.URL,
	})
	if err != nil {
		t.Fatal(err)
	}
	before := service.Snapshot()
	if len(before.Models) < 2 ||
		before.Models[0].ID != "x-ai/grok-4.6" ||
		before.Models[1].ID != "x-ai/grok-4.5" {
		t.Fatalf("bundled catalog does not prefer Grok 4.6 with Grok 4.5 available: %#v", before.Models)
	}
	after, err := service.Refresh(context.Background())
	if err == nil {
		t.Fatal("expected refresh failure")
	}
	if after.Source != "bundled" || len(after.Models) != len(before.Models) {
		t.Fatalf("failure did not preserve bundled catalog: %#v", after)
	}
}
