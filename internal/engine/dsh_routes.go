package engine

import (
	"encoding/json"
	"os"
	"strings"

	"github.com/MilkSU-Official/milksu/internal/config"
	"github.com/MilkSU-Official/milksu/internal/modelcatalog"
)

// DSH 0.2 起 llm-deepseek 只说 Anthropic Messages；其余 provider 由官方
// dsh-llm-pi-ai 适配器路由。本文件合成 MILKSU_DSH_PI_AI_ROUTES——一份
// 非凭据的路由与模型事实（provider 名、端点、模型表、思考档位）——由
// Sidecar 渲染成 host patch 的 llm-pi-ai providers 配置。各 provider 的
// key 沿用 engineEnvironment 的既有注入（ANTHROPIC_API_KEY 等），不进
// 本 JSON；custom relay 保持 Pi 路径的窄边界（环境只持活跃 relay），不
// 在 DSH 多模型面展开。

const dshPIAIRoutesEnvironment = "MILKSU_DSH_PI_AI_ROUTES"

// dshRouteModel is one hand-declared model entry for a pi-ai provider route.
// ReasoningEfforts maps a selectable level to its wire spelling; "off" with an
// empty value means "send no reasoning parameter".
type dshRouteModel struct {
	ID               string            `json:"id"`
	Name             string            `json:"name,omitempty"`
	ContextWindow    int               `json:"contextWindow,omitempty"`
	MaxTokens        int               `json:"maxTokens,omitempty"`
	Image            bool              `json:"image,omitempty"`
	ReasoningEfforts map[string]string `json:"reasoningEfforts,omitempty"`
}

// dshPIAIRoute is one provider route. A route without API/BaseURL/Models is a
// catalog route: pi-ai's installed provider directory supplies the endpoint,
// protocol, and model list.
type dshPIAIRoute struct {
	API         string          `json:"api,omitempty"`
	BaseURL     string          `json:"baseURL,omitempty"`
	APIKeyEnv   string          `json:"apiKeyEnv"`
	DisplayName string          `json:"displayName,omitempty"`
	Models      []dshRouteModel `json:"models,omitempty"`
}

type dshPIAIRoutes struct {
	// DeepSeekOfficial marks the official DeepSeek key path active, keeping the
	// llm-deepseek row enabled with its advisory catalog.
	DeepSeekOfficial bool                    `json:"deepseekOfficial"`
	Providers        map[string]dshPIAIRoute `json:"providers,omitempty"`
}

// dshPIAICatalogProviders lists MilkSU provider ids whose pi-ai installed
// catalog route is mounted when a personal key exists. The ids must exist in
// the pi-ai version pinned through @deepseek-ai/dsh; deepseek is excluded
// because its official key travels through the llm-deepseek row instead.
var dshPIAICatalogProviders = []string{
	"anthropic",
	"baseten",
	"cerebras",
	"google",
	"groq",
	"huggingface",
	"kimi-coding",
	"minimax",
	"minimax-cn",
	"moonshotai",
	"moonshotai-cn",
	"nvidia",
	"openai",
	"openrouter",
	"together",
	"xai",
	"zai",
	"zai-coding-cn",
}

// dshTokenFluxKey resolves the TokenFlux credential the DSH multi-provider
// face may use: the personal provider key first, then the relay key.
func dshTokenFluxKey(settings config.AppSettings) string {
	if provider, exists := settings.Providers["tokenflux"]; exists {
		if key := strings.TrimSpace(provider.APIKey); key != "" && provider.Enabled {
			return key
		}
	}
	if relay := settings.Relay; relay != nil && relay.Enabled {
		if key := strings.TrimSpace(relay.Key); key != "" {
			return key
		}
	}
	return ""
}

func dshTokenFluxBaseURL(settings config.AppSettings) string {
	if relay := settings.Relay; relay != nil && relay.Enabled {
		if url := strings.TrimSpace(relay.URL); url != "" {
			return url
		}
	}
	return tokenfluxChatCompletionsURL
}

