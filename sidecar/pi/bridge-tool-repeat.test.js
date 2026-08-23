import assert from "node:assert/strict";
import test from "node:test";
import {
  bashFamilyCommand,
  createToolRepeatGuard,
  exactRepeatLimit,
  exactRepeatReason,
  familyRepeatLimit,
  familyRepeatReason,
  inspectToolRepeat,
  promptToolLimit,
  toolBudgetPrompt,
  toolCallFamily,
  toolCallSignature,
} from "./bridge-tool-repeat.js";

test("normalizes bash pagination and growing grep -v filters into one family", () => {
  assert.equal(
    bashFamilyCommand('cd /Users/x/Code/milksu && find . -name "*.md" | head -50'),
    'find . -name "*.md" | head N',
  );
  assert.equal(
    bashFamilyCommand('find . -name "*.md" | head -200'),
    'find . -name "*.md" | head N',
  );
  assert.equal(
    toolCallFamily("bash", {
      command: "ps aux | grep -E sh | grep -v grep | grep -v WeChat | grep -v Chrome",
    }),
    toolCallFamily("bash", {
      command: "ps aux | grep -E sh | grep -v grep | grep -v WeChat",
    }),
  );
  assert.notEqual(
    toolCallSignature("bash", { command: "find . | head -50" }),
    toolCallSignature("bash", { command: "find . | head -100" }),
  );
});

test("allows several identical commands before stopping", () => {
  const guard = createToolRepeatGuard();
  const call = { command: "ls /tmp" };
  for (let index = 0; index < exactRepeatLimit - 1; index += 1) {
    assert.equal(guard.inspect("bash", call), undefined);
  }
  assert.deepEqual(guard.inspect("bash", call), {
    block: true,
    terminate: true,
    reason: exactRepeatReason,
  });
});

test("asks once the prompt reaches the tool budget instead of stopping", () => {
  const history = Array.from({ length: promptToolLimit - 1 }, (_, index) => ({
    signature: `bash\0echo ${index}`,
    family: `bash\0echo ${index}`,
  }));
  assert.deepEqual(
    inspectToolRepeat(history, "bash", { command: `echo ${promptToolLimit}` }),
    { ask: true, count: promptToolLimit },
  );
  assert.equal(toolBudgetPrompt(150), "已经调用了 150 次工具，要继续吗？");
});

test("blocks a growing find | head family only after many near-duplicates", () => {
  const guard = createToolRepeatGuard();
  for (let n = 1; n < familyRepeatLimit; n += 1) {
    assert.equal(guard.inspect("bash", { command: `find . -name "*.ts" | head -${n}` }), undefined);
  }
  assert.deepEqual(
    guard.inspect("bash", { command: `find . -name "*.ts" | head -${familyRepeatLimit}` }),
    { block: true, terminate: true, reason: familyRepeatReason },
  );
});

test("does not treat distinct read offsets as a loop", () => {
  const guard = createToolRepeatGuard();
  for (const offset of [0, 80, 160, 240, 320, 400]) {
    assert.equal(guard.inspect("read", { path: "README.md", offset, limit: 80 }), undefined);
  }
});

test("resets between user prompts", () => {
  const guard = createToolRepeatGuard();
  const call = { command: "pwd" };
  for (let index = 0; index < 4; index += 1) guard.inspect("bash", call);
  guard.reset();
  assert.equal(guard.inspect("bash", call), undefined);
});
