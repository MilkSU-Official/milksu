import assert from "node:assert/strict";
import test from "node:test";
import {
  isRecoverableContextOverflowError,
  isRetryableProviderError,
  projectAssistantMessageEnd,
  shouldDeferTerminalAssistantError,
} from "./bridge-message-view.js";

test("projects unstreamed thinking before the visible reply", () => {
  assert.deepEqual(projectAssistantMessageEnd({
    role: "assistant",
    content: [
      { type: "thinking", thinking: "read the file first" },
      { type: "text", text: "done" },
    ],
    stopReason: "stop",
  }), [
    { type: "thinking_done", data: { content: "read the file first" } },
    { type: "message_done", data: { reason: "stop", content: "done" } },
  ]);
});

test("does not replay thinking that already streamed", () => {
  const events = projectAssistantMessageEnd({
    role: "assistant",
    content: [
      { type: "thinking", thinking: "already sent" },
      { type: "text", text: "done" },
    ],
    stopReason: "stop",
  }, { thinkingStreamed: true });
  assert.equal(events.some(event => event.type === "thinking_done"), false);
});

test("drops redacted thinking from the product surface", () => {
  assert.deepEqual(projectAssistantMessageEnd({
    role: "assistant",
    content: [
      { type: "thinking", thinking: "", redacted: true, thinkingSignature: "opaque" },
      { type: "text", text: "ok" },
    ],
    stopReason: "stop",
  }), [{
    type: "message_done",
    data: { reason: "stop", content: "ok" },
  }]);
});

test("projects a completed assistant response", () => {
  assert.deepEqual(projectAssistantMessageEnd({
    role: "assistant",
    content: [{ type: "text", text: "done" }],
    stopReason: "stop",
  }), [{
    type: "message_done",
    data: { reason: "stop", content: "done" },
  }]);
});

test("keeps tool-bearing assistant output as a segment", () => {
  assert.deepEqual(projectAssistantMessageEnd({
    role: "assistant",
    content: [
      { type: "text", text: "checking" },
      { type: "toolCall", name: "read" },
    ],
    stopReason: "toolUse",
  }), [{
    type: "message_segment_done",
    data: { reason: "toolUse", content: "checking" },
  }]);
});

test("surfaces a permanent assistant error even when the model returned no text", () => {
  assert.deepEqual(projectAssistantMessageEnd({
    role: "assistant",
    content: [],
    stopReason: "error",
    errorMessage: "invalid api key",
  }), [{
    type: "error",
    data: { error: "invalid api key" },
  }]);
});

test("defers timeout errors so Pi can retry inside the same turn", () => {
  assert.deepEqual(projectAssistantMessageEnd({
    role: "assistant",
    content: [],
    stopReason: "error",
    errorMessage: "Request timed out.",
  }), []);
});

test("finishes partial streamed text before surfacing the model error", () => {
  assert.deepEqual(projectAssistantMessageEnd({
    role: "assistant",
    content: [{ type: "text", text: "partial" }],
    stopReason: "error",
    errorMessage: "Provider disconnected",
  }, { textStreamed: true }), [
    {
      type: "message_done",
      data: { reason: "error", content: "partial" },
    },
    {
      type: "error",
      data: { error: "Provider disconnected" },
    },
  ]);
});

test("uses a bounded product fallback when an error has no message", () => {
  assert.deepEqual(projectAssistantMessageEnd({
    role: "assistant",
    content: [],
    stopReason: "error",
  }), [{
    type: "error",
    data: { error: "Model request failed before producing a response" },
  }]);
});

test("does not invent a response for an empty non-error message", () => {
  assert.deepEqual(projectAssistantMessageEnd({
    role: "assistant",
    content: [],
    stopReason: "stop",
  }), []);
});

test("does not project a tool-only assistant turn as a blank message", () => {
  assert.deepEqual(projectAssistantMessageEnd({
    role: "assistant",
    content: [{ type: "toolCall", name: "read" }],
    stopReason: "toolUse",
  }, { textStreamed: true }), []);
});

test("does not project context overflow as a terminal error so Pi can auto-compact", () => {
  assert.equal(
    isRecoverableContextOverflowError("Your input exceeds the context window of this model"),
    true,
  );
  assert.deepEqual(projectAssistantMessageEnd({
    role: "assistant",
    content: [],
    stopReason: "error",
    errorMessage: "Your input exceeds the context window of this model",
  }), []);

  assert.deepEqual(projectAssistantMessageEnd({
    role: "assistant",
    content: [{ type: "text", text: "partial" }],
    stopReason: "error",
    errorMessage: "prompt is too long: 213462 tokens > 200000 maximum",
  }, { textStreamed: true }), [{
    type: "message_done",
    data: { reason: "error", content: "partial" },
  }]);
});

test("defers rate-limit and other retryable provider errors until the turn settles", () => {
  assert.equal(
    isRecoverableContextOverflowError("Throttling error: Too many tokens, please wait"),
    false,
  );
  assert.equal(
    isRetryableProviderError("Throttling error: Too many tokens, please wait"),
    true,
  );
  assert.equal(
    shouldDeferTerminalAssistantError("Throttling error: Too many tokens, please wait"),
    true,
  );
  // Intermediate 429 must not finish the desktop turn before Pi retries.
  assert.deepEqual(projectAssistantMessageEnd({
    role: "assistant",
    content: [],
    stopReason: "error",
    errorMessage: "Throttling error: Too many tokens, please wait",
  }), []);

  assert.deepEqual(projectAssistantMessageEnd({
    role: "assistant",
    content: [],
    stopReason: "error",
    errorMessage: "429 rate limit exceeded",
  }), []);

  assert.deepEqual(projectAssistantMessageEnd({
    role: "assistant",
    content: [],
    stopReason: "error",
    errorMessage: "Service unavailable: 503 upstream",
  }), []);

  // TokenFlux / OpenAI-compatible clients report generic "Connection error."
  // Pi retries it in-turn; desktop must not finishRun on the first blip.
  assert.equal(isRetryableProviderError("Connection error."), true);
  assert.equal(shouldDeferTerminalAssistantError("Connection error."), true);
  assert.deepEqual(projectAssistantMessageEnd({
    role: "assistant",
    content: [],
    stopReason: "error",
    errorMessage: "Connection error.",
  }), []);
});

test("still surfaces permanent model errors immediately", () => {
  assert.equal(isRetryableProviderError("Model not found"), false);
  assert.deepEqual(projectAssistantMessageEnd({
    role: "assistant",
    content: [],
    stopReason: "error",
    errorMessage: "Model not found",
  }), [{
    type: "error",
    data: { error: "Model not found" },
  }]);
});
