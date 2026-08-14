import assert from "node:assert/strict";
import test from "node:test";
import {
  projectAssistantUsage,
  projectToolModelUsage,
} from "./bridge-usage-view.js";

test("projects credential-free assistant usage with a stable id", () => {
  const message = {
    role: "assistant",
    provider: "milksu-route",
    model: "openai/gpt-5.6-sol",
    responseId: "response-1",
    timestamp: Date.parse("2026-08-14T08:00:00Z"),
    stopReason: "stop",
    usage: {
      input: 120,
      output: 40,
      cacheRead: 80,
      cacheWrite: 10,
      reasoning: 15,
      totalTokens: 250,
      cost: { total: 0.05 },
    },
  };
  const first = projectAssistantUsage(message, {
    conversationId: "conversation-1",
    module: "coding",
    provider: "tokenflux",
    source: "account",
  });
  const second = projectAssistantUsage(message, {
    conversationId: "conversation-1",
    module: "coding",
    provider: "tokenflux",
    source: "account",
  });
  assert.deepEqual(first, second);
  assert.equal(first.provider, "tokenflux");
  assert.equal(first.model, "openai/gpt-5.6-sol");
  assert.equal(first.source, "account");
  assert.equal(first.totalTokens, 250);
  assert.equal(first.reasoningTokens, 15);
  assert.equal(first.occurredAt, "2026-08-14T08:00:00.000Z");
  assert.equal("content" in first, false);
});

test("projects each subagent model without persisting task text", () => {
  const records = projectToolModelUsage({
    details: {
      results: [{
        model: "anthropic/claude-sonnet-4.5",
        task: "sensitive task body",
        exitCode: 0,
        usage: {
          input: 900,
          output: 100,
          cacheRead: 300,
          cacheWrite: 0,
          cost: 0.25,
        },
      }],
    },
  }, {
    conversationId: "conversation-1",
    toolCallId: "tool-1",
    toolName: "subagent",
    module: "coding",
    provider: "tokenflux",
    source: "personal",
  });
  assert.equal(records.length, 1);
  assert.equal(records[0].model, "anthropic/claude-sonnet-4.5");
  assert.equal(records[0].totalTokens, 1300);
  assert.equal(JSON.stringify(records).includes("sensitive task body"), false);
});

test("projects image generation usage from its bounded receipt", () => {
  const records = projectToolModelUsage({
    details: {
      schema: "milksu-imagegen-receipt/v1",
      status: "completed",
      provider: "openai",
      model: "gpt-image-1.5",
      providerRequestId: "request-1",
      usage: { inputTokens: 42, outputTokens: 196, totalTokens: 238 },
    },
  }, {
    conversationId: "conversation-1",
    toolCallId: "tool-2",
    toolName: "imagegen",
    module: "coding",
  });
  assert.equal(records.length, 1);
  assert.equal(records[0].totalTokens, 238);
  assert.equal(records[0].source, "personal");
});