// dshTokenFluxRouteModels reads the TokenFlux catalog snapshot (the same
// cache file the Pi path consumes) and materializes the hand-declared model
// entries with MilkSU's thinking-level facts.
func dshTokenFluxRouteModels(settings config.AppSettings) ([]dshRouteModel, error) {
	path := strings.TrimSpace(settings.RuntimeModelCatalogPath)
	if path == "" {
		return nil, nil
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		// A missing or unreadable catalog leaves the route without models; the
		// snapshot refreshes on startup and the next spawn retries.
		return nil, nil
	}
	var snapshot modelcatalog.Snapshot
	if err := json.Unmarshal(raw, &snapshot); err != nil {
		return nil, nil
	}
	if snapshot.Provider != "tokenflux" {
		return nil, nil
	}
	models := make([]dshRouteModel, 0, len(snapshot.Models))
	for _, entry := range snapshot.Models {
		id := strings.TrimSpace(entry.ID)
		if id == "" || entry.ImageTransport != "" {
			continue
		}
		model := dshRouteModel{
			ID:            id,
			Name:          strings.TrimSpace(entry.Name),
			ContextWindow: entry.ContextWindow,
			MaxTokens:     entry.MaxTokens,
			Image:         hasModelInput(entry.Input, "image"),
		}
		if thinking := config.ResolveModelThinking(settings, "tokenflux", id, ""); thinking.Enabled {
			efforts := make(map[string]string, len(thinking.Levels))
			for _, level := range thinking.Levels {
				efforts[level] = level
			}
			model.ReasoningEfforts = efforts
		}
		models = append(models, model)
	}
	return models, nil
}

func hasModelInput(inputs []string, want string) bool {
	for _, input := range inputs {
		if strings.EqualFold(strings.TrimSpace(input), want) {
			return true
		}
	}
	return false
}

// composeDSHPIAIRoutes builds the non-credential route facts for one DSH
// sidecar spawn.
func composeDSHPIAIRoutes(settings config.AppSettings) dshPIAIRoutes {
	routes := dshPIAIRoutes{}
	if key := dshTokenFluxKey(settings); key != "" {
		if models, err := dshTokenFluxRouteModels(settings); err == nil && len(models) > 0 {
			routes.Providers = make(map[string]dshPIAIRoute)
			routes.Providers["tokenflux"] = dshPIAIRoute{
				API:         "openai-completions",
				BaseURL:     dshTokenFluxBaseURL(settings),
				APIKeyEnv:   "TOKENFLUX_API_KEY",
				DisplayName: "TokenFlux",
				Models:      models,
			}
		}
	}
	if routes.Providers == nil {
		routes.Providers = make(map[string]dshPIAIRoute)
	}
	for _, name := range dshPIAICatalogProviders {
		provider, exists := settings.Providers[name]
		if !exists || !provider.Enabled || strings.TrimSpace(provider.APIKey) == "" {
			continue
		}
		keyEnv, supported := providerAPIKeyEnvironment(name)
		if !supported {
			continue
		}
		route := dshPIAIRoute{APIKeyEnv: keyEnv}
		if display := strings.TrimSpace(provider.Name); display != "" {
			route.DisplayName = display
		}
		routes.Providers[name] = route
	}
	if len(routes.Providers) == 0 {
		routes.Providers = nil
	}
	routes.DeepSeekOfficial = dshOfficialDeepSeekKeyActive(settings)
	return routes
}

// dshOfficialDeepSeekKeyActive reports whether an official DeepSeek key is
// available for the llm-deepseek row (official provider, or a relay/provider
// endpoint that is the official API).
func dshOfficialDeepSeekKeyActive(settings config.AppSettings) bool {
	providerID := strings.TrimSpace(settings.ActiveProvider)
	provider, exists := settings.Providers[providerID]
	key := ""
	if exists {
		key = strings.TrimSpace(provider.APIKey)
	}
	if key == "" {
		for _, fallbackID := range []string{"deepseek", "custom-relay-deepseek"} {
			fallback, found := settings.Providers[fallbackID]
			fallbackKey := strings.TrimSpace(fallback.APIKey)
			if !found || fallbackKey == "" {
				continue
			}
			providerID = fallbackID
			provider = fallback
			key = fallbackKey
			exists = true
			break
		}
	}
	if key == "" {
		return false
	}
	baseURL := ""
	if provider.BaseURL != nil {
		baseURL = strings.TrimSpace(*provider.BaseURL)
	}
	return providerID == "deepseek" || providerID == "custom-relay-deepseek" ||
		dshOfficialDeepSeekAPI(baseURL)
}

func encodeDSHPIAIRoutes(settings config.AppSettings) string {
	routes := composeDSHPIAIRoutes(settings)
	if !routes.DeepSeekOfficial && len(routes.Providers) == 0 {
		return ""
	}
	data, err := json.Marshal(routes)
	if err != nil {
		return ""
	}
	return string(data)
}
