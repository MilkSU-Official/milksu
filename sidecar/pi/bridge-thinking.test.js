import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeThinkingProfile,
  withModelThinkingProfile,
} from "./bridge-thinking.js";

test("thinking profiles keep only Pi-native levels", () => {
  assert.deepEqual(normalizeThinkingProfile({
    enabled: true,
    levels: ["medium", "ultra", "max"],
    level: "ultra",
  }), {
    enabled: true,
    levels: ["medium", "max"],
    level: "medium",
  });
});

test("enabled profiles expose only configured model levels", () => {
  const model = withModelThinkingProfile({
    id: "x-ai/grok-4.6",
    reasoning: false,
    compat: { supportsReasoningEffort: false },
  }, {
    enabled: true,
    levels: ["low", "high", "max"],
    level: "high",
  });
  assert.equal(model.reasoning, true);
  assert.equal(model.compat.supportsReasoningEffort, true);
  assert.equal(model.thinkingLevelMap.low, "low");
  assert.equal(model.thinkingLevelMap.medium, null);
  assert.equal(model.thinkingLevelMap.max, "max");
});

test("disabled profiles prevent an unsupported model from emitting effort", () => {
  const model = withModelThinkingProfile({
    id: "x-ai/grok-4.6",
    reasoning: true,
    compat: { supportsReasoningEffort: true },
  }, { enabled: false });
  assert.equal(model.reasoning, false);
  assert.equal(model.compat.supportsReasoningEffort, false);
  assert.equal(model.thinkingLevelMap, undefined);
});
