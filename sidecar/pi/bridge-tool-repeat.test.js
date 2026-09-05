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
  statusPollBudgetLimit,
  statusPollFamily,
  statusPollLimit,
  statusPollReason,
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

test("treats bg_status status and log on the same id as one exact family", () => {
  assert.equal(
    toolCallSignature("bg_status", { action: "status", id: "bg_one" }),
    toolCallSignature("bg_status", { action: "log", id: "bg_one" }),
  );
  assert.notEqual(
    toolCallSignature("bg_status", { action: "status", id: "bg_one" }),
    toolCallSignature("bg_status", { action: "status", id: "bg_two" }),
  );
  assert.equal(toolCallFamily("bg_status", { action: "status", id: "bg_one" }), statusPollFamily);
  assert.equal(toolCallFamily("bg_status", { action: "log", id: "bg_two" }), statusPollFamily);
});

test("stops a trailing bg_status poller before the generic family limit", () => {
  const guard = createToolRepeatGuard();
  for (let index = 0; index < statusPollLimit - 1; index += 1) {
    assert.equal(guard.inspect("bg_status", { action: "status", id: `bg_${index}` }), undefined);
  }
  assert.deepEqual(
    guard.inspect("bg_status", { action: "log", id: "bg_final" }),
    { block: true, terminate: true, reason: statusPollReason },
  );
});

test("a bg_task spawn resets the bg_status poller streak", () => {
  const guard = createToolRepeatGuard();
  for (let index = 0; index < statusPollLimit - 1; index += 1) {
    assert.equal(guard.inspect("bg_status", { action: "status", id: `bg_${index}` }), undefined);
  }
  assert.equal(guard.inspect("bg_task", { action: "spawn", command: "echo ready" }), undefined);
  assert.equal(guard.inspect("bg_status", { action: "status", id: "bg_after_spawn" }), undefined);
});

test("stops the same background task id after many status or log calls", () => {
  const guard = createToolRepeatGuard();
  for (let index = 0; index < exactRepeatLimit - 1; index += 1) {
    const action = index % 2 === 0 ? "status" : "log";
    assert.equal(guard.inspect("bg_status", { action, id: "bg_same" }), undefined);
  }
  assert.deepEqual(
    guard.inspect("bg_status", { action: "status", id: "bg_same" }),
    { block: true, terminate: true, reason: exactRepeatReason },
  );
});

test("tool budget terminates a status poller instead of asking to continue", () => {
  const history = Array.from({ length: promptToolLimit - statusPollBudgetLimit }, (_, index) => ({
    signature: `bash\0echo ${index}`,
    family: `bash\0echo ${index}`,
  }));
  for (let index = 0; index < statusPollBudgetLimit - 1; index += 1) {
    history.push({
      signature: `bg_status\0bg_${index}`,
      family: statusPollFamily,
    });
  }
  assert.deepEqual(
    inspectToolRepeat(history, "bg_status", { action: "status", id: "bg_budget" }),
    { block: true, terminate: true, reason: statusPollReason },
  );
});
