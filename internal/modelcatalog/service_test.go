package modelcatalog

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
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
					"id": "grok-4.6", "name": "Grok 4.6", "type": "model",
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
	if refreshed.Source != "remote" || refreshed.RefreshedAt != "2026-08-13T12:30:00Z" ||
		refreshed.CredentialSource != CredentialSourcePersonal {
		t.Fatalf("unexpected refreshed snapshot: %#v", refreshed)
	}
	if len(refreshed.Models) != 1 || refreshed.Models[0].ID != "grok-4.6" {
		t.Fatalf("unexpected models: %#v", refreshed.Models)
	}
	if strings.Join(refreshed.Models[0].Input, ",") != "text,image" {
		t.Fatalf("unsupported input modalities were not removed: %#v", refreshed.Models[0].Input)
	}
	info, err := os.Stat(service.CachePath())
	if err != nil {
		t.Fatal(err)
	}
	// Go exposes only a limited Windows file-mode projection; it cannot be
	// treated as a POSIX permission check for the underlying Windows ACL.
	if runtime.GOOS != "windows" && info.Mode().Perm() != 0o600 {
		t.Fatalf("catalog cache permissions = %o, want 600", info.Mode().Perm())
	}

	restarted, err := New(dataDirectory, func() config.AppSettings { return config.DefaultSettings() }, Options{
		Client: server.Client(), PublicCatalogURL: server.URL + "/public-models",
	})
	if err != nil {
		t.Fatal(err)
	}
	cached := restarted.Snapshot()
	if cached.Source != "cache" || cached.CredentialSource != CredentialSourcePersonal ||
		len(cached.Models) != 1 || cached.Models[0].ID != "grok-4.6" {
		t.Fatalf("restart did not load last-known-good catalog: %#v", cached)
	}
}

func TestRefreshMergesAccountAndPersonalCatalogs(t *testing.T) {
	var requested []string
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		auth := request.Header.Get("Authorization")
		requested = append(requested, auth)
		writer.Header().Set("Content-Type", "application/json")
		switch auth {
		case "Bearer account-secret":
			_ = json.NewEncoder(writer).Encode(map[string]any{
				"data": []map[string]any{{"id": "grok-4.5", "type": "model"}},
			})
		case "Bearer personal-secret":
			_ = json.NewEncoder(writer).Encode(map[string]any{
				"data": []map[string]any{
					{"id": "GPT/gpt-5", "type": "model"},
					{"id": "Claude/claude-sonnet-4", "type": "model"},
				},
			})
		default:
			http.Error(writer, "unexpected key", http.StatusUnauthorized)
		}
	}))
	defer server.Close()

	baseURL := server.URL + "/v1"
	settings := config.DefaultSettings()
	settings.Providers[ProviderTokenFlux] = config.ProviderConfig{
		APIKey: "personal-secret", BaseURL: &baseURL, Enabled: true,
	}
	settings.Relay = &config.RelayConfig{
		Enabled: true, URL: baseURL, Key: "account-secret",
	}
	service, err := New(t.TempDir(), func() config.AppSettings { return settings }, Options{
		Client: server.Client(), PublicCatalogURL: server.URL + "/public-models",
	})
	if err != nil {
		t.Fatal(err)
	}
	refreshed, err := service.Refresh(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(requested) != 2 ||
		requested[0] != "Bearer account-secret" ||
		requested[1] != "Bearer personal-secret" {
		t.Fatalf("catalog credential order = %#v, want account then personal", requested)
	}
	if refreshed.CredentialSource != CredentialSourceMerged {
		t.Fatalf("credential source = %q, want merged", refreshed.CredentialSource)
	}
	if refreshed.KeyShape != KeyShapeMixed {
		t.Fatalf("key shape = %q, want mixed", refreshed.KeyShape)
	}
	ids := make([]string, 0, len(refreshed.Models))
	for _, model := range refreshed.Models {
		ids = append(ids, model.ID)
	}
	if strings.Join(ids, ",") != "grok-4.5,Claude/claude-sonnet-4,GPT/gpt-5" &&
		!containsAll(ids, "grok-4.5", "GPT/gpt-5", "Claude/claude-sonnet-4") {
		t.Fatalf("merged models = %#v", ids)
	}
	if strings.Join(refreshed.AccountModelIDs, ",") != "grok-4.5" {
		t.Fatalf("account model ids = %#v, want [grok-4.5]", refreshed.AccountModelIDs)
	}
}

func containsAll(values []string, expected ...string) bool {
	seen := map[string]bool{}
	for _, value := range values {
		seen[value] = true
	}
	for _, value := range expected {
		if !seen[value] {
			return false
		}
	}
	return true
}

