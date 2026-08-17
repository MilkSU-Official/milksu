import assert from "node:assert/strict";
import test from "node:test";
import { AssistantMessageEventStream } from "@earendil-works/pi-ai";
import {
  streamTokenFluxModelWithCompat,
  withTokenFluxModelCompat,
} from "./tokenflux-model-compat.js";

function message(model, stopReason = "stop", errorMessage = undefined) {
  return {
    role: "assistant",
    content: stopReason === "stop" ? [{ type: "text", text: "ok" }] : [],
    api: "openai-completions",
    provider: "tokenflux",
    model,
    usage: {
      input: 1,
      output: stopReason === "stop" ? 1 : 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: stopReason === "stop" ? 2 : 1,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason,
    errorMessage,
    timestamp: Date.now(),
  };
}

function stream(events) {
  const value = new AssistantMessageEventStream();
  queueMicrotask(() => {
    for (const event of events) value.push(event);
    value.end();
  });
  return value;
}

test("uses the catalog composite id without inventing a vendor prefix", async () => {
  const seen = [];
  const done = message("GPT/gpt-5");
  const routed = streamTokenFluxModelWithCompat({
    model: { id: "GPT/gpt-5", provider: "tokenflux", api: "openai-completions" },
    context: { systemPrompt: "", messages: [], tools: [] },
    options: {},
    catalogModelIDs: ["GPT/gpt-5", "Claude/claude-sonnet-4"],
    open(model) {
      seen.push(model.id);
      return stream([{ type: "done", reason: "stop", message: done }]);
    },
  });
  for await (const _event of routed) {
    // drain
  }
  assert.deepEqual(seen, ["GPT/gpt-5"]);
});

test("retries a catalog-known bare alternate when the prefixed form is rejected", async () => {
  const seen = [];
  const done = message("grok-4.5");
  const routed = streamTokenFluxModelWithCompat({
    model: { id: "x-ai/grok-4.5", provider: "tokenflux", api: "openai-completions" },
    context: { systemPrompt: "", messages: [], tools: [] },
    options: {},
    catalogModelIDs: ["x-ai/grok-4.5", "grok-4.5"],
    open(model) {
      seen.push(model.id);
      if (model.id === "x-ai/grok-4.5") {
        const failed = message(
          "x-ai/grok-4.5",
          "error",
          '404 {"type":"model_not_found","message":"Model \\"x-ai/grok-4.5\\" is not supported"}',
        );
        return stream([
          { type: "start", partial: failed },
          { type: "error", reason: "error", error: failed },
        ]);
      }
      return stream([{ type: "done", reason: "stop", message: done }]);
    },
  });
  const events = [];
  for await (const event of routed) events.push(event);
  assert.deepEqual(seen, ["x-ai/grok-4.5", "grok-4.5"]);
  assert.equal(events.at(-1).type, "done");
});

test("does not rewrite after the first content token", async () => {
  const partial = message("grok-4.5", "error", "COMPOSITE_KEY_MODEL_PREFIX_REQUIRED");
  const seen = [];
  const routed = streamTokenFluxModelWithCompat({
    model: { id: "grok-4.5", provider: "tokenflux", api: "openai-completions" },
    context: { systemPrompt: "", messages: [], tools: [] },
    options: {},
    catalogModelIDs: ["grok-4.5", "x-ai/grok-4.5"],
    open(model) {
      seen.push(model.id);
      return stream([
        { type: "start", partial },
        { type: "text_start", contentIndex: 0, partial },
        { type: "text_delta", contentIndex: 0, delta: "partial", partial },
        { type: "error", reason: "error", error: partial },
      ]);
    },
  });
  const events = [];
  for await (const event of routed) events.push(event);
  assert.deepEqual(seen, ["grok-4.5"]);
  assert.equal(events.at(-1).type, "error");
});

test("withTokenFluxModelCompat wraps an existing streamSimple", async () => {
  const seen = [];
  const definition = withTokenFluxModelCompat({
    api: "openai-completions",
    baseUrl: "https://tokenflux.dev/v1",
    apiKey: "test",
    models: [{ id: "Claude/claude-sonnet-4" }],
    streamSimple(model) {
      seen.push(model.id);
      return stream([{ type: "done", reason: "stop", message: message(model.id) }]);
    },
  });
  for await (const _event of definition.streamSimple(
    { id: "Claude/claude-sonnet-4", provider: "tokenflux", api: "openai-completions" },
    { systemPrompt: "", messages: [], tools: [] },
    {},
  )) {
    // drain
  }
  assert.deepEqual(seen, ["Claude/claude-sonnet-4"]);
});
