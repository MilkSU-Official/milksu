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
  assert.equal(resolveModelContextWindow("custom-128k", 128_000), 128_000);
  assert.equal(resolveModelContextWindow("custom-unknown", 0), 0);
});
