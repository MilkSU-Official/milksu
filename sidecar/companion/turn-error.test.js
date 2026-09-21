import assert from "node:assert/strict";
import test from "node:test";
import {
  companionAssistantTurnError,
  companionToolHistoryBroken,
  repairCompanionToolHistory,
} from "./turn-error.js";

test("projects the last assistant errorMessage", () => {
  assert.equal(companionAssistantTurnError([
    { message: { role: "user", content: [{ type: "text", text: "hi" }] } },
    {
      message: {
        role: "assistant",
        content: [],
        stopReason: "error",
        errorMessage: "403: group does not support the requested model",
      },
    },
  ]), "403: group does not support the requested model");
});

test("does not treat a completed assistant turn as an error", () => {
  assert.equal(companionAssistantTurnError([
    { role: "assistant", content: [{ type: "text", text: "ok" }], stopReason: "stop" },
  ]), "");
});

test("does not treat a tool-call turn as an empty reply", () => {
  assert.equal(companionAssistantTurnError([
    {
      role: "assistant",
      content: [{ type: "toolCall", id: "call-1", name: "read" }],
      stopReason: "toolUse",
    },
  ]), "");
});

test("does not treat a thinking-only turn as an empty reply", () => {
  assert.equal(companionAssistantTurnError([
    {
      role: "assistant",
      content: [{ type: "thinking", thinking: "先看看板。" }],
      stopReason: "stop",
    },
  ]), "");
});

test("does not treat stopReason toolUse as an empty reply", () => {
  assert.equal(companionAssistantTurnError([
    {
      role: "assistant",
      content: [],
      stopReason: "toolUse",
    },
  ]), "");
});

test("treats a completed turn with no text as a failure", () => {
  assert.equal(companionAssistantTurnError([
    { message: { role: "assistant", content: [], stopReason: "stop" } },
  ]), "companion model returned no text");
});

test("uses a fallback when stopReason is error but errorMessage is empty", () => {
  assert.equal(companionAssistantTurnError([
    { role: "assistant", content: [], stopReason: "error" },
  ]), "companion model call failed");
});

test("detects unfinished toolCalls left without toolResults", () => {
  assert.equal(companionToolHistoryBroken([
    { role: "user", content: [{ type: "text", text: "hi" }] },
    {
      role: "assistant",
      content: [{ type: "toolCall", id: "call-1", name: "companion_app" }],
      stopReason: "toolUse",
    },
  ]), true);
  assert.equal(companionToolHistoryBroken([
    { role: "user", content: [{ type: "text", text: "hi" }] },
    {
      role: "assistant",
      content: [{ type: "toolCall", id: "call-1", name: "read" }],
      stopReason: "toolUse",
    },
    { role: "toolResult", toolCallId: "call-1", content: [{ type: "text", text: "ok" }] },
    { role: "assistant", content: [{ type: "text", text: "done" }], stopReason: "stop" },
  ]), false);
  assert.equal(companionToolHistoryBroken([
    {
      role: "assistant",
      content: [{ type: "toolCall", id: "call-1", name: "bash" }],
      stopReason: "toolUse",
    },
    { role: "user", content: [{ type: "text", text: "next" }] },
  ]), true);
});

test("repairCompanionToolHistory appends synthetic error toolResults", () => {
  const broken = [
    { role: "user", content: [{ type: "text", text: "hi" }] },
    {
      role: "assistant",
      content: [{ type: "toolCall", id: "call-1", name: "companion_dispatch" }],
      stopReason: "toolUse",
    },
  ];
  const { messages, repairedCount, repaired } = repairCompanionToolHistory(
    broken,
    "companion tool interrupted by abort",
  );
  assert.equal(repairedCount, 1);
  assert.equal(repaired[0].role, "toolResult");
  assert.equal(repaired[0].toolCallId, "call-1");
  assert.equal(repaired[0].isError, true);
  assert.equal(companionToolHistoryBroken(messages), false);
  assert.equal(companionToolHistoryBroken(broken), true);
});

test("repairCompanionToolHistory is a no-op when history is already complete", () => {
  const ok = [
    { role: "user", content: [{ type: "text", text: "hi" }] },
    {
      role: "assistant",
      content: [{ type: "toolCall", id: "call-1", name: "read" }],
      stopReason: "toolUse",
    },
    { role: "toolResult", toolCallId: "call-1", content: [{ type: "text", text: "ok" }] },
  ];
  const { messages, repairedCount } = repairCompanionToolHistory(ok);
  assert.equal(repairedCount, 0);
  assert.equal(messages, ok);
});

test("repairCompanionToolHistory covers multiple dangling toolCalls", () => {
  const broken = [
    {
      role: "assistant",
      content: [
        { type: "toolCall", id: "a", name: "companion_board" },
        { type: "toolCall", id: "b", name: "companion_app" },
      ],
      stopReason: "toolUse",
    },
  ];
  const { messages, repairedCount } = repairCompanionToolHistory(broken, "aborted");
  assert.equal(repairedCount, 2);
  assert.equal(companionToolHistoryBroken(messages), false);
});
