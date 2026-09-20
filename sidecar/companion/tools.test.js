import assert from "node:assert/strict";
import test from "node:test";
import {
  COMPANION_TOOL_NAMES,
  FORBIDDEN_COMPANION_TOOL_NAMES,
  PI_COMPANION_TOOL_NAMES,
  assertNoRuntimeWriteTools,
  companionSessionToolNames,
  companionToolNames,
  createCompanionTools,
} from "./tools.js";

test("companion custom tools stay the three typed product tools", () => {
  const tools = createCompanionTools(async () => ({}));
  assert.deepEqual(tools.map(tool => tool.name).sort(), [...COMPANION_TOOL_NAMES].sort());
  assert.deepEqual(companionToolNames().sort(), [...COMPANION_TOOL_NAMES].sort());
});

test("companion session enables the full Pi tool loop plus companion tools", () => {
  const names = companionSessionToolNames();
  for (const name of PI_COMPANION_TOOL_NAMES) {
    assert.equal(names.includes(name), true, name);
  }
  for (const name of COMPANION_TOOL_NAMES) {
    assert.equal(names.includes(name), true, name);
  }
  for (const name of FORBIDDEN_COMPANION_TOOL_NAMES) {
    assert.equal(names.includes(name), false, name);
  }
});

test("companion custom tools cannot write session runtime state", () => {
  assert.throws(
    () => assertNoRuntimeWriteTools(["companion_board", "mark_complete"]),
    /mark_complete/,
  );
  for (const name of FORBIDDEN_COMPANION_TOOL_NAMES) {
    assert.equal(COMPANION_TOOL_NAMES.includes(name), false);
    assert.equal(PI_COMPANION_TOOL_NAMES.includes(name), false);
  }
});

test("memory search path does not write", async () => {
  const calls = [];
  const [board, dispatch, memory] = createCompanionTools(async (action, input) => {
    calls.push({ action, input });
    return { written: false, results: [] };
  }, {
    queryMemory: async () => ({ written: false, results: [{ sessionId: "s1", snippet: "auth" }] }),
  });
  assert.equal(board.name, "companion_board");
  assert.equal(dispatch.name, "companion_dispatch");
  const result = await memory.execute("1", { action: "search", query: "auth" });
  assert.equal(calls.length, 0);
  assert.match(result.content[0].text, /"written":false/);
});

test("dispatch host request does not time out while waiting for confirmation", async () => {
  const [,,] = [];
  const tools = createCompanionTools(async (action, _input, options) => {
    assert.equal(action, "dispatch");
    assert.equal(options?.timeoutMs, 0);
    return { needsConfirmation: true, accepted: false, delivered: false };
  });
  const dispatch = tools.find(tool => tool.name === "companion_dispatch");
  assert.match(dispatch.description, /immediately/i);
  assert.match(dispatch.description, /confirm button/i);
  const result = await dispatch.execute("1", {
    action: "stop",
    conversationId: "live",
    idempotencyKey: "k1",
  });
  assert.match(result.content[0].text, /needsConfirmation/);
});
