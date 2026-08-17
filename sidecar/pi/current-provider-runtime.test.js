import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  InMemoryCredentialStore,
  InMemoryModelsStore,
} from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import currentProviderRuntime from "./current-provider-runtime.cjs";

const {
  currentProviderDefinition,
  tokenfluxAccountModelAvailability,
  tokenfluxModelIDForProvider,
} = currentProviderRuntime;

test("TokenFlux registers a selected model even before a refreshed cache is available", () => {
  const definition = currentProviderDefinition("tokenflux", "grok-4.5", {});
  const model = definition.models.find((item) => item.id === "grok-4.5");
  assert.ok(model);
  assert.deepEqual(model.input, ["text", "image"]);
});

test("keeps unknown TokenFlux models text-only without catalog evidence", () => {
  const definition = currentProviderDefinition("tokenflux", "vendor/unknown", {});
  const model = definition.models.find((item) => item.id === "vendor/unknown");
  assert.deepEqual(model.input, ["text"]);
});

test("loads refreshed canonical models from the desktop catalog cache", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "milksu-model-catalog-"));
  const catalogPath = path.join(directory, "tokenflux.json");
  fs.writeFileSync(catalogPath, JSON.stringify({
    provider: "tokenflux",
    source: "remote",
    credential_source: "account",
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

test("uses only an authoritative account catalog to reject unavailable models", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "milksu-account-catalog-"));
  const catalogPath = path.join(directory, "tokenflux.json");
  try {
    fs.writeFileSync(catalogPath, JSON.stringify({
      provider: "tokenflux",
      source: "remote",
      credential_source: "account",
      models: [{ id: "grok-4.5", input: ["text"] }],
    }));
    const account = tokenfluxAccountModelAvailability("grok-4.5", {
      MILKSU_MODEL_CATALOG_PATH: catalogPath,
    });
    assert.equal(account.authoritative, true);
    assert.equal(account.model.id, "grok-4.5");
    const missing = tokenfluxAccountModelAvailability("deepseek/deepseek-v4-flash", {
      MILKSU_MODEL_CATALOG_PATH: catalogPath,
    });
    assert.equal(missing.authoritative, true);
    assert.equal(missing.model, undefined);

    fs.writeFileSync(catalogPath, JSON.stringify({
      provider: "tokenflux",
      source: "remote",
      credential_source: "merged",
      account_model_ids: ["grok-4.5"],
      models: [
        { id: "grok-4.5", input: ["text"] },
        { id: "GPT/gpt-5", input: ["text"] },
      ],
    }));
    const mergedAccount = tokenfluxAccountModelAvailability("grok-4.5", {
      MILKSU_MODEL_CATALOG_PATH: catalogPath,
    });
    assert.equal(mergedAccount.authoritative, true);
    assert.equal(mergedAccount.model.id, "grok-4.5");
    const personalOnly = tokenfluxAccountModelAvailability("GPT/gpt-5", {
      MILKSU_MODEL_CATALOG_PATH: catalogPath,
    });
    assert.equal(personalOnly.authoritative, true);
    assert.equal(personalOnly.model, undefined);

    fs.writeFileSync(catalogPath, JSON.stringify({
      provider: "tokenflux",
      source: "remote",
      credential_source: "personal",
      models: [{ id: "grok-4.5", input: ["text"] }],
    }));
    const personal = tokenfluxAccountModelAvailability("deepseek/deepseek-v4-flash", {
      MILKSU_MODEL_CATALOG_PATH: catalogPath,
    });
    assert.equal(personal.authoritative, false);
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

test("registers Groq's current vision model with image input", async () => {
  const definition = currentProviderDefinition("groq", "qwen/qwen3.6-27b", {
    GROQ_API_KEY: "test-key",
  });
  assert.equal(definition.baseUrl, "https://api.groq.com/openai/v1");
  assert.deepEqual(definition.models.map(item => item.id), ["qwen/qwen3.6-27b"]);
  const vision = definition.models.find(item => item.id === "qwen/qwen3.6-27b");
  assert.deepEqual(vision.input, ["text", "image"]);
  assert.equal(vision.maxTokens, 16_384);
  const runtime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    modelsStore: new InMemoryModelsStore(),
    modelsPath: null,
    allowModelNetwork: false,
  });
  runtime.registerProvider("groq", definition);
  assert.deepEqual(
    runtime.getModel("groq", "qwen/qwen3.6-27b")?.input,
    ["text", "image"],
  );
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
