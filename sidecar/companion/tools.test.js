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

test("companion custom tools stay the typed product tools", () => {
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
  const tools = createCompanionTools(async (action, _input, options) => {
    assert.equal(action, "dispatch");
    assert.equal(options?.timeoutMs, 0);
    return { needsConfirmation: true, accepted: false, delivered: false };
  });
  const dispatch = tools.find(tool => tool.name === "companion_dispatch");
  assert.match(dispatch.description, /immediately/i);
  assert.match(dispatch.description, /speak_many/);
  assert.match(dispatch.description, /confirm button/i);
  assert.doesNotMatch(dispatch.description, /subagent/);
  assert.match(dispatch.description, /Working/);
  assert.match(dispatch.description, /create_conversation|steer/i);
  const result = await dispatch.execute("1", {
    action: "stop",
    conversationId: "live",
    idempotencyKey: "k1",
  });
  assert.match(result.content[0].text, /needsConfirmation/);
});

test("dispatch queue and app reads use the default host timeout", async () => {
  const seen = [];
  const tools = createCompanionTools(async (action, input, options) => {
    seen.push({ action, input, options });
    return { ok: true };
  });
  const dispatch = tools.find(tool => tool.name === "companion_dispatch");
  const app = tools.find(tool => tool.name === "companion_app");
  await dispatch.execute("1", {
    action: "speak",
    conversationId: "live",
    text: "hi",
    idempotencyKey: "k1",
    mode: "queue",
  });
  await app.execute("2", { action: "read_conversation", conversationId: "live" });
  await app.execute("3", { action: "patch_settings", patch: { companion_enabled: true } });
  assert.equal(seen[0].options, undefined);
  assert.equal(seen[1].options, undefined);
  assert.equal(seen[2].options?.timeoutMs, 0);
});

test("memory search timeout throws so Pi can emit an error toolResult and continue", async () => {
  const tools = createCompanionTools(async () => ({ ok: true }), {
    queryMemory: () => new Promise(() => {}),
  });
  const memory = tools.find(tool => tool.name === "companion_memory");
  await assert.rejects(
    () => memory.execute("1", { action: "search", query: "auth" }),
    /timed out \(memory\)/,
  );
});

test("dispatch host rejection throws so Pi can emit an error toolResult and continue", async () => {
  const tools = createCompanionTools(async () => {
    throw new Error("companion host request timed out (dispatch)");
  });
  const dispatch = tools.find(tool => tool.name === "companion_dispatch");
  await assert.rejects(
    () => dispatch.execute("1", {
      action: "speak",
      conversationId: "live",
      text: "hi",
      idempotencyKey: "k1",
    }),
    /timed out \(dispatch\)/,
  );
});

test("board text leads with the conversation title", async () => {
  const tools = createCompanionTools(async () => ({
    sessions: [{ id: "abc123dead", title: "修登录", status: "running" }],
    todos: [],
  }));
  const board = tools.find(tool => tool.name === "companion_board");
  const result = await board.execute("1", { action: "list" });
  assert.match(result.content[0].text, /^修登录/);
  assert.doesNotMatch(result.content[0].text, /^\[abc123dead\]/);
  assert.match(result.content[0].text, /conversationId: abc123dead/);
});

test("board host rejection throws so Pi can continue the loop", async () => {
  const tools = createCompanionTools(async () => {
    throw new Error("companion host request failed");
  });
  const board = tools.find(tool => tool.name === "companion_board");
  await assert.rejects(
    () => board.execute("1", { action: "list" }),
    /companion host request failed/,
  );
});
