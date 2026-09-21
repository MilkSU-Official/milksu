import assert from "node:assert/strict";
import test from "node:test";
import { companionSystemPrompt } from "./system-prompt.js";

test("companion default prompt follows the UI locale", () => {
  const chinese = companionSystemPrompt("zh");
  assert.match(chinese, /你是 MilkSU 桌宠/);
  assert.match(chinese, /companion_board/);
  assert.match(chinese, /companion_dispatch/);
  assert.match(chinese, /subagent/);
  assert.match(chinese, /Working/);
  assert.match(chinese, /编排/);
  assert.match(chinese, /companion_app/);
  assert.match(chinese, /speak_many/);
  assert.doesNotMatch(chinese, /You are the MilkSU companion/);
  assert.doesNotMatch(chinese, /这不是/);
  assert.doesNotMatch(chinese, /不拦/);

  const english = companionSystemPrompt("en");
  assert.match(english, /You are the MilkSU companion/);
  assert.match(english, /companion_board/);
  assert.match(english, /companion_dispatch/);
  assert.match(english, /subagent/);
  assert.match(english, /Working/);
  assert.match(english, /orchestrat/i);
  assert.match(english, /companion_app/);
  assert.match(english, /speak_many/);
  assert.doesNotMatch(english, /你是 MilkSU 桌宠/);
  assert.doesNotMatch(english, /this is not/i);
  assert.doesNotMatch(english, /we don't block/i);
});
