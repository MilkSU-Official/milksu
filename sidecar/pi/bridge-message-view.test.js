import assert from "node:assert/strict";
import test from "node:test";
import { projectAssistantMessageEnd } from "./bridge-message-view.js";

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

test("surfaces an assistant error even when the model returned no text", () => {
  assert.deepEqual(projectAssistantMessageEnd({
    role: "assistant",
    content: [],
    stopReason: "error",
    errorMessage: "Request timed out.",
  }), [{
    type: "error",
    data: { error: "Request timed out." },
  }]);
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
