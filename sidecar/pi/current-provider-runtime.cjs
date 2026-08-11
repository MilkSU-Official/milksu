"use strict";

const providerRuntime = Object.freeze({
  anthropic: {
    api: "anthropic-messages",
    apiKey: "ANTHROPIC_API_KEY",
    baseUrl: "ANTHROPIC_BASE_URL",
  },
  deepseek: {
    api: "openai-completions",
    apiKey: "DEEPSEEK_API_KEY",
    baseUrl: "DEEPSEEK_BASE_URL",
  },
  google: {
    api: "google-generative-ai",
    apiKey: "GEMINI_API_KEY",
    baseUrl: "GOOGLE_BASE_URL",
  },
  groq: {
    api: "openai-completions",
    apiKey: "GROQ_API_KEY",
    baseUrl: "GROQ_BASE_URL",
  },
  mistral: {
    api: "openai-completions",
    apiKey: "MISTRAL_API_KEY",
    baseUrl: "MISTRAL_BASE_URL",
  },
  openai: {
    api: "openai-completions",
    apiKey: "OPENAI_API_KEY",
    baseUrl: "OPENAI_BASE_URL",
  },
  tokenflux: {
    api: "openai-completions",
    apiKey: "TOKENFLUX_API_KEY",
    baseUrl: "TOKENFLUX_BASE_URL",
    defaultBaseUrl: "https://tokenflux.dev/v1",
  },
});

const tokenfluxModelCatalog = Object.freeze([
  ["grok-4.5", "Grok 4.5", 500_000, 32_768, ["text", "image"]],
  ["grok-4.3", "Grok 4.3", 1_000_000, 32_768, ["text"]],
  ["openai/gpt-5.6-sol", "GPT-5.6 Sol", 1_050_000, 32_768, ["text"]],
  ["openai/gpt-5.2-codex", "GPT-5.2 Codex", 400_000, 32_768, ["text"]],
  ["openai/gpt-4o", "GPT-4o", 128_000, 16_384, ["text", "image"]],
  ["openai/gpt-4.1", "GPT-4.1", 1_047_576, 32_768, ["text", "image"]],
  ["anthropic/claude-sonnet-4.6", "Claude Sonnet 4.6", 1_000_000, 32_768, ["text"]],
  ["deepseek/deepseek-v4-flash", "DeepSeek V4 Flash", 1_048_576, 32_768, ["text"]],
  ["google/gemini-3.1-pro-preview", "Gemini 3.1 Pro Preview", 1_048_576, 32_768, ["text"]],
  ["google/gemini-3.1-flash-image", "Gemini 3.1 Flash Image", 131_072, 16_384, ["text", "image"]],
  ["qwen/qwen3-coder-plus", "Qwen3 Coder Plus", 1_000_000, 32_768, ["text"]],
].map(([id, name, contextWindow, maxTokens, input]) => ({
  id,
  name,
  contextWindow,
  maxTokens,
  input,
})));

function tokenfluxModel(model) {
  return tokenfluxModelCatalog.find(item => item.id === model) ?? {
    id: model,
    name: model,
    contextWindow: 128_000,
    maxTokens: 16_384,
    input: ["text"],
  };
}

function tokenfluxModelIDForProvider(provider, model) {
  const normalizedProvider = String(provider ?? "").trim();
  const normalizedModel = String(model ?? "").trim();
  if (!normalizedModel || normalizedProvider === "tokenflux") return normalizedModel;
  if (normalizedModel.includes("/")) return normalizedModel;
  if (normalizedProvider === "anthropic") {
    return `anthropic/${normalizedModel.replace(/-(\d+)-(\d+)$/u, "-$1.$2")}`;
  }
  if (["deepseek", "google", "openai"].includes(normalizedProvider)) {
    return `${normalizedProvider}/${normalizedModel}`;
  }
  return normalizedModel;
}

function providerRuntimeFor(provider) {
  return providerRuntime[provider];
}

function currentProviderDefinition(provider, model, environment = process.env) {
  const runtime = providerRuntimeFor(provider);
  if (!runtime) return undefined;
  if (provider !== "tokenflux") {
    const baseUrl = String(environment[runtime.baseUrl] ?? "").trim();
    return baseUrl ? { baseUrl } : undefined;
  }
  const catalog = [...tokenfluxModelCatalog];
  if (model && !catalog.some(item => item.id === model)) {
    catalog.push(tokenfluxModel(model));
  }
  return {
    name: "TokenFlux",
    baseUrl: String(environment[runtime.baseUrl] ?? runtime.defaultBaseUrl).trim(),
    apiKey: environment[runtime.apiKey],
    api: runtime.api,
    models: catalog.map(item => ({
      id: item.id,
      name: item.name,
      reasoning: false,
      input: item.input,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: item.contextWindow,
      maxTokens: item.maxTokens,
      compat: {
        supportsDeveloperRole: false,
        supportsReasoningEffort: false,
        maxTokensField: "max_tokens",
      },
    })),
  };
}

module.exports = {
  currentProviderDefinition,
  providerRuntimeFor,
  tokenfluxModelIDForProvider,
};
