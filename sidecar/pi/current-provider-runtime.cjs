"use strict";

const fs = require("node:fs");

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

const tokenfluxModelCatalog = Object.freeze([]);

function runtimeTokenfluxModelCatalog(environment = process.env) {
  const catalogPath = String(environment.MILKSU_MODEL_CATALOG_PATH ?? "").trim();
  if (!catalogPath) return tokenfluxModelCatalog;
  try {
    const snapshot = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
    if (snapshot?.provider !== "tokenflux" || !Array.isArray(snapshot.models)) {
      return tokenfluxModelCatalog;
    }
    const dynamic = snapshot.models.flatMap(item => {
      const id = String(item?.id ?? "").trim();
      if (!id) return [];
      const input = Array.isArray(item?.input)
        ? [...new Set(item.input.filter(value => value === "text" || value === "image"))]
        : ["text"];
      return [{
        id,
        name: String(item?.name ?? id).trim() || id,
        contextWindow: Number.isInteger(item?.context_window) && item.context_window > 0
          ? item.context_window
          : 128_000,
        maxTokens: Number.isInteger(item?.max_tokens) && item.max_tokens > 0
          ? item.max_tokens
          : 16_384,
        input: input.includes("text") ? input : ["text", ...input],
      }];
    });
    return dynamic.length > 0 ? dynamic : tokenfluxModelCatalog;
  } catch {
    return tokenfluxModelCatalog;
  }
}

function tokenfluxModel(model, environment = process.env) {
  return runtimeTokenfluxModelCatalog(environment).find(item => item.id === model) ?? {
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
  const catalog = [...runtimeTokenfluxModelCatalog(environment)];
  if (model && !catalog.some(item => item.id === model)) {
    catalog.push(tokenfluxModel(model, environment));
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
  runtimeTokenfluxModelCatalog,
  tokenfluxModelIDForProvider,
};
