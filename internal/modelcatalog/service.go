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
	CredentialSourceAccount   = "account"
	CredentialSourcePersonal  = "personal"
	CredentialSourceMerged    = "merged"
	CredentialSourcePublic    = "public"
	CredentialSourceBundled   = "bundled"
	KeyShapeSingle            = "single"
	KeyShapeComposite         = "composite"
	KeyShapeMixed             = "mixed"
	KeyShapeUnknown           = "unknown"
)

type Model struct {
	ID            string   `json:"id"`
	Name          string   `json:"name"`
	ContextWindow int      `json:"context_window"`
	MaxTokens     int      `json:"max_tokens"`
	Input         []string `json:"input"`
}

type Snapshot struct {
	Schema           string  `json:"schema"`
	Provider         string  `json:"provider"`
	Models           []Model `json:"models"`
	RefreshedAt      string  `json:"refreshed_at,omitempty"`
	Source           string  `json:"source"`
	CredentialSource string  `json:"credential_source"`
	KeyShape         string  `json:"key_shape,omitempty"`
	// AccountModelIDs lists models visible to the account TokenFlux key only.
	// Used so dual-source routing can skip the account path for personal-only models.
	AccountModelIDs []string `json:"account_model_ids,omitempty"`
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
		applyKnownContextWindows(cached.Models, config.AppSettings{})
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
	next := cloneSnapshot(s.snapshot)
	applyKnownContextWindows(next.Models, s.settings())
	return next
}

func applyKnownContextWindows(models []Model, settings config.AppSettings) {
	for index := range models {
		id := models[index].ID
		resolved := resolveModelContextWindow(id, models[index].ContextWindow)
		models[index].ContextWindow = config.ResolveModelContextWindow(
			settings,
			ProviderTokenFlux,
			id,
			resolved,
		)
	}
}

func (s *Service) Refresh(ctx context.Context) (Snapshot, error) {
	candidates := catalogCandidates(s.settings(), s.publicCatalogURL)
	var (
		failures       []error
		merged         []Model
		accountIDs     []string
		sources        []string
		shapes         []string
		usedCredential bool
	)
	for _, candidate := range candidates {
		// Public fallback is only used when no credentialed catalog succeeded.
		if candidate.credentialSource == CredentialSourcePublic && usedCredential {
			continue
		}
		models, err := s.fetch(ctx, candidate)
		if err != nil {
			failures = append(failures, err)
			continue
		}
		shape := detectKeyShape(models)
		if candidate.credentialSource == CredentialSourceAccount ||
			candidate.credentialSource == CredentialSourcePersonal {
			usedCredential = true
			sources = append(sources, candidate.credentialSource)
			shapes = append(shapes, shape)
			if candidate.credentialSource == CredentialSourceAccount {
				accountIDs = modelIDs(models)
			}
			merged = mergeModels(merged, models)
			// Keep collecting credentialed catalogs so the picker shows every
			// model either the account or personal TokenFlux key can call.
			continue
		}
		// Public or other unauthenticated catalog: use only when nothing else worked.
		if len(merged) == 0 {
			next := Snapshot{
				Schema:           catalogSchema,
				Provider:         ProviderTokenFlux,
				Models:           models,
				RefreshedAt:      s.now().UTC().Format(time.RFC3339),
				Source:           "remote",
				CredentialSource: candidate.credentialSource,
				KeyShape:         shape,
			}
			if err := s.persist(next); err != nil {
				return s.Snapshot(), err
			}
			return cloneSnapshot(next), nil
		}
	}
	if len(merged) > 0 {
		next := Snapshot{
			Schema:           catalogSchema,
			Provider:         ProviderTokenFlux,
			Models:           merged,
			RefreshedAt:      s.now().UTC().Format(time.RFC3339),
			Source:           "remote",
			CredentialSource: mergeCredentialSources(sources),
			KeyShape:         mergeKeyShapes(shapes),
			AccountModelIDs:  accountIDs,
		}
		if err := s.persist(next); err != nil {
			return s.Snapshot(), err
		}
		return cloneSnapshot(next), nil
	}
	if len(failures) == 0 {
		return s.Snapshot(), errors.New("no model catalog endpoint is available")
	}
	return s.Snapshot(), fmt.Errorf("refresh TokenFlux model catalog: %w", errors.Join(failures...))
}

