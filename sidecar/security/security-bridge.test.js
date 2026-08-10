import assert from "node:assert/strict";
import test from "node:test";
import {
  configureRuntimeModel,
  setSessionModel,
} from "./security-bridge.js";

test("configures the CTF proposal session through Pi modelRuntime", async () => {
  let registeredProvider = "";
  let selectedModel;
  const session = {
    modelRuntime: {
      registerProvider(provider, definition) {
        registeredProvider = provider;
        this.definition = definition;
      },
      getModel(provider, model) {
        return this.definition?.models?.find(item => item.id === model)
          ? { provider, id: model, name: model }
          : undefined;
      },
    },
    async setModel(model) {
      selectedModel = model;
    },
  };

  const effective = configureRuntimeModel(session, "tokenflux", "openai/gpt-5.6-sol");
  assert.deepEqual(effective, { provider: "tokenflux", model: "openai/gpt-5.6-sol" });
  assert.equal(registeredProvider, "tokenflux");

  await setSessionModel(session, effective.provider, effective.model);
  assert.deepEqual(selectedModel, {
    provider: "tokenflux",
    id: "openai/gpt-5.6-sol",
    name: "openai/gpt-5.6-sol",
  });
});

test("keeps compatibility with older modelRegistry sessions", async () => {
  let selectedModel;
  const session = {
    modelRegistry: {
      find(provider, model) {
        if (provider !== "tokenflux" || model !== "openai/gpt-5.6-sol") return undefined;
        return { provider, id: model };
      },
      registerProvider() {},
    },
    async setModel(model) {
      selectedModel = model;
    },
  };

  await setSessionModel(session, "tokenflux", "openai/gpt-5.6-sol");
  assert.deepEqual(selectedModel, {
    provider: "tokenflux",
    id: "openai/gpt-5.6-sol",
  });
});
