package modelcatalog

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/MilkSU-Official/milksu/internal/config"
)

const (
	ProviderTokenFlux         = "tokenflux"
	defaultTokenFluxBaseURL   = "https://tokenflux.dev/v1"
	publicTokenFluxCatalogURL = "https://tokenflux.dev/v1/models"
	catalogSchema             = "milksu-model-catalog/v1"
	defaultMaxTokens          = 32_768
	maxCatalogResponseBytes   = 8 << 20
)

type Model struct {
	ID            string   `json:"id"`
	Name          string   `json:"name"`
	ContextWindow int      `json:"context_window"`
	MaxTokens     int      `json:"max_tokens"`
	Input         []string `json:"input"`
}

type Snapshot struct {
	Schema      string  `json:"schema"`
	Provider    string  `json:"provider"`
	Models      []Model `json:"models"`
	RefreshedAt string  `json:"refreshed_at,omitempty"`
	Source      string  `json:"source"`
}

type Options struct {
	Client           *http.Client
	Now              func() time.Time
	PublicCatalogURL string
}

type Service struct {
	mu               sync.RWMutex
	cachePath        string
	settings         func() config.AppSettings
	client           *http.Client
	now              func() time.Time
	publicCatalogURL string
	snapshot         Snapshot
}

func New(
	dataDirectory string,
	settings func() config.AppSettings,
	options Options,
) (*Service, error) {
	if strings.TrimSpace(dataDirectory) == "" {
		return nil, errors.New("model catalog data directory is required")
	}
	if settings == nil {
		return nil, errors.New("model catalog settings provider is required")
	}
	client := options.Client
	if client == nil {
		client = &http.Client{Timeout: 12 * time.Second}
	}
	now := options.Now
	if now == nil {
		now = time.Now
	}
	publicURL := strings.TrimSpace(options.PublicCatalogURL)
	if publicURL == "" {
		publicURL = publicTokenFluxCatalogURL
	}
	service := &Service{
		cachePath:        filepath.Join(dataDirectory, "model-catalog", "tokenflux.json"),
		settings:         settings,
		client:           client,
		now:              now,
		publicCatalogURL: publicURL,
		snapshot:         fallbackSnapshot(),
	}
	if cached, err := readSnapshot(service.cachePath); err == nil {
		cached.Source = "cache"
		service.snapshot = cached
	} else if err := writeSnapshot(service.cachePath, service.snapshot); err != nil {
		return nil, fmt.Errorf("initialize model catalog cache: %w", err)
	}
	return service, nil
}

func (s *Service) CachePath() string {
	return s.cachePath
}

func (s *Service) Snapshot() Snapshot {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return cloneSnapshot(s.snapshot)
}

func (s *Service) Refresh(ctx context.Context) (Snapshot, error) {
	candidates := catalogCandidates(s.settings(), s.publicCatalogURL)
	var failures []error
	for _, candidate := range candidates {
		models, err := s.fetch(ctx, candidate)
		if err != nil {
			failures = append(failures, err)
			continue
		}
		next := Snapshot{
			Schema:      catalogSchema,
			Provider:    ProviderTokenFlux,
			Models:      models,
			RefreshedAt: s.now().UTC().Format(time.RFC3339),
			Source:      "remote",
		}
		if err := writeSnapshot(s.cachePath, next); err != nil {
			return s.Snapshot(), fmt.Errorf("cache model catalog: %w", err)
		}
		s.mu.Lock()
		s.snapshot = next
		s.mu.Unlock()
		return cloneSnapshot(next), nil
	}
	if len(failures) == 0 {
		return s.Snapshot(), errors.New("no model catalog endpoint is available")
	}
	return s.Snapshot(), fmt.Errorf("refresh TokenFlux model catalog: %w", errors.Join(failures...))
}

type catalogCandidate struct {
	url string
	key string
}

