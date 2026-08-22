"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  knownContextWindow,
  resolveModelContextWindow,
} = require("./known-context-window.cjs");

test("resolves known series and keeps explicit catalog windows", () => {
  assert.equal(knownContextWindow("x-ai/grok-4.6"), 500_000);
  assert.equal(resolveModelContextWindow("grok-4.6", 0), 500_000);
  assert.equal(resolveModelContextWindow("grok-4.6", 128_000), 500_000);
  assert.equal(resolveModelContextWindow("grok-4.6", 256_000), 256_000);
  assert.equal(resolveModelContextWindow("x-ai/grok-4-fast-reasoning", 128_000), 1_000_000);
  assert.equal(resolveModelContextWindow("x-ai/grok-build-0.1", 128_000), 256_000);
  assert.equal(resolveModelContextWindow("openai/gpt-5-mini", 128_000), 400_000);
  assert.equal(resolveModelContextWindow("openai/gpt-5.5", 128_000), 1_050_000);
  assert.equal(resolveModelContextWindow("openai/gpt-5.4", 128_000), 1_050_000);
  assert.equal(resolveModelContextWindow("openai/gpt-5.4-mini", 128_000), 400_000);
  assert.equal(resolveModelContextWindow("openai/gpt-5.3-chat-latest", 128_000), 128_000);
  assert.equal(resolveModelContextWindow("openai/gpt-4.1-mini", 128_000), 1_047_576);
  assert.equal(resolveModelContextWindow("anthropic/claude-sonnet-4.5", 128_000), 200_000);
  assert.equal(resolveModelContextWindow("anthropic/claude-sonnet-5", 128_000), 1_000_000);
  assert.equal(resolveModelContextWindow("anthropic/claude-opus-4-8", 128_000), 1_000_000);
  assert.equal(resolveModelContextWindow("anthropic/claude-opus-4-6", 128_000), 1_000_000);
  assert.equal(resolveModelContextWindow("custom-128k", 128_000), 128_000);
  assert.equal(resolveModelContextWindow("custom-unknown", 0), 0);
});
