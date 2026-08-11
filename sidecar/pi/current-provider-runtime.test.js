import assert from "node:assert/strict";
import test from "node:test";
import currentProviderRuntime from "./current-provider-runtime.cjs";

const { currentProviderDefinition, tokenfluxModelIDForProvider } = currentProviderRuntime;

test("Grok 4.5 is image-capable through the existing TokenFlux catalog modality", () => {
  const definition = currentProviderDefinition("tokenflux", "grok-4.5", {});
  const model = definition.models.find((item) => item.id === "grok-4.5");
  assert.ok(model);
  assert.deepEqual(model.input, ["text", "image"]);
  const textOnly = definition.models.find((item) => item.id === "grok-4.3");
  assert.deepEqual(textOnly.input, ["text"]);
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