func catalogCandidates(settings config.AppSettings, publicURL string) []catalogCandidate {
	result := make([]catalogCandidate, 0, 3)
	seen := make(map[string]bool, 3)
	add := func(baseURL, key string, alreadyCatalogURL bool) {
		baseURL = strings.TrimSpace(baseURL)
		if baseURL == "" {
			return
		}
		catalogURL := baseURL
		if !alreadyCatalogURL {
			catalogURL = strings.TrimRight(baseURL, "/") + "/models"
		}
		if seen[catalogURL] {
			return
		}
		seen[catalogURL] = true
		result = append(result, catalogCandidate{url: catalogURL, key: strings.TrimSpace(key)})
	}
	if provider, ok := settings.Providers[ProviderTokenFlux]; ok && provider.Enabled && provider.APIKey != "" {
		baseURL := defaultTokenFluxBaseURL
		if provider.BaseURL != nil && strings.TrimSpace(*provider.BaseURL) != "" {
			baseURL = strings.TrimSpace(*provider.BaseURL)
		}
		add(baseURL, provider.APIKey, false)
	}
	if relay := settings.Relay; relay != nil && relay.Enabled && relay.Key != "" {
		baseURL := strings.TrimSpace(relay.URL)
		if baseURL == "" {
			baseURL = defaultTokenFluxBaseURL
		}
		add(baseURL, relay.Key, false)
	}
	add(publicURL, "", true)
	return result
}

func (s *Service) fetch(ctx context.Context, candidate catalogCandidate) ([]Model, error) {
	parsed, err := url.Parse(candidate.url)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return nil, errors.New("model catalog endpoint is invalid")
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, parsed.String(), nil)
	if err != nil {
		return nil, fmt.Errorf("create model catalog request: %w", err)
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("User-Agent", "MilkSU/model-catalog")
	if candidate.key != "" {
		request.Header.Set("Authorization", "Bearer "+candidate.key)
	}
	response, err := s.client.Do(request)
	if err != nil {
		return nil, errors.New("model catalog request failed")
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 4<<10))
		return nil, fmt.Errorf("model catalog returned HTTP %d", response.StatusCode)
	}
	var payload tokenFluxResponse
	decoder := json.NewDecoder(io.LimitReader(response.Body, maxCatalogResponseBytes))
	if err := decoder.Decode(&payload); err != nil {
		return nil, errors.New("model catalog returned invalid JSON")
	}
	models := normalizeModels(payload.Data)
	if len(models) == 0 {
		return nil, errors.New("model catalog did not contain usable chat models")
	}
	return models, nil
}

type tokenFluxResponse struct {
	Data []struct {
		ID            string `json:"id"`
		Name          string `json:"name"`
		Type          string `json:"type"`
		ContextLength int    `json:"context_length"`
		Architecture  struct {
			InputModalities []string `json:"input_modalities"`
		} `json:"architecture"`
	} `json:"data"`
}

func normalizeModels(values []struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	Type          string `json:"type"`
	ContextLength int    `json:"context_length"`
	Architecture  struct {
		InputModalities []string `json:"input_modalities"`
	} `json:"architecture"`
}) []Model {
	result := make([]Model, 0, len(values))
	seen := make(map[string]bool, len(values))
	for _, value := range values {
		id := strings.TrimSpace(value.ID)
		if id == "" || len(id) > 256 || seen[id] || strings.ContainsAny(id, "\x00\r\n\t ") {
			continue
		}
		if kind := strings.TrimSpace(value.Type); kind != "" && kind != "chat" && kind != "model" {
			continue
		}
		input := normalizeInput(value.Architecture.InputModalities)
		// TokenFlux currently exposes model availability and, when present,
		// architecture metadata. grok-4.5 also has a retained packaged-App
		// image-input receipt, so keep that verified capability even when an
		// otherwise valid catalog response omits architecture. Do not infer the
		// same capability for adjacent Grok versions.
		if verifiedImageInputModel(id) && !contains(input, "image") {
			input = append(input, "image")
		}
		if !contains(input, "text") {
			continue
		}
		contextWindow := value.ContextLength
		if contextWindow <= 0 {
			contextWindow = 128_000
		}
		name := strings.TrimSpace(value.Name)
		if name == "" {
			name = id
		}
		seen[id] = true
		result = append(result, Model{
			ID: id, Name: name, ContextWindow: contextWindow,
			MaxTokens: defaultMaxTokens, Input: input,
		})
	}
	sort.SliceStable(result, func(left, right int) bool {
		leftPriority := modelPriority(result[left].ID)
		rightPriority := modelPriority(result[right].ID)
		if leftPriority != rightPriority {
			return leftPriority < rightPriority
		}
		return result[left].ID < result[right].ID
	})
	return result
}

