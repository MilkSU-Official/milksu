"use strict";

const fs = require("node:fs");
const {
  contextWindowOverride,
  registeredContextWindow,
  registeredMaxTokens,
} = require("./known-context-window.cjs");

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
    defaultBaseUrl: "https://api.groq.com/openai/v1",
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

function modelInput(values) {
  const next = Array.isArray(values)
    ? [...new Set(values.filter(value => value === "text" || value === "image"))]
    : [];
  if (!next.includes("text")) next.unshift("text");
  if (!next.includes("image")) next.push("image");
  return next;
}
const groqModelCatalog = Object.freeze([
  {
    id: "qwen/qwen3.6-27b",
    name: "Qwen 3.6 27B",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 262_144,
    maxTokens: 65_536,
    thinkingLevelMap: { off: "none", high: "default" },
  },
]);

function runtimeTokenfluxModelCatalogSnapshot(environment = process.env) {
  const catalogPath = String(environment.MILKSU_MODEL_CATALOG_PATH ?? "").trim();
  if (!catalogPath) return {
    models: tokenfluxModelCatalog,
    source: "",
    credentialSource: "",
    keyShape: "",
    accountModelIDs: [],
  };
  try {
    const snapshot = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
    if (snapshot?.provider !== "tokenflux" || !Array.isArray(snapshot.models)) {
      return {
        models: tokenfluxModelCatalog,
        source: "",
        credentialSource: "",
        keyShape: "",
        accountModelIDs: [],
      };
    }
    const dynamic = snapshot.models.flatMap(item => {
      const id = String(item?.id ?? "").trim();
      if (!id) return [];
      return [{
        id,
        name: String(item?.name ?? id).trim() || id,
        contextWindow: registeredContextWindow(
          id,
          Number.isInteger(item?.context_window) ? item.context_window : 0,
          contextWindowOverride("tokenflux", id, environment),
        ),
        maxTokens: registeredMaxTokens(
          id,
          Number.isInteger(item?.max_tokens) ? item.max_tokens : 0,
        ),
        input: modelInput(item?.input),
      }];
    });
    const accountModelIDs = Array.isArray(snapshot.account_model_ids)
      ? snapshot.account_model_ids.map(id => String(id ?? "").trim()).filter(Boolean)
      : [];
    return {
      models: dynamic.length > 0 ? dynamic : tokenfluxModelCatalog,
      source: String(snapshot.source ?? "").trim(),
      credentialSource: String(snapshot.credential_source ?? "").trim(),
      keyShape: String(snapshot.key_shape ?? "").trim(),
      accountModelIDs,
    };
  } catch {
    return {
      models: tokenfluxModelCatalog,
      source: "",
      credentialSource: "",
      keyShape: "",
      accountModelIDs: [],
    };
  }
}

function runtimeTokenfluxModelCatalog(environment = process.env) {
  return runtimeTokenfluxModelCatalogSnapshot(environment).models;
}

function tokenfluxAccountModelAvailability(model, environment = process.env) {
  const snapshot = runtimeTokenfluxModelCatalogSnapshot(environment);
  const source = String(snapshot.credentialSource ?? "").trim();
  // Account entitlement is authoritative when the catalog came from the
  // account key alone, or from a merged account+personal refresh that records
  // which ids the account key can call.
  const authoritative = (snapshot.source === "remote" || snapshot.source === "cache")
    && (source === "account" || source === "merged");
  if (!authoritative) return { authoritative: false, model: undefined };
  const accountIDs = Array.isArray(snapshot.accountModelIDs)
    ? snapshot.accountModelIDs
    : null;
  if (source === "merged" && accountIDs) {
    const allowed = new Set(accountIDs.map(id => String(id ?? "").trim()).filter(Boolean));
    if (!allowed.has(String(model ?? "").trim())) {
      return { authoritative: true, model: undefined };
    }
  }
  return {
    authoritative: true,
    model: snapshot.models.find(item => item.id === model),
  };
}

