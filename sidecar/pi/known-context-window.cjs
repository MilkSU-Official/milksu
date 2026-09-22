"use strict";

// Official lab facts come from https://models.dev/. Keep in sync with
// internal/modelcatalog/context_window.go and app/src/lib/knownContextWindow.ts.
const PLACEHOLDER_CONTEXT_WINDOW = 128_000;
const PLACEHOLDER_MAX_TOKENS = new Set([8_192, 16_384, 32_768]);

const knownModelLimits = [
  ["grok-4.7", 500_000, 500_000],
  ["grok-4.6", 500_000, 500_000],
  ["grok-4.5", 500_000, 500_000],
  ["grok-4.20", 1_000_000, 30_000],
  ["grok-4.3", 1_000_000, 30_000],
  ["grok-4", 1_000_000, 30_000],
  ["grok-build-", 256_000, 256_000],
  ["grok-", 128_000, 0],
  ["gpt-6", 1_050_000, 128_000],
  ["gpt-5.6", 1_050_000, 128_000],
  ["gpt-5.5", 1_050_000, 128_000],
  ["gpt-5.4-mini", 400_000, 128_000],
  ["gpt-5.4-nano", 400_000, 128_000],
  ["gpt-5.4", 1_050_000, 128_000],
  ["gpt-5.3-chat", 128_000, 16_384],
  ["gpt-5.3-codex-spark", 128_000, 32_000],
  ["gpt-5.3-codex", 400_000, 128_000],
  ["gpt-5.2-chat", 128_000, 16_384],
  ["gpt-5.2-codex", 400_000, 128_000],
  ["gpt-5.2-pro", 400_000, 128_000],
  ["gpt-5.2", 400_000, 128_000],
  ["gpt-5-pro", 400_000, 272_000],
  ["gpt-5", 400_000, 128_000],
  ["gpt-4.1", 1_047_576, 32_768],
  ["gpt-4o", 128_000, 16_384],
  ["gpt-", 128_000, 0],
  ["claude-fable-5", 1_000_000, 128_000],
  ["claude-mythos-5", 1_000_000, 128_000],
  ["claude-mythos-preview", 1_000_000, 128_000],
  ["claude-opus-5", 1_000_000, 128_000],
  ["claude-sonnet-5", 1_000_000, 128_000],
  ["claude-sonnet-4.6", 1_000_000, 128_000],
  ["claude-sonnet-4-6", 1_000_000, 128_000],
  ["claude-sonnet-4.5", 1_000_000, 64_000],
  ["claude-sonnet-4-5", 1_000_000, 64_000],
  ["claude-opus-4.8", 1_000_000, 128_000],
  ["claude-opus-4-8", 1_000_000, 128_000],
  ["claude-opus-4.7", 1_000_000, 128_000],
  ["claude-opus-4-7", 1_000_000, 128_000],
  ["claude-opus-4.6", 1_000_000, 128_000],
  ["claude-opus-4-6", 1_000_000, 128_000],
  ["claude-opus-4.5", 200_000, 64_000],
  ["claude-opus-4-5", 200_000, 64_000],
  ["claude-haiku-4.5", 200_000, 64_000],
  ["claude-haiku-4-5", 200_000, 64_000],
  ["claude-", 200_000, 64_000],
  ["deepseek-v4-flash", 1_000_000, 384_000],
  ["deepseek-v4", 1_000_000, 384_000],
  ["deepseek-flash", 1_000_000, 384_000],
  ["deepseek-", 1_000_000, 384_000],
  ["gemini-3.1-flash-image", 65_536, 65_536],
  ["gemini-3.1-flash-lite-image", 65_536, 65_536],
  ["gemini-3.1-flash-live", 131_072, 65_536],
  ["gemini-3-pro-image", 131_072, 32_768],
  ["gemini-3", 1_048_576, 65_536],
  ["gemini-2.5", 1_048_576, 65_536],
  ["gemini-", 1_048_576, 65_536],
  ["qwen3.8", 1_000_000, 131_072],
  ["qwen3.7", 1_000_000, 65_536],
  ["qwen3.6-plus", 1_000_000, 65_536],
  ["qwen3.6-flash", 1_000_000, 65_536],
  ["qwen3.6-27b", 262_144, 65_536],
  ["qwen3.6-35b", 262_144, 65_536],
  ["qwen3-coder-plus", 1_048_576, 65_536],
  ["qwen3-coder-480b", 262_144, 65_536],
  ["qwen3-coder-30b", 262_144, 65_536],
  ["qwen3-coder", 1_000_000, 65_536],
];

