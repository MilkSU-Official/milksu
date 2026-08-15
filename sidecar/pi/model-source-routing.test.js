import assert from "node:assert/strict";
import test from "node:test";
import {
  AssistantMessageEventStream,
  InMemoryCredentialStore,
  InMemoryModelsStore,
} from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import {
  createModelSourceRouteProvider,
  createModelSourceStream,
  modelSourceFallbackReason,
  normalizeModelSourceOrder,
} from "./model-source-routing.js";

test("dual-source route inherits a base URL accepted by the Pi runtime", async () => {
  const definition = createModelSourceRouteProvider({
    source: {
      id: "grok-4.6",
      name: "Grok 4.6",
      api: "openai-completions",
      baseUrl: "https://tokenflux.dev/v1",
      input: ["text", "image"],
    },
    model: "grok-4.6",
    sources: [],
    autoFallback: true,
    openSource: () => { throw new Error("not called"); },
  });
  assert.equal(definition.baseUrl, "https://tokenflux.dev/v1");
  assert.equal(definition.models[0].id, "grok-4.6");
  const runtime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    modelsStore: new InMemoryModelsStore(),
    modelsPath: null,
    allowModelNetwork: false,
  });
  runtime.registerProvider("milksu-route", definition);
  assert.equal(
    runtime.getModel("milksu-route", "grok-4.6")?.baseUrl,
    "https://tokenflux.dev/v1",
  );
});

function message(provider, stopReason = "stop", errorMessage = undefined) {
  return {
    role: "assistant",
    content: stopReason === "stop" ? [{ type: "text", text: "ok" }] : [],
    api: "openai-completions",
    provider,
    model: "model",
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

test("normalizes the two model sources without duplicates", () => {
  assert.deepEqual(normalizeModelSourceOrder("personal,personal"), ["personal", "account"]);
});

test("falls back before content when account quota is unavailable", async () => {
  const accountError = message("account", "error", "402 insufficient balance");
  const personalDone = message("personal");
  const selected = [];
  const fallbacks = [];
  const routed = createModelSourceStream({
    sources: [{ id: "account" }, { id: "personal" }],
    autoFallback: true,
    openSource(source) {
      return source.id === "account"
        ? stream([
            { type: "start", partial: accountError },
            { type: "error", reason: "error", error: accountError },
          ])
        : stream([
            { type: "start", partial: personalDone },
            { type: "text_start", contentIndex: 0, partial: personalDone },
            { type: "text_delta", contentIndex: 0, delta: "ok", partial: personalDone },
            { type: "text_end", contentIndex: 0, content: "ok", partial: personalDone },
            { type: "done", reason: "stop", message: personalDone },
          ]);
    },
    onSource: source => selected.push(source),
    onFallback: value => fallbacks.push(value),
  });
  const events = [];
  for await (const event of routed) events.push(event);
  assert.deepEqual(selected, ["account", "personal"]);
  assert.deepEqual(fallbacks, [{ from: "account", to: "personal", reason: "quota" }]);
  assert.equal(events.some(event => event.type === "error"), false);
  assert.equal(events.at(-1).type, "done");
});

test("does not switch sources after output has started", async () => {
  const partial = message("account", "error", "503 unavailable");
  const routed = createModelSourceStream({
    sources: [{ id: "account" }, { id: "personal" }],
    autoFallback: true,
    openSource: () => stream([
      { type: "start", partial },
      { type: "text_start", contentIndex: 0, partial },
      { type: "text_delta", contentIndex: 0, delta: "partial", partial },
      { type: "error", reason: "error", error: partial },
    ]),
  });
  const events = [];
  for await (const event of routed) events.push(event);
  assert.equal(events.at(-1).type, "error");
});

test("falls back when a source throws before emitting output", async () => {
  const selected = [];
  const routed = createModelSourceStream({
    sources: [{ id: "account" }, { id: "personal" }],
    autoFallback: true,
    openSource(source) {
      if (source.id === "account") throw new Error("401 unauthorized");
      const done = message("personal");
      return stream([{ type: "done", reason: "stop", message: done }]);
    },
    onSource: source => selected.push(source),
  });
  const events = [];
  for await (const event of routed) events.push(event);
  assert.deepEqual(selected, ["account", "personal"]);
  assert.equal(events.at(-1).type, "done");
});

test("classifies only safe pre-output fallback failures", () => {
  assert.equal(modelSourceFallbackReason({ errorMessage: "429 rate limit" }), "unavailable");
  assert.equal(modelSourceFallbackReason({ errorMessage: "model not found" }), "model");
  assert.equal(modelSourceFallbackReason({ errorMessage: "invalid request body" }), "");
});
