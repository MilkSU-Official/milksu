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
  isCustomRelayProvider,
  tokenfluxAccountModelAvailability,
  tokenfluxModelIDForProvider,
} = currentProviderRuntime;

test("TokenFlux registers a selected model even before a refreshed cache is available", () => {
  const definition = currentProviderDefinition("tokenflux", "grok-4.5", {});
  const model = definition.models.find((item) => item.id === "grok-4.5");
  assert.ok(model);
  assert.deepEqual(model.input, ["text", "image"]);
});

test("does not mark unknown TokenFlux models as text-only", () => {
  const definition = currentProviderDefinition("tokenflux", "vendor/unknown", {});
  const model = definition.models.find((item) => item.id === "vendor/unknown");
  assert.deepEqual(model.input, ["text", "image"]);
});

test("catalog rows without image still register image input", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "milksu-model-catalog-"));
  const catalogPath = path.join(directory, "tokenflux.json");
  fs.writeFileSync(catalogPath, JSON.stringify({
    provider: "tokenflux",
    source: "remote",
    credential_source: "personal",
    models: [{
      id: "deepseek/deepseek-v4-flash",
      name: "DeepSeek V4 Flash",
      context_window: 128000,
      max_tokens: 8192,
      input: ["text"],
    }],
  }));
  try {
    const definition = currentProviderDefinition("tokenflux", "deepseek/deepseek-v4-flash", {
      TOKENFLUX_API_KEY: "test-key",
      MILKSU_MODEL_CATALOG_PATH: catalogPath,
    });
    const model = definition.models.find(item => item.id === "deepseek/deepseek-v4-flash");
    assert.deepEqual(model.input, ["text", "image"]);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
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
  assert.equal(vision.maxTokens, 65_536);
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
  assert.deepEqual(definition.models[0].input, ["text", "image"]);
  assert.equal(
    currentProviderDefinition("custom-relay-other", "model", {
      MILKSU_CUSTOM_PROVIDER_ID: "custom-relay-team",
      MILKSU_CUSTOM_PROVIDER_KEY: "secret-key",
      MILKSU_CUSTOM_PROVIDER_URL: "https://relay.invalid/v1",
    }),
    undefined,
  );
});

// The sidecar process is per workspace and carries exactly one MILKSU_CUSTOM_PROVIDER_* slot,
// filled with whichever relay was active when it was spawned. A conversation whose manual
// choice is a different relay therefore could not resolve its own provider and silently fell
// back to the account source (observed: the picker showed custom-relay-deepseek while the
// engine ran milksu-account/deepseek/deepseek-flash and got a 502). The definition now travels
// with the turn, so the relay the user picked always resolves.
test("the conversation's own relay resolves even when the process was spawned for another one", () => {
  const environment = {
    MILKSU_CUSTOM_PROVIDER_ID: "custom-relay-someone-else",
    MILKSU_CUSTOM_PROVIDER_NAME: "Other relay",
    MILKSU_CUSTOM_PROVIDER_KEY: "other-relay-secret",
    MILKSU_CUSTOM_PROVIDER_URL: "https://other.invalid/v1",
  };
  const definition = currentProviderDefinition(
    "custom-relay-deepseek",
    "deepseek-flash",
    environment,
    {
      id: "custom-relay-deepseek",
      name: "DeepSeek",
      key: "deepseek-personal-secret",
      baseUrl: "https://api.deepseek.example.test",
    },
  );
  assert.ok(definition, "the turn's own relay must resolve");
  assert.equal(definition.baseUrl, "https://api.deepseek.example.test");
  assert.equal(definition.apiKey, "deepseek-personal-secret");
  assert.deepEqual(definition.models.map((item) => item.id), ["deepseek-flash"]);
  // Never borrow another relay's credentials.
  assert.notEqual(definition.apiKey, "other-relay-secret");
  assert.notEqual(definition.baseUrl, "https://other.invalid/v1");
});

test("a turn payload for a different provider never overrides the requested provider", () => {
  const definition = currentProviderDefinition("custom-relay-deepseek", "deepseek-flash", {}, {
    id: "custom-relay-other",
    name: "Other",
    key: "other-secret",
    baseUrl: "https://other.invalid/v1",
  });
  assert.equal(definition, undefined);
});

test("an incomplete turn payload still falls back to the process slot for the same relay", () => {
  const environment = {
    MILKSU_CUSTOM_PROVIDER_ID: "custom-relay-deepseek",
    MILKSU_CUSTOM_PROVIDER_NAME: "DeepSeek",
    MILKSU_CUSTOM_PROVIDER_KEY: "deepseek-env-secret",
    MILKSU_CUSTOM_PROVIDER_URL: "https://api.deepseek.env.test",
  };
  const definition = currentProviderDefinition("custom-relay-deepseek", "deepseek-flash", environment, {
    id: "custom-relay-deepseek",
  });
  assert.ok(definition);
  assert.equal(definition.apiKey, "deepseek-env-secret");
  assert.equal(definition.baseUrl, "https://api.deepseek.env.test");
});

test("a configured relay is recognised from the turn or from the process slot", () => {
  assert.equal(isCustomRelayProvider("custom-relay-deepseek", {}, {
    id: "custom-relay-deepseek", key: "k", baseUrl: "https://relay.invalid/v1",
  }), true);
  assert.equal(isCustomRelayProvider("custom-relay-deepseek", {
    MILKSU_CUSTOM_PROVIDER_ID: "custom-relay-deepseek",
  }), true);
  // The account source itself and built-in providers are not relays.
  assert.equal(isCustomRelayProvider("tokenflux", {}, { id: "other" }), false);
  assert.equal(isCustomRelayProvider("", {}, { id: "" }), false);
  // A relay named by another turn's payload must not mark this provider.
  assert.equal(isCustomRelayProvider("custom-relay-deepseek", {}, { id: "custom-relay-other" }), false);
});

// E) In one sidecar process, switching the conversation's relay must resolve the new one and must
// not leave the previous one broken.
test("two relays resolve in the same process without clobbering each other", () => {
  const first = currentProviderDefinition("relay-one", "model-one", {}, {
    id: "relay-one", name: "Relay one", key: "relay-one-secret", baseUrl: "https://relay-one.invalid/v1",
  });
  const second = currentProviderDefinition("relay-two", "model-two", {}, {
    id: "relay-two", name: "Relay two", key: "relay-two-secret", baseUrl: "https://relay-two.invalid/v1",
  });
  assert.equal(first.baseUrl, "https://relay-one.invalid/v1");
  assert.equal(first.apiKey, "relay-one-secret");
  assert.equal(second.baseUrl, "https://relay-two.invalid/v1");
  assert.equal(second.apiKey, "relay-two-secret");

  // Resolving the second relay again must not change the first one's answer.
  const firstAgain = currentProviderDefinition("relay-one", "model-one", {}, {
    id: "relay-one", name: "Relay one", key: "relay-one-secret", baseUrl: "https://relay-one.invalid/v1",
  });
  assert.equal(firstAgain.baseUrl, "https://relay-one.invalid/v1");
  assert.equal(firstAgain.apiKey, "relay-one-secret");
  // A rotated key takes effect on the next turn.
  const rotated = currentProviderDefinition("relay-one", "model-one", {}, {
    id: "relay-one", name: "Relay one", key: "relay-one-rotated", baseUrl: "https://relay-one.invalid/v1",
  });
  assert.equal(rotated.apiKey, "relay-one-rotated");
});
