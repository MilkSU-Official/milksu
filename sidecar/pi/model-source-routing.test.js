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
  modelSourceFailureMessage,
  modelSourceFallbackReason,
  normalizeModelSourceOrder,
  selectModelSources,
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

test("dual-source route resolves each source credential instead of forwarding route auth", async () => {
  const done = message("account");
  const seenOptions = [];
  const definition = createModelSourceRouteProvider({
    source: {
      id: "grok-4.5",
      name: "Grok 4.5",
      api: "openai-completions",
      baseUrl: "https://tokenflux.dev/v1",
      input: ["text"],
    },
    model: "grok-4.5",
    sources: [{ id: "account" }],
    autoFallback: true,
    openSource(_source, _context, options) {
      seenOptions.push(options);
      return stream([{ type: "done", reason: "stop", message: done }]);
    },
  });
  const routed = definition.streamSimple(
    definition.models[0],
    { systemPrompt: "", messages: [], tools: [] },
    {
      apiKey: "milksu-model-source-route",
      headers: {
        Authorization: "Bearer milksu-model-source-route",
        "X-Request-ID": "request-1",
      },
    },
  );
  for await (const _event of routed) {
    // Drain the routed stream so the selected source is opened.
  }
  assert.equal(Object.hasOwn(seenOptions[0], "apiKey"), false);
  assert.deepEqual(seenOptions[0].headers, { "X-Request-ID": "request-1" });
});

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
  assert.equal(
    modelSourceFallbackReason({
      errorMessage: '400 {"code":"COMPOSITE_KEY_MODEL_PREFIX_REQUIRED","message":"composite api key model must use prefix/model_id"}',
    }),
    "model",
  );
  assert.equal(modelSourceFallbackReason({ errorMessage: "invalid request body" }), "");
});

test("classifies TokenFlux account model entitlement failures", () => {
  const error = message(
    "account",
    "error",
    "404 {\"message\":\"Model \\\"deepseek/deepseek-v4-flash\\\" is not supported by any configured account in this group\",\"type\":\"model_not_found\"}",
  );
  assert.equal(modelSourceFallbackReason(error), "model");
});

test("falls back on a TokenFlux account model entitlement failure before output", async () => {
  const accountError = message(
    "account",
    "error",
    "404 {\"message\":\"Model \\\"deepseek/deepseek-v4-flash\\\" is not supported by any configured account in this group\",\"type\":\"model_not_found\"}",
  );
  const personalDone = message("personal");
  const selected = [];
  const routed = createModelSourceStream({
    sources: [{ id: "account" }, { id: "personal" }],
    autoFallback: true,
    openSource(source) {
      return source.id === "account"
        ? stream([
            { type: "start", partial: accountError },
            { type: "error", reason: "error", error: accountError },
          ])
        : stream([{ type: "done", reason: "stop", message: personalDone }]);
    },
    onSource: source => selected.push(source),
  });
  const events = [];
  for await (const event of routed) events.push(event);
  assert.deepEqual(selected, ["account", "personal"]);
  assert.equal(events.at(-1).type, "done");
});

// The reported incident: the conversation chose custom-relay-deepseek/deepseek-flash, that relay
// could not be resolved in the sidecar process, and the engine silently answered from the account
// source with a different model id - a 502 from a service the user never picked.
test("a custom relay is never served by the account source", () => {
  const selection = selectModelSources({
    requestedOrder: ["account", "personal"],
    accountModel: { provider: "milksu-account", id: "deepseek/deepseek-flash" },
    personalModel: undefined,
    customRelay: true,
  });
  assert.deepEqual(selection.sources, []);
  assert.equal(selection.failure.reason, "selected-source-unavailable");
  assert.equal(selection.failure.hasAccount, true);
});

test("the conversation's own relay is used when it resolves", () => {
  const personal = { provider: "custom-relay-deepseek", id: "deepseek-flash" };
  const selection = selectModelSources({
    requestedOrder: ["personal", "account"],
    accountModel: { provider: "milksu-account", id: "deepseek/deepseek-flash" },
    personalModel: personal,
    customRelay: true,
  });
  assert.deepEqual(selection.sources, [{ id: "personal", model: personal }]);
});

test("an account-only turn keeps working for a provider the account can serve", () => {
  // A built-in provider with no personal key is the documented account-quota case, not a fallback.
  const selection = selectModelSources({
    requestedOrder: ["account"],
    accountModel: { provider: "milksu-account", id: "deepseek/deepseek-chat" },
    personalModel: undefined,
    customRelay: false,
  });
  assert.equal(selection.sources.length, 1);
  assert.equal(selection.sources[0].id, "account");
});

test("nothing resolvable is a failure, never an empty success", () => {
  const selection = selectModelSources({
    requestedOrder: ["personal"],
    accountModel: undefined,
    personalModel: undefined,
    customRelay: true,
  });
  assert.deepEqual(selection.sources, []);
  assert.ok(selection.failure);
});

test("the failure message names the source, provider and model it tried", () => {
  const text = modelSourceFailureMessage({
    provider: "custom-relay-deepseek",
    model: "deepseek-flash",
    requestedOrder: ["personal"],
    locale: "zh-CN",
  });
  assert.match(text, /模型调用失败/);
  assert.match(text, /自有来源/);
  assert.match(text, /custom-relay-deepseek/);
  assert.match(text, /deepseek-flash/);
  // The route must name the source that was chosen (personal), never present the account source
  // as the one that ran.
  assert.match(text, /^模型调用失败：自有来源 \//);
  assert.doesNotMatch(text, /^模型调用失败：账号来源/);
  assert.doesNotMatch(text, /TokenFlux/);
});

test("an account-source failure says so in English too", () => {
  const text = modelSourceFailureMessage({
    provider: "tokenflux",
    model: "deepseek/deepseek-flash",
    requestedOrder: ["account"],
    locale: "en",
  });
  assert.match(text, /account source/);
  assert.match(text, /tokenflux/);
});

// The reader must see the source that actually failed. A two-element order used to be read as
// "personal is in the list, so call it personal", which labelled an account failure as the reader's
// own relay - the opposite of what they need to act on.
test("a two-element order reports the source that really failed", () => {
  const text = modelSourceFailureMessage({
    provider: "tokenflux",
    model: "deepseek/deepseek-flash",
    requestedOrder: ["account", "personal"],
    source: "account",
    locale: "zh-CN",
  });
  assert.match(text, /^模型调用失败：账号来源 \//);
  // The route must not name the other source, even though the reason sentence mentions that no
  // account fallback happened.
  assert.doesNotMatch(text, /^模型调用失败：自有来源/);

  // And the same order with a personal failure reports personal.
  const personal = modelSourceFailureMessage({
    provider: "custom-relay-deepseek",
    model: "deepseek-flash",
    requestedOrder: ["account", "personal"],
    source: "personal",
    locale: "zh-CN",
  });
  assert.match(personal, /^模型调用失败：自有来源 \//);
  assert.doesNotMatch(personal, /^模型调用失败：账号来源/);
});

// Without an explicit source the first requested source is the intended one, never "any source that
// happens to appear in the list".
test("the first requested source is the fallback when none is given", () => {
  const text = modelSourceFailureMessage({
    provider: "tokenflux",
    model: "deepseek/deepseek-flash",
    requestedOrder: ["account", "personal"],
    locale: "en",
  });
  assert.match(text, /^Model call failed: account source \//);
  assert.doesNotMatch(text, /personal source/);
});
