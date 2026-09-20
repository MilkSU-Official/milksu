import assert from "node:assert/strict";
import test from "node:test";
import { companionSystemPrompt } from "./system-prompt.js";

test("companion default prompt follows the UI locale", () => {
  const chinese = companionSystemPrompt("zh");
  assert.match(chinese, /你是 MilkSU 桌宠/);
  assert.match(chinese, /companion_board/);
  assert.doesNotMatch(chinese, /You are the MilkSU companion/);

  const english = companionSystemPrompt("en");
  assert.match(english, /You are the MilkSU companion/);
  assert.match(english, /companion_board/);
  assert.doesNotMatch(english, /你是 MilkSU 桌宠/);
});