func normalizeInput(values []string) []string {
	result := make([]string, 0, 2)
	for _, value := range values {
		value = strings.TrimSpace(strings.ToLower(value))
		if (value == "text" || value == "image") && !contains(result, value) {
			result = append(result, value)
		}
	}
	if len(result) == 0 {
		return []string{"text"}
	}
	return result
}

func modelPriority(id string) int {
	for index, prefix := range []string{
		"x-ai/grok-", "grok-", "openai/", "anthropic/", "deepseek/", "google/", "qwen/",
	} {
		if strings.HasPrefix(id, prefix) {
			return index
		}
	}
	return 100
}

func contains(values []string, expected string) bool {
	for _, value := range values {
		if value == expected {
			return true
		}
	}
	return false
}

func verifiedImageInputModel(id string) bool {
	switch strings.TrimSpace(id) {
	case "grok-4.5", "x-ai/grok-4.5":
		return true
	default:
		return false
	}
}

func readSnapshot(path string) (Snapshot, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return Snapshot{}, err
	}
	var value Snapshot
	if err := json.Unmarshal(data, &value); err != nil {
		return Snapshot{}, err
	}
	if value.Schema != catalogSchema ||
		value.Provider != ProviderTokenFlux ||
		len(value.Models) == 0 {
		return Snapshot{}, errors.New("cached model catalog is incomplete")
	}
	value.Models = cloneModels(value.Models)
	return value, nil
}

func writeSnapshot(path string, value Snapshot) error {
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	data = append(data, '\n')
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	temporary, err := os.CreateTemp(filepath.Dir(path), ".model-catalog-*")
	if err != nil {
		return err
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(0o600); err != nil {
		temporary.Close()
		return err
	}
	if _, err := temporary.Write(data); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Sync(); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	return os.Rename(temporaryPath, path)
}

func fallbackSnapshot() Snapshot {
	models := []Model{
		{ID: "x-ai/grok-4.6", Name: "Grok 4.6", ContextWindow: 500_000, MaxTokens: defaultMaxTokens, Input: []string{"text"}},
		{ID: "x-ai/grok-4.5", Name: "Grok 4.5", ContextWindow: 500_000, MaxTokens: defaultMaxTokens, Input: []string{"text", "image"}},
		{ID: "grok-4.3", Name: "Grok 4.3", ContextWindow: 1_000_000, MaxTokens: defaultMaxTokens, Input: []string{"text"}},
		{ID: "openai/gpt-5.6-sol", Name: "GPT-5.6 Sol", ContextWindow: 1_050_000, MaxTokens: defaultMaxTokens, Input: []string{"text"}},
		{ID: "openai/gpt-5.2-codex", Name: "GPT-5.2 Codex", ContextWindow: 400_000, MaxTokens: defaultMaxTokens, Input: []string{"text"}},
		{ID: "anthropic/claude-sonnet-4.6", Name: "Claude Sonnet 4.6", ContextWindow: 1_000_000, MaxTokens: defaultMaxTokens, Input: []string{"text"}},
		{ID: "deepseek/deepseek-v4-flash", Name: "DeepSeek V4 Flash", ContextWindow: 1_048_576, MaxTokens: defaultMaxTokens, Input: []string{"text"}},
		{ID: "google/gemini-3.1-pro-preview", Name: "Gemini 3.1 Pro Preview", ContextWindow: 1_048_576, MaxTokens: defaultMaxTokens, Input: []string{"text"}},
		{ID: "qwen/qwen3-coder-plus", Name: "Qwen3 Coder Plus", ContextWindow: 1_000_000, MaxTokens: defaultMaxTokens, Input: []string{"text"}},
	}
	return Snapshot{
		Schema: catalogSchema, Provider: ProviderTokenFlux,
		Models: models, Source: "bundled",
	}
}

func cloneSnapshot(value Snapshot) Snapshot {
	value.Models = cloneModels(value.Models)
	return value
}

func cloneModels(values []Model) []Model {
	result := make([]Model, len(values))
	for index, value := range values {
		value.Input = append([]string(nil), value.Input...)
		result[index] = value
	}
	return result
}