func (s *Service) persist(next Snapshot) error {
	applyKnownContextWindows(next.Models, config.AppSettings{})
	if err := writeSnapshot(s.cachePath, next); err != nil {
		return fmt.Errorf("cache model catalog: %w", err)
	}
	s.mu.Lock()
	s.snapshot = next
	s.mu.Unlock()
	return nil
}

type catalogCandidate struct {
	url              string
	key              string
	credentialSource string
}

func catalogCandidates(settings config.AppSettings, publicURL string) []catalogCandidate {
	result := make([]catalogCandidate, 0, 3)
	seen := make(map[string]bool, 3)
	add := func(baseURL, key, credentialSource string, alreadyCatalogURL bool) {
		baseURL = strings.TrimSpace(baseURL)
		if baseURL == "" {
			return
		}
		catalogURL := baseURL
		if !alreadyCatalogURL {
			catalogURL = strings.TrimRight(baseURL, "/") + "/models"
		}
		key = strings.TrimSpace(key)
		identity := catalogURL + "\x00" + key
		if seen[identity] {
			return
		}
		seen[identity] = true
		result = append(result, catalogCandidate{
			url: catalogURL, key: key, credentialSource: credentialSource,
		})
	}
	if relay := settings.Relay; relay != nil && relay.Enabled && relay.Key != "" {
		baseURL := strings.TrimSpace(relay.URL)
		if baseURL == "" {
			baseURL = defaultTokenFluxBaseURL
		}
		add(baseURL, relay.Key, CredentialSourceAccount, false)
	}
	if provider, ok := settings.Providers[ProviderTokenFlux]; ok && provider.Enabled && provider.APIKey != "" {
		baseURL := defaultTokenFluxBaseURL
		if provider.BaseURL != nil && strings.TrimSpace(*provider.BaseURL) != "" {
			baseURL = strings.TrimSpace(*provider.BaseURL)
		}
		add(baseURL, provider.APIKey, CredentialSourcePersonal, false)
	}
	add(publicURL, "", CredentialSourcePublic, true)
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

type catalogModelRaw struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	Type          string `json:"type"`
	ContextLength int    `json:"context_length"`
	ContextWindow int    `json:"context_window"`
	Architecture  struct {
		InputModalities []string `json:"input_modalities"`
	} `json:"architecture"`
}

type tokenFluxResponse struct {
	Data []catalogModelRaw `json:"data"`
}

func normalizeModels(values []catalogModelRaw) []Model {
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
		catalogWindow := value.ContextLength
		if catalogWindow <= 0 {
			catalogWindow = value.ContextWindow
		}
		contextWindow := resolveModelContextWindow(id, catalogWindow)
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
	// Prefer bare and common catalog shapes first, then any remaining ids.
	// User-defined composite prefixes (GPT/, Claude/, …) sort after known vendors.
	for index, prefix := range []string{
		"x-ai/grok-", "grok-", "openai/", "anthropic/", "deepseek/", "google/", "qwen/",
		"bailian/", "dashscope/",
	} {
		if strings.HasPrefix(id, prefix) {
			return index
		}
	}
	if strings.Contains(id, "/") {
		return 50
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
		// Composite keys may use a custom prefix; bare suffix still counts.
		if slash := strings.IndexByte(id, '/'); slash > 0 {
			return verifiedImageInputModel(id[slash+1:])
		}
		return false
	}
}

// detectKeyShape classifies a TokenFlux /models response.
// Composite keys return prefix/model ids (docs: composite-key.md). Single-group
// keys usually return bare ids. Mixed lists are reported as mixed.
func detectKeyShape(models []Model) string {
	if len(models) == 0 {
		return KeyShapeUnknown
	}
	prefixed := 0
	for _, model := range models {
		id := strings.TrimSpace(model.ID)
		if isCompositeCatalogID(id) {
			prefixed++
		}
	}
	switch {
	case prefixed == len(models):
		return KeyShapeComposite
	case prefixed == 0:
		return KeyShapeSingle
	default:
		return KeyShapeMixed
	}
}

