"use strict";

const { mkdirSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { providerRuntimeFor } = require("./current-provider-runtime.cjs");

// Names the child shell copy drops. The Pi runner process keeps the provider
// keys so the model API can authenticate. Keep this list aligned with
// getShellEnv() in the pi-coding-agent shell patch.
const childShellDeniedEnvNames = Object.freeze([
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_BASE_URL",
  "DEEPSEEK_API_KEY",
  "DEEPSEEK_BASE_URL",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "GOOGLE_BASE_URL",
  "GROQ_API_KEY",
  "GROQ_BASE_URL",
  "KOURICHAT_API_KEY",
  "KOURICHAT_BASE_URL",
  "MILKSU_CUSTOM_PROVIDER_KEY",
  "MILKSU_CUSTOM_PROVIDER_URL",
  "MILKSU_IMAGEGEN_API_KEY",
  "MILKSU_RELAY_KEY",
  "MILKSU_RELAY_URL",
  "MISTRAL_API_KEY",
  "MISTRAL_BASE_URL",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "TOKENFLUX_API_KEY",
  "TOKENFLUX_BASE_URL",
]);

// Present on the sidecar for another surface. A subagent runner does not call
// that surface, so the process copy is dropped as well as the shell copy.
const childProcessDeniedEnvNames = Object.freeze([
  "MILKSU_IMAGEGEN_API_KEY",
]);

const sessions = new Map();

function subagentKeyEnv(providerId) {
  const safe = String(providerId ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 48);
  return `MILKSU_SUBAGENT_KEY_${safe || "PROVIDER"}`;
}

function apiKeyEnvFor(provider, environment = process.env, turnProvider) {
  const id = String(provider ?? "").trim();
  if (!id) return "";
  if (id === "milksu-account" || id === "milksu-relay") return "MILKSU_RELAY_KEY";
  const turnId = String(turnProvider?.id ?? "").trim();
  const turnKey = String(turnProvider?.key ?? "");
  const envCustomKey = String(environment.MILKSU_CUSTOM_PROVIDER_KEY ?? "");
  if (turnId && turnId === id && turnKey && turnKey !== envCustomKey) {
    return subagentKeyEnv(id);
  }
  const customId = String(environment.MILKSU_CUSTOM_PROVIDER_ID ?? "").trim();
  if ((customId && customId === id) || (turnId && turnId === id && turnKey)) {
    return "MILKSU_CUSTOM_PROVIDER_KEY";
  }
  return providerRuntimeFor(id)?.apiKey ?? "";
}

function finite(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function publicModel(model) {
  if (!model || typeof model !== "object") return undefined;
  const id = String(model.id ?? "").trim();
  if (!id) return undefined;
  const next = {
    id,
    name: String(model.name ?? id).trim() || id,
    reasoning: Boolean(model.reasoning),
    input: Array.isArray(model.input)
      ? model.input.filter(value => value === "text" || value === "image")
      : ["text"],
    cost: {
      input: finite(model.cost?.input),
      output: finite(model.cost?.output),
      cacheRead: finite(model.cost?.cacheRead),
      cacheWrite: finite(model.cost?.cacheWrite),
    },
    contextWindow: finite(model.contextWindow),
    maxTokens: finite(model.maxTokens),
  };
  if (!next.input.includes("text")) next.input.unshift("text");
  if (model.compat && typeof model.compat === "object") next.compat = model.compat;
  if (model.thinkingLevelMap && typeof model.thinkingLevelMap === "object") {
    next.thinkingLevelMap = model.thinkingLevelMap;
  }
  return next;
}

function publicProvider(id, definition, apiKeyEnv) {
  const providerId = String(id ?? "").trim();
  if (!providerId || !definition || typeof definition !== "object") return undefined;
  const provider = {};
  const name = String(definition.name ?? "").trim();
  const baseUrl = String(definition.baseUrl ?? "").trim();
  const api = String(definition.api ?? "").trim();
  if (name) provider.name = name;
  if (baseUrl) provider.baseUrl = baseUrl;
  if (api) provider.api = api;
  const envName = String(apiKeyEnv ?? "").trim();
  if (envName) provider.apiKey = `$${envName}`;
  if (Array.isArray(definition.models) && definition.models.length > 0) {
    provider.models = definition.models.map(publicModel).filter(Boolean);
  }
  if (!provider.baseUrl && !(provider.models?.length > 0)) return undefined;
  return { id: providerId, provider };
}

function rememberSessionProviders(conversationId, providers, secrets = {}) {
  const id = String(conversationId ?? "").trim();
  if (!id) return;
  const storedSecrets = {};
  for (const [name, value] of Object.entries(secrets ?? {})) {
    if (!name.startsWith("MILKSU_SUBAGENT_KEY_")) continue;
    const key = String(value ?? "");
    if (key) storedSecrets[name] = key;
  }
  sessions.set(id, {
    providers: (Array.isArray(providers) ? providers : []).filter(entry => entry?.id && entry.provider),
    secrets: storedSecrets,
  });
}

function forgetSessionProviders(conversationId) {
  sessions.delete(String(conversationId ?? "").trim());
}

function resetChildModelRegistry() {
  sessions.clear();
}

function mergedProviders() {
  const map = new Map();
  for (const session of sessions.values()) {
    for (const entry of session.providers) {
      const existing = map.get(entry.id);
      if (!existing) {
        map.set(entry.id, structuredClone(entry.provider));
        continue;
      }
      const models = new Map((existing.models ?? []).map(model => [model.id, model]));
      for (const model of entry.provider.models ?? []) models.set(model.id, model);
      const next = { ...existing, ...structuredClone(entry.provider) };
      if (models.size > 0) next.models = [...models.values()];
      map.set(entry.id, next);
    }
  }
  return Object.fromEntries(map);
}

function storedSecrets() {
  const secrets = [];
  for (const session of sessions.values()) {
    for (const value of Object.values(session.secrets)) {
      if (String(value).length >= 8) secrets.push(value);
    }
  }
  return secrets;
}

function registryDirectory(env, cwd) {
  const configured = String(env.MILKSU_PI_SUBAGENT_MODEL_DIR ?? "").trim();
  if (configured) return configured;
  const agentDir = String(env.MILKSU_PI_AGENT_DIR ?? "").trim()
    || (cwd ? join(cwd, ".milksu", "pi") : "");
  if (agentDir) return join(agentDir, "subagent-runtime");
  return join(tmpdir(), "milksu-subagent-models");
}

function writeRegistry(directory) {
  const providers = mergedProviders();
  const body = `${JSON.stringify({ providers }, null, 2)}\n`;
  for (const secret of storedSecrets()) {
    if (body.includes(secret)) {
      throw new Error("MilkSU subagent model registry refused to store a provider key");
    }
  }
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  writeFileSync(join(directory, "models.json"), body, {
    encoding: "utf8",
    mode: 0o600,
  });
}

function applyChildModelEnvironment(env = {}, cwd = "") {
  const next = { ...(env && typeof env === "object" ? env : {}) };
  if (sessions.size === 0) return next;
  const directory = registryDirectory(next, cwd);
  writeRegistry(directory);
  next.PI_CODING_AGENT_DIR = directory;
  for (const session of sessions.values()) {
    for (const [name, value] of Object.entries(session.secrets)) next[name] = value;
  }
  return next;
}

module.exports = {
  apiKeyEnvFor,
  applyChildModelEnvironment,
  childProcessDeniedEnvNames,
  childShellDeniedEnvNames,
  forgetSessionProviders,
  publicProvider,
  rememberSessionProviders,
  resetChildModelRegistry,
  subagentKeyEnv,
};