func TestDetectKeyShapeClassifiesCompositeCatalog(t *testing.T) {
	if got := detectKeyShape([]Model{{ID: "GPT/gpt-5"}, {ID: "Claude/claude-sonnet-4"}}); got != KeyShapeComposite {
		t.Fatalf("composite shape = %q", got)
	}
	if got := detectKeyShape([]Model{{ID: "grok-4.5"}, {ID: "grok-4.6"}}); got != KeyShapeSingle {
		t.Fatalf("single shape = %q", got)
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
	if after.Source != "bundled" || after.CredentialSource != CredentialSourceBundled ||
		len(after.Models) != len(before.Models) {
		t.Fatalf("failure did not preserve bundled catalog: %#v", after)
	}
	if strings.Join(before.Models[0].Input, ",") != "text" {
		t.Fatalf("Grok 4.6 must not inherit unverified image input: %#v", before.Models[0])
	}
	if strings.Join(before.Models[1].Input, ",") != "text,image" {
		t.Fatalf("verified Grok 4.5 image input is missing: %#v", before.Models[1])
	}
}

func TestNewReplacesUnversionedCapabilityCache(t *testing.T) {
	dataDirectory := t.TempDir()
	cachePath := filepath.Join(dataDirectory, "model-catalog", "tokenflux.json")
	if err := os.MkdirAll(filepath.Dir(cachePath), 0o700); err != nil {
		t.Fatal(err)
	}
	legacy := `{
		"provider":"tokenflux",
		"source":"bundled",
		"models":[{"id":"x-ai/grok-4.6","name":"Grok 4.6","context_window":500000,"max_tokens":32768,"input":["text","image"]}]
	}`
	if err := os.WriteFile(cachePath, []byte(legacy), 0o600); err != nil {
		t.Fatal(err)
	}
	service, err := New(
		dataDirectory,
		func() config.AppSettings { return config.DefaultSettings() },
		Options{},
	)
	if err != nil {
		t.Fatal(err)
	}
	snapshot := service.Snapshot()
	if snapshot.Schema != catalogSchema || snapshot.Source != "bundled" {
		t.Fatalf("legacy cache was not replaced: %#v", snapshot)
	}
	if len(snapshot.Models) == 0 || strings.Join(snapshot.Models[0].Input, ",") != "text" {
		t.Fatalf("legacy unverified Grok 4.6 image input survived: %#v", snapshot.Models)
	}
}

func TestNormalizeModelsKeepsOnlyVerifiedOrDeclaredImageInput(t *testing.T) {
	var payload tokenFluxResponse
	if err := json.Unmarshal([]byte(`{
		"data": [
			{"id":"grok-4.5","type":"model","architecture":{"input_modalities":["text"]}},
			{"id":"grok-4.6","type":"model","architecture":{"input_modalities":["text"]}},
			{"id":"x-ai/grok-4.6","type":"model","architecture":{"input_modalities":["text","image"]}}
		]
	}`), &payload); err != nil {
		t.Fatal(err)
	}
	models := normalizeModels(payload.Data)
	inputs := make(map[string]string, len(models))
	for _, model := range models {
		inputs[model.ID] = strings.Join(model.Input, ",")
	}
	if inputs["grok-4.5"] != "text,image" {
		t.Fatalf("verified Grok 4.5 capability = %q, want text,image", inputs["grok-4.5"])
	}
	if inputs["grok-4.6"] != "text" {
		t.Fatalf("undeclared Grok 4.6 capability = %q, want text", inputs["grok-4.6"])
	}
	if inputs["x-ai/grok-4.6"] != "text,image" {
		t.Fatalf("declared Grok 4.6 capability = %q, want text,image", inputs["x-ai/grok-4.6"])
	}
}

func TestNewRebuildsCatalogWithoutCredentialSource(t *testing.T) {
	dataDirectory := t.TempDir()
	catalogDirectory := filepath.Join(dataDirectory, "model-catalog")
	if err := os.MkdirAll(catalogDirectory, 0o700); err != nil {
		t.Fatal(err)
	}
	legacy := `{"schema":"milksu-model-catalog/v1","provider":"tokenflux","source":"remote","models":[{"id":"grok-4.5"}]}`
	if err := os.WriteFile(filepath.Join(catalogDirectory, "tokenflux.json"), []byte(legacy), 0o600); err != nil {
		t.Fatal(err)
	}
	service, err := New(dataDirectory, func() config.AppSettings { return config.DefaultSettings() }, Options{})
	if err != nil {
		t.Fatal(err)
	}
	snapshot := service.Snapshot()
	if snapshot.Source != "bundled" || snapshot.CredentialSource != CredentialSourceBundled {
		t.Fatalf("invalid cache was not rebuilt: %#v", snapshot)
	}
}
