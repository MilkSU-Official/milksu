import assert from "node:assert/strict";
import test from "node:test";
import currentProviderRuntime from "./current-provider-runtime.cjs";

const { currentProviderDefinition } = currentProviderRuntime;

test("Grok 4.5 is image-capable through the existing TokenFlux catalog modality", () => {
  const definition = currentProviderDefinition("tokenflux", "grok-4.5", {});
  const model = definition.models.find((item) => item.id === "grok-4.5");
  assert.ok(model);
  assert.deepEqual(model.input, ["text", "image"]);
  const textOnly = definition.models.find((item) => item.id === "grok-4.3");
  assert.deepEqual(textOnly.input, ["text"]);
});
