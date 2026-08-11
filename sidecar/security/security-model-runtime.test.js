import assert from "node:assert/strict";
import test from "node:test";

import {
  configureRuntimeModel,
  setSessionModel,
} from "./security-model-runtime.js";

test("security CTF sessions use Pi modelRuntime and select the registered model", async () => {
  const providers = new Map();
  const selected = [];
  const session = {
    modelRuntime: {
      registerProvider(provider, definition) {
        providers.set(provider, definition);
      },
      getModel(provider, model) {
        return providers.get(provider)?.models.find(candidate => candidate.id === model);
      },
    },
    async setModel(model) {
      selected.push(model);
    },
  };

  const effective = configureRuntimeModel(session, "deepseek", "deepseek-v4-flash", {
    currentProviderDefinition: () => ({
      name: "DeepSeek",
      baseUrl: "https://example.invalid/v1",
      api: "openai-completions",
      models: [{ id: "deepseek-v4-flash", name: "V4 Flash" }],
    }),
    relay: { enabled: false },
  });
  await setSessionModel(session, effective.provider, effective.model);

  assert.equal(effective.provider, "deepseek");
  assert.equal(selected.length, 1);
  assert.equal(selected[0].id, "deepseek-v4-flash");
  assert.equal("modelRegistry" in session, false);
});

test("security CTF relay registration stays on Pi modelRuntime", async () => {
  const providers = new Map([
    ["source", { models: [{ id: "model", name: "Source Model", contextWindow: 64000 }] }],
  ]);
  const selected = [];
  const session = {
    modelRuntime: {
      registerProvider(provider, definition) {
        providers.set(provider, definition);
      },
      getModel(provider, model) {
        return providers.get(provider)?.models.find(candidate => candidate.id === model);
      },
    },
    async setModel(model) {
      selected.push(model);
    },
  };

  const effective = configureRuntimeModel(session, "source", "model", {
    currentProviderDefinition: () => null,
    relay: {
      enabled: true,
      url: "https://relay.example.invalid/v1",
      key: "test-only-key",
    },
  });
  await setSessionModel(session, effective.provider, effective.model);

  assert.deepEqual(effective, { provider: "milksu-relay", model: "model" });
  assert.equal(providers.get("milksu-relay").models[0].contextWindow, 64000);
  assert.equal(selected[0].id, "model");
});
