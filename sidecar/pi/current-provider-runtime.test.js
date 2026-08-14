import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import currentProviderRuntime from "./current-provider-runtime.cjs";

const { currentProviderDefinition, tokenfluxModelIDForProvider } = currentProviderRuntime;

test("TokenFlux registers a selected model even before a refreshed cache is available", () => {
  const definition = currentProviderDefinition("tokenflux", "grok-4.5", {});
  const model = definition.models.find((item) => item.id === "grok-4.5");
  assert.ok(model);
  assert.deepEqual(model.input, ["text"]);
});

test("loads refreshed canonical models from the desktop catalog cache", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "milksu-model-catalog-"));
  const catalogPath = path.join(directory, "tokenflux.json");
  fs.writeFileSync(catalogPath, JSON.stringify({
    provider: "tokenflux",
    source: "remote",
    refreshed_at: "2026-08-13T12:30:00Z",
    models: [{
      id: "x-ai/grok-4.6",
      name: "Grok 4.6",
      context_window: 500000,
      max_tokens: 32768,
      input: ["text", "image"],
    }],
  }));
  try {
    const definition = currentProviderDefinition("tokenflux", "x-ai/grok-4.6", {
      TOKENFLUX_API_KEY: "test-key",
      MILKSU_MODEL_CATALOG_PATH: catalogPath,
    });
    const model = definition.models.find(item => item.id === "x-ai/grok-4.6");
    assert.equal(model.name, "Grok 4.6");
    assert.equal(model.contextWindow, 500000);
    assert.deepEqual(model.input, ["text", "image"]);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("maps official provider model IDs onto TokenFlux account routes", () => {
  assert.equal(
    tokenfluxModelIDForProvider("deepseek", "deepseek-v4-flash"),
    "deepseek/deepseek-v4-flash",
  );
  assert.equal(
    tokenfluxModelIDForProvider("anthropic", "claude-sonnet-4-6"),
    "anthropic/claude-sonnet-4.6",
  );
  assert.equal(
    tokenfluxModelIDForProvider("openai", "gpt-4.1"),
    "openai/gpt-4.1",
  );
  assert.equal(tokenfluxModelIDForProvider("tokenflux", "grok-4.5"), "grok-4.5");
});

test("registers the active custom OpenAI-compatible relay only from runtime environment", () => {
  const definition = currentProviderDefinition(
    "custom-relay-team",
    "vendor/model:preview",
    {
      MILKSU_CUSTOM_PROVIDER_ID: "custom-relay-team",
      MILKSU_CUSTOM_PROVIDER_NAME: "Team Relay",
      MILKSU_CUSTOM_PROVIDER_KEY: "secret-key",
      MILKSU_CUSTOM_PROVIDER_URL: "https://relay.invalid/v1",
    },
  );
  assert.equal(definition.name, "Team Relay");
  assert.equal(definition.baseUrl, "https://relay.invalid/v1");
  assert.equal(definition.apiKey, "secret-key");
  assert.equal(definition.models[0].id, "vendor/model:preview");
  assert.equal(
    currentProviderDefinition("custom-relay-other", "model", {
      MILKSU_CUSTOM_PROVIDER_ID: "custom-relay-team",
      MILKSU_CUSTOM_PROVIDER_KEY: "secret-key",
      MILKSU_CUSTOM_PROVIDER_URL: "https://relay.invalid/v1",
    }),
    undefined,
  );
});
