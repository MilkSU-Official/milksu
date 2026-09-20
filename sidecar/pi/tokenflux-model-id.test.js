import assert from "node:assert/strict";
import test from "node:test";
import {
  tokenfluxBareModelID,
  tokenfluxCompositePrefixRequired,
  tokenfluxModelStem,
  tokenfluxRequestModelIDs,
  tokenfluxRequestModels,
  tokenfluxRequestRetryable,
} from "./tokenflux-model-id.cjs";

test("strips a composite prefix without inventing vendor prefixes", () => {
  assert.equal(tokenfluxBareModelID("GPT/gpt-5"), "gpt-5");
  assert.equal(tokenfluxBareModelID("Claude/claude-sonnet-4"), "claude-sonnet-4");
  assert.equal(tokenfluxBareModelID("x-ai/grok-4.5"), "grok-4.5");
  assert.equal(tokenfluxBareModelID("grok-4.5"), "grok-4.5");
});

test("request candidates prefer the catalog id and catalog-known alternates", () => {
  assert.deepEqual(
    tokenfluxRequestModelIDs("GPT/gpt-5", ["GPT/gpt-5", "Claude/claude-sonnet-4"]),
    ["GPT/gpt-5"],
  );
  assert.deepEqual(
    tokenfluxRequestModelIDs("grok-4.5", ["grok-4.5", "x-ai/grok-4.5"]),
    ["grok-4.5", "x-ai/grok-4.5"],
  );
  assert.deepEqual(
    tokenfluxRequestModelIDs("x-ai/grok-4.5", ["x-ai/grok-4.5", "grok-4.5"]),
    ["x-ai/grok-4.5", "grok-4.5"],
  );
  // Without a catalog, only strip an existing prefix — never invent x-ai/openai.
  assert.deepEqual(tokenfluxRequestModelIDs("grok-4.5"), ["grok-4.5"]);
  assert.deepEqual(tokenfluxRequestModelIDs("GPT/gpt-5"), ["GPT/gpt-5", "gpt-5"]);
});

test("uses the catalog thinking suffix instead of inventing a bare flash id", () => {
  assert.equal(tokenfluxModelStem("google/gemini-3.8-flash"), "gemini-3.8-flash");
  assert.equal(tokenfluxModelStem("google/gemini-3.8-flash-tiered"), "gemini-3.8-flash");
  assert.equal(tokenfluxModelStem("gemini-3.1-pro-high"), "gemini-3.1-pro");
  assert.deepEqual(
    tokenfluxRequestModelIDs("google/gemini-3.8-flash", [
      "deepseek/deepseek-flash",
      "google/gemini-3.8-flash-tiered",
      "google/gemini-3.1-pro-high",
    ]),
    ["google/gemini-3.8-flash-tiered", "gemini-3.8-flash-tiered"],
  );
  assert.deepEqual(
    tokenfluxRequestModelIDs("google/gemini-3.8-flash-tiered", [
      "google/gemini-3.8-flash-tiered",
    ]),
    ["google/gemini-3.8-flash-tiered"],
  );
});

test("request model objects keep the catalog selection while rewriting ids", () => {
  const models = tokenfluxRequestModels(
    { id: "GPT/gpt-5", name: "GPT 5", provider: "tokenflux" },
    ["GPT/gpt-5", "gpt-5"],
  );
  assert.equal(models[0].id, "GPT/gpt-5");
  assert.equal(models[0].name, "GPT 5");
  assert.equal(models[1].id, "gpt-5");
  assert.equal(models[1].provider, "tokenflux");
});

test("classifies composite-key prefix failures as retryable", () => {
  assert.equal(
    tokenfluxCompositePrefixRequired({
      errorMessage: '400: {"code":"COMPOSITE_KEY_MODEL_PREFIX_REQUIRED","message":"composite api key model must use prefix/model_id"}',
    }),
    true,
  );
  assert.equal(
    tokenfluxRequestRetryable({
      errorMessage: '404 {"type":"model_not_found","message":"Model \\"x-ai/grok-4.5\\" is not supported"}',
    }),
    true,
  );
  assert.equal(
    tokenfluxRequestRetryable({
      errorMessage: '403: {"message":"The current group does not support the requested model \\"gemini-3.8-flash\\"","type":"permission_error"}',
    }),
    true,
  );
  assert.equal(
    tokenfluxRequestRetryable({ errorMessage: "invalid request body" }),
    false,
  );
});