function canonicalModelKey(id) {
  const value = String(id ?? "").trim().toLowerCase();
  if (!value) return "";
  const slash = value.lastIndexOf("/");
  return slash >= 0 ? value.slice(slash + 1) : value;
}

function lookupKnownLimit(id) {
  const key = canonicalModelKey(id);
  if (!key) return undefined;
  return knownModelLimits.find(([prefix]) => key === prefix || key.startsWith(prefix));
}

function knownContextWindow(id) {
  return lookupKnownLimit(id)?.[1] ?? 0;
}

function knownMaxTokens(id) {
  return lookupKnownLimit(id)?.[2] ?? 0;
}

function clampModelContextWindow(value) {
  return Math.min(10_000_000, Math.max(1024, value));
}

function contextWindowOverride(provider, model, environment = process.env) {
  const raw = String(environment?.MILKSU_MODEL_CONTEXT_WINDOWS ?? "").trim();
  if (!raw) return 0;
  try {
    const parsed = JSON.parse(raw);
    const value = Number(parsed?.[String(provider ?? "").trim()]?.[String(model ?? "").trim()]);
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  } catch {
    return 0;
  }
}

function resolveModelContextWindow(id, catalogWindow, override) {
  const manual = Number(override);
  if (Number.isFinite(manual) && manual > 0) {
    return clampModelContextWindow(Math.floor(manual));
  }
  const catalog = Number(catalogWindow);
  const known = knownContextWindow(id);
  const catalogValue = Number.isFinite(catalog) && catalog > 0 ? Math.floor(catalog) : 0;
  if (catalogValue > 0 && catalogValue !== PLACEHOLDER_CONTEXT_WINDOW) return catalogValue;
  if (known > 0) return known;
  return catalogValue;
}

function resolveModelMaxTokens(id, catalogMax) {
  const catalog = Number(catalogMax);
  const catalogValue = Number.isFinite(catalog) && catalog > 0 ? Math.floor(catalog) : 0;
  const known = knownMaxTokens(id);
  if (catalogValue > 0 && !PLACEHOLDER_MAX_TOKENS.has(catalogValue)) return catalogValue;
  if (known > 0) return known;
  return catalogValue;
}

// Pi's own default for a model definition that omits the window, taken from
// provider-composer.js modelFromJson (`definition.contextWindow ?? 128000`).
const PI_DEFAULT_CONTEXT_WINDOW = 128_000;
const PI_DEFAULT_MAX_TOKENS = 16_384;

// Window to register with Pi. Pi applies the default above only on its JSON
// config path; models handed to registerProvider go through applyExtension,
// which spreads the definition verbatim and neither validates nor defaults.
// AgentSession then reads `model.contextWindow ?? 0`, so both zero and an
// omitted field arrive as zero — and zero is worse than an imprecise window:
// shouldCompact compares against `contextWindow - reserveTokens`, so it is
// true on every turn, while MilkSU's own 80% gate and usage ring go silent.
function registeredContextWindow(id, catalogWindow, override) {
  const resolved = resolveModelContextWindow(id, catalogWindow, override);
  return resolved > 0 ? resolved : PI_DEFAULT_CONTEXT_WINDOW;
}

function registeredMaxTokens(id, catalogMax) {
  const resolved = resolveModelMaxTokens(id, catalogMax);
  return resolved > 0 ? resolved : PI_DEFAULT_MAX_TOKENS;
}

module.exports = {
  knownContextWindow,
  knownMaxTokens,
  contextWindowOverride,
  resolveModelContextWindow,
  resolveModelMaxTokens,
  registeredContextWindow,
  registeredMaxTokens,
  PI_DEFAULT_CONTEXT_WINDOW,
  PI_DEFAULT_MAX_TOKENS,
};