function tokenfluxModel(model, environment = process.env) {
  return runtimeTokenfluxModelCatalog(environment).find(item => item.id === model) ?? {
    id: model,
    name: model,
    contextWindow: registeredContextWindow(
      model,
      0,
      contextWindowOverride("tokenflux", model, environment),
    ),
    maxTokens: registeredMaxTokens(model, 0),
    input: modelInput(),
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

function customRelayDefinition({ name, baseUrl, apiKey }, provider, model, environment) {
  if (!baseUrl || !apiKey || !model) return undefined;
  return {
    name: String(name ?? provider).trim() || provider,
    baseUrl,
    apiKey,
    api: "openai-completions",
    models: [{
      id: model,
      name: model,
      reasoning: false,
      input: modelInput(),
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: registeredContextWindow(
        model,
        0,
        contextWindowOverride(provider, model, environment),
      ),
      maxTokens: registeredMaxTokens(model, 0),
      compat: {
        supportsDeveloperRole: false,
        supportsReasoningEffort: false,
        maxTokensField: "max_tokens",
      },
    }],
  };
}

/**
 * True when `provider` is a relay the user configured (a custom OpenAI-compatible endpoint),
 * named either by the process environment or by the turn itself. The account source cannot serve
 * such a provider, so it must never stand in for it.
 */
function isCustomRelayProvider(provider, environment = process.env, turnProvider) {
  const id = String(provider ?? "").trim();
  if (!id || providerRuntimeFor(id)) return false;
  return id === String(environment.MILKSU_CUSTOM_PROVIDER_ID ?? "").trim()
    || id === String(turnProvider?.id ?? "").trim();
}

// `turnProvider` is the relay the conversation itself selected, carried by the turn command.
// The process environment only ever holds one relay (the one active when the sidecar was
// spawned), so without it a conversation whose own choice differs could not resolve its
// provider at all and fell back to the account source.
function currentProviderDefinition(
  provider,
  model,
  environment = process.env,
  turnProvider,
) {
  const turnProviderID = String(turnProvider?.id ?? "").trim();
  if (turnProviderID && turnProviderID === provider) {
    const fromTurn = customRelayDefinition({
      name: String(turnProvider.name ?? provider).trim() || provider,
      baseUrl: String(turnProvider.baseUrl ?? "").trim(),
      apiKey: String(turnProvider.key ?? "").trim(),
    }, provider, model, environment);
    if (fromTurn) return fromTurn;
  }
  const customProviderID = String(
    environment.MILKSU_CUSTOM_PROVIDER_ID ?? "",
  ).trim();
  if (customProviderID && customProviderID === provider) {
    return customRelayDefinition({
      name: String(environment.MILKSU_CUSTOM_PROVIDER_NAME ?? provider).trim()
        || provider,
      baseUrl: String(environment.MILKSU_CUSTOM_PROVIDER_URL ?? "").trim(),
      apiKey: String(environment.MILKSU_CUSTOM_PROVIDER_KEY ?? "").trim(),
    }, provider, model, environment);
  }
  const runtime = providerRuntimeFor(provider);
  if (!runtime) return undefined;
  if (provider === "groq") {
    return {
      name: "Groq",
      baseUrl: String(
        environment[runtime.baseUrl] ?? runtime.defaultBaseUrl,
      ).trim(),
      apiKey: environment[runtime.apiKey],
      api: runtime.api,
      models: groqModelCatalog.map(item => ({
        ...item,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        compat: {
          supportsDeveloperRole: false,
          supportsReasoningEffort: item.reasoning,
          maxTokensField: "max_completion_tokens",
        },
      })),
    };
  }
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
  isCustomRelayProvider,
  providerRuntimeFor,
  runtimeTokenfluxModelCatalog,
  tokenfluxAccountModelAvailability,
  tokenfluxModelIDForProvider,
};
