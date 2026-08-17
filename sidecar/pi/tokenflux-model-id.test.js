import assert from "node:assert/strict";
import test from "node:test";
import {
  inferCompositePrefixedIDs,
  tokenfluxBareModelID,
  tokenfluxCompositePrefixRequired,
  tokenfluxRequestModelIDs,
  tokenfluxRequestModels,
  tokenfluxRequestRetryable,
} from "./tokenflux-model-id.cjs";

test("maps bare Grok / GPT / Claude / Gemini / Qwen / DeepSeek ids to composite prefixes", () => {
  assert.deepEqual(inferCompositePrefixedIDs("grok-4.5"), ["x-ai/grok-4.5"]);
  assert.deepEqual(inferCompositePrefixedIDs("gpt-4.1"), ["openai/gpt-4.1"]);
  assert.deepEqual(
    inferCompositePrefixedIDs("claude-sonnet-4.6"),
    ["anthropic/claude-sonnet-4.6"],
  );
  assert.deepEqual(
    inferCompositePrefixedIDs("gemini-2.5-pro"),
    ["google/gemini-2.5-pro"],
  );
  assert.deepEqual(
    inferCompositePrefixedIDs("qwen3-coder-plus"),
    ["qwen/qwen3-coder-plus", "bailian/qwen3-coder-plus", "dashscope/qwen3-coder-plus"],
  );
  assert.deepEqual(
    inferCompositePrefixedIDs("deepseek-v4-flash"),
    ["deepseek/deepseek-v4-flash"],
  );
});

test("strips known vendor prefixes back to bare model ids", () => {
  assert.equal(tokenfluxBareModelID("x-ai/grok-4.5"), "grok-4.5");
  assert.equal(tokenfluxBareModelID("openai/gpt-4.1"), "gpt-4.1");
  assert.equal(tokenfluxBareModelID("bailian/qwen3-coder-plus"), "qwen3-coder-plus");
  assert.equal(tokenfluxBareModelID("vendor/custom-model"), "vendor/custom-model");
});

test("request candidates try the catalog id first then the alternate shape", () => {
  assert.deepEqual(
    tokenfluxRequestModelIDs("grok-4.5"),
    ["grok-4.5", "x-ai/grok-4.5"],
  );
  assert.deepEqual(
    tokenfluxRequestModelIDs("x-ai/grok-4.5"),
    ["x-ai/grok-4.5", "grok-4.5"],
  );
  assert.deepEqual(
    tokenfluxRequestModelIDs("openai/gpt-4.1"),
    ["openai/gpt-4.1", "gpt-4.1"],
  );
});

test("request model objects keep the catalog selection while rewriting ids", () => {
  const models = tokenfluxRequestModels({
    id: "grok-4.5",
    name: "Grok 4.5",
    provider: "tokenflux",
  });
  assert.equal(models[0].id, "grok-4.5");
  assert.equal(models[0].name, "Grok 4.5");
  assert.equal(models[1].id, "x-ai/grok-4.5");
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
    tokenfluxRequestRetryable({ errorMessage: "invalid request body" }),
    false,
  );
});