func isCompositeCatalogID(id string) bool {
	slash := strings.IndexByte(id, '/')
	if slash <= 0 || slash >= len(id)-1 {
		return false
	}
	prefix := id[:slash]
	if len(prefix) > 32 {
		return false
	}
	for _, r := range prefix {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '_', r == '-':
		default:
			return false
		}
	}
	return true
}

func mergeModels(base, extra []Model) []Model {
	if len(base) == 0 {
		return cloneModels(extra)
	}
	if len(extra) == 0 {
		return cloneModels(base)
	}
	seen := make(map[string]bool, len(base)+len(extra))
	result := make([]Model, 0, len(base)+len(extra))
	for _, model := range base {
		id := strings.TrimSpace(model.ID)
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		result = append(result, model)
	}
	for _, model := range extra {
		id := strings.TrimSpace(model.ID)
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		result = append(result, model)
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

func modelIDs(models []Model) []string {
	result := make([]string, 0, len(models))
	seen := make(map[string]bool, len(models))
	for _, model := range models {
		id := strings.TrimSpace(model.ID)
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		result = append(result, id)
	}
	return result
}

func mergeCredentialSources(sources []string) string {
	hasAccount := false
	hasPersonal := false
	for _, source := range sources {
		switch source {
		case CredentialSourceAccount:
			hasAccount = true
		case CredentialSourcePersonal:
			hasPersonal = true
		}
	}
	switch {
	case hasAccount && hasPersonal:
		return CredentialSourceMerged
	case hasAccount:
		return CredentialSourceAccount
	case hasPersonal:
		return CredentialSourcePersonal
	default:
		return CredentialSourcePublic
	}
}

func mergeKeyShapes(shapes []string) string {
	seen := map[string]bool{}
	for _, shape := range shapes {
		if shape == "" || shape == KeyShapeUnknown {
			continue
		}
		seen[shape] = true
	}
	switch len(seen) {
	case 0:
		return KeyShapeUnknown
	case 1:
		for shape := range seen {
			return shape
		}
	}
	return KeyShapeMixed
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
		len(value.Models) == 0 ||
		!validCredentialSource(value.CredentialSource) {
		return Snapshot{}, errors.New("cached model catalog is incomplete")
	}
	if value.KeyShape == "" {
		value.KeyShape = detectKeyShape(value.Models)
	}
	value.Models = cloneModels(value.Models)
	value.AccountModelIDs = append([]string(nil), value.AccountModelIDs...)
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
		CredentialSource: CredentialSourceBundled,
		KeyShape:         detectKeyShape(models),
	}
}

func validCredentialSource(value string) bool {
	switch value {
	case CredentialSourceAccount, CredentialSourcePersonal, CredentialSourceMerged,
		CredentialSourcePublic, CredentialSourceBundled:
		return true
	default:
		return false
	}
}

func CatalogsEquivalent(left, right Snapshot) bool {
	if left.Provider != right.Provider ||
		left.CredentialSource != right.CredentialSource ||
		left.KeyShape != right.KeyShape ||
		len(left.Models) != len(right.Models) ||
		len(left.AccountModelIDs) != len(right.AccountModelIDs) {
		return false
	}
	for index := range left.AccountModelIDs {
		if left.AccountModelIDs[index] != right.AccountModelIDs[index] {
			return false
		}
	}
	for index := range left.Models {
		if left.Models[index].ID != right.Models[index].ID ||
			left.Models[index].Name != right.Models[index].Name ||
			left.Models[index].ContextWindow != right.Models[index].ContextWindow ||
			left.Models[index].MaxTokens != right.Models[index].MaxTokens {
			return false
		}
		if strings.Join(left.Models[index].Input, ",") != strings.Join(right.Models[index].Input, ",") {
			return false
		}
	}
	return true
}

func cloneSnapshot(value Snapshot) Snapshot {
	value.Models = cloneModels(value.Models)
	value.AccountModelIDs = append([]string(nil), value.AccountModelIDs...)
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
