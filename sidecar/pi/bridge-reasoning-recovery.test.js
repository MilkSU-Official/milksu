import assert from "node:assert/strict";
import test from "node:test";
import {
  createReasoningOnlyRecoveryExtension,
  isReasoningOnlyFinal,
  reasoningOnlyRecoveryMessage,
  shouldRecoverReasoningOnlyTurn,
  summarizeReasoningOnlyFinal,
} from "./bridge-reasoning-recovery.js";

function thinkingOnly(stopReason = "stop") {
  return {
    role: "assistant",
    stopReason,
    provider: "tokenflux",
    model: "deepseek/deepseek-flash",
    usage: { output: 481, reasoning: 481 },
    content: [{
      type: "thinking",
      thinking: "完整中文答复：下一步先核对模型推理预算。",
    }],
  };
}

function harness(options = {}) {
  const listeners = new Map();
  const sent = [];
  const state = {
    aborted: false,
    recovered: false,
    tools: ["read", "bash"],
    noToolsApplied: 0,
    restored: 0,
  };
  createReasoningOnlyRecoveryExtension({
    isAborted: () => state.aborted,
    wasRecovered: () => state.recovered,
    markRecovered: () => {
      state.recovered = true;
    },
    applyNoTools: () => {
      state.noToolsApplied += 1;
      state.tools = [];
    },
    restoreTools: () => {
      state.restored += 1;
      state.tools = ["read", "bash"];
    },
    ...options,
  })({
    on: (name, listener) => listeners.set(name, listener),
    sendMessage: (message, sendOptions) => sent.push({ message, options: sendOptions }),
  });
  return { listeners, sent, state };
}

test("detects a stop with thinking and no visible text", () => {
  assert.equal(isReasoningOnlyFinal(thinkingOnly()), true);
  assert.equal(shouldRecoverReasoningOnlyTurn({
    stopReason: "stop",
    thinking: "内部结论",
    text: "",
    hasToolCall: false,
  }), true);
});

test("does not recover tool, error, aborted, or visible-text finals", () => {
  assert.equal(isReasoningOnlyFinal(thinkingOnly("toolUse")), false);
  assert.equal(isReasoningOnlyFinal(thinkingOnly("error")), false);
  assert.equal(isReasoningOnlyFinal(thinkingOnly("aborted")), false);
  assert.equal(isReasoningOnlyFinal({
    role: "assistant",
    stopReason: "stop",
    content: [
      { type: "thinking", thinking: "plan" },
      { type: "text", text: "done" },
    ],
  }), false);
  assert.equal(isReasoningOnlyFinal({
    role: "assistant",
    stopReason: "stop",
    content: [
      { type: "thinking", thinking: "plan" },
      { type: "toolCall", name: "read" },
    ],
  }), false);
  assert.equal(isReasoningOnlyFinal({
    role: "assistant",
    stopReason: "stop",
    content: [],
  }), false);
});

test("sends one hidden no-tool follow-up and does not copy thinking", async () => {
  const { listeners, sent, state } = harness();
  await listeners.get("agent_end")({ messages: [thinkingOnly()] });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].message.display, false);
  assert.doesNotMatch(sent[0].message.content, /完整中文答复/);
  assert.doesNotMatch(sent[0].message.content, /推理预算/);
  assert.match(sent[0].message.content, /no user-visible reply/);
  assert.deepEqual(sent[0].options, { deliverAs: "followUp", triggerTurn: true });
  assert.equal(state.noToolsApplied, 1);
  assert.equal(state.tools.length, 0);

  await listeners.get("agent_end")({ messages: [thinkingOnly()] });
  assert.equal(sent.length, 1);
  assert.equal(state.restored, 1);
  assert.deepEqual(state.tools, ["read", "bash"]);
});

test("does not recover after abort and restores tools", async () => {
  const { listeners, sent, state } = harness();
  state.aborted = true;
  await listeners.get("agent_end")({ messages: [thinkingOnly()] });
  assert.equal(sent.length, 0);
  assert.equal(state.restored, 1);
});

test("sanitized diagnostics omit thinking and credentials", () => {
  const summary = summarizeReasoningOnlyFinal(thinkingOnly(), {
    provider: "tokenflux",
    model: "deepseek/deepseek-flash",
  });
  const serialized = JSON.stringify(summary);
  assert.equal(summary.reasoningChars > 0, true);
  assert.equal(summary.contentChars, 0);
  assert.equal(summary.outputTokens, 481);
  assert.equal(summary.reasoningTokens, 481);
  assert.doesNotMatch(serialized, /完整中文答复/);
  assert.doesNotMatch(serialized, /sk-|api[_-]?key/i);
  const recovery = reasoningOnlyRecoveryMessage();
  assert.equal(recovery.display, false);
});
