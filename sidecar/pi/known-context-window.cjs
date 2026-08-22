"use strict";

// Keep in sync with internal/modelcatalog/context_window.go
const knownContextWindows = [
  ["grok-4.6", 500_000],
  ["grok-4.5", 500_000],
  ["grok-4.3", 1_000_000],
  ["grok-4", 1_000_000],
  ["grok-build-", 256_000],
  ["grok-", 128_000],
  ["gpt-5.6", 1_050_000],
  ["gpt-5.5", 1_050_000],
  ["gpt-5.4-mini", 400_000],
  ["gpt-5.4-nano", 400_000],
  ["gpt-5.4", 1_050_000],
  ["gpt-5.3-chat", 128_000],
  ["gpt-5.3-codex", 400_000],
  ["gpt-5.2-codex", 400_000],
  ["gpt-5.2", 400_000],
  ["gpt-5", 400_000],
  ["gpt-4.1", 1_047_576],
  ["gpt-4o", 128_000],
  ["gpt-", 128_000],
  ["claude-fable-5", 1_000_000],
  ["claude-mythos-5", 1_000_000],
  ["claude-mythos-preview", 1_000_000],
  ["claude-opus-5", 1_000_000],
  ["claude-sonnet-5", 1_000_000],
  ["claude-sonnet-4.6", 1_000_000],
  ["claude-sonnet-4-6", 1_000_000],
  ["claude-opus-4.8", 1_000_000],
  ["claude-opus-4-8", 1_000_000],
  ["claude-opus-4.7", 1_000_000],
  ["claude-opus-4-7", 1_000_000],
  ["claude-opus-4.6", 1_000_000],
  ["claude-opus-4-6", 1_000_000],
  ["claude-", 200_000],
  ["deepseek-v4-flash", 1_048_576],
  ["deepseek-v4", 1_048_576],
  ["gemini-3.1", 1_048_576],
  ["gemini-3", 1_048_576],
  ["qwen3-coder-plus", 1_000_000],
  ["qwen3-coder", 1_000_000],
];

function canonicalModelKey(id) {
  const value = String(id ?? "").trim().toLowerCase();
  if (!value) return "";
  const slash = value.lastIndexOf("/");
  return slash >= 0 ? value.slice(slash + 1) : value;
}

function knownContextWindow(id) {
  const key = canonicalModelKey(id);
  if (!key) return 0;
  for (const [prefix, window] of knownContextWindows) {
    if (key === prefix || key.startsWith(prefix)) return window;
  }
  return 0;
}

function resolveModelContextWindow(id, catalogWindow) {
  const catalog = Number(catalogWindow);
  const known = knownContextWindow(id);
  const catalogValue = Number.isFinite(catalog) && catalog > 0 ? Math.floor(catalog) : 0;
  if (catalogValue > 0 && catalogValue !== 128_000) return catalogValue;
  if (known > 0) return known;
  return catalogValue;
}

module.exports = {
  knownContextWindow,
  resolveModelContextWindow,
};
