import assert from "node:assert/strict";
import test from "node:test";
import {
  COMPANION_TOOL_NAMES,
  FORBIDDEN_COMPANION_TOOL_NAMES,
  assertNoRuntimeWriteTools,
  companionToolNames,
  createCompanionTools,
} from "./tools.js";

test("companion tool set is only the three typed product tools", () => {
  const tools = createCompanionTools(async () => ({}));
  assert.deepEqual(tools.map(tool => tool.name).sort(), [...COMPANION_TOOL_NAMES].sort());
  assert.deepEqual(companionToolNames().sort(), [...COMPANION_TOOL_NAMES].sort());
});

test("companion tool set cannot write session runtime state", () => {
  assert.throws(
    () => assertNoRuntimeWriteTools(["companion_board", "mark_complete"]),
    /mark_complete/,
  );
  for (const name of FORBIDDEN_COMPANION_TOOL_NAMES) {
    assert.equal(COMPANION_TOOL_NAMES.includes(name), false);
  }
});

test("memory search path does not write", async () => {
  const calls = [];
  const [board, dispatch, memory] = createCompanionTools(async (action, input) => {
    calls.push({ action, input });
    return { written: false, results: [] };
  });
  assert.equal(board.name, "companion_board");
  assert.equal(dispatch.name, "companion_dispatch");
  const result = await memory.execute("1", { action: "search", query: "auth" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].action, "memory");
  assert.equal(calls[0].input.action, "search");
  assert.match(result.content[0].text, /"written":false/);
});
