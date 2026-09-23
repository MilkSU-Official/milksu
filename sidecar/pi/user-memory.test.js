import test from "node:test";
import assert from "node:assert/strict";
import {
  applyUserMemorySnapshot,
  isCompanionRelay,
  tracksUserMemory,
  userMemoryBody,
  withUserMemoryMessages,
} from "./user-memory.js";

test("probe sessions and companion relays are not user-memory sources", () => {
  assert.equal(tracksUserMemory("coding-1"), true);
  assert.equal(tracksUserMemory("milksu_text_projection_1"), false);
  assert.equal(tracksUserMemory("milksu_model_probe_1"), false);
  assert.equal(isCompanionRelay("看板娘转达 / Companion relay:\n去看一下"), true);
  assert.equal(isCompanionRelay("以后都用中文回复我"), false);
});

test("user memory keeps every fact inside the coding budget", () => {
  const body = userMemoryBody([
    { id: "mem_a", title: "语言", markdown: "回复保持简体中文".repeat(80), at: "2026-09-23T00:00:00.000Z" },
    { id: "mem_b", title: "称呼", markdown: "称呼用 Milk", at: "2026-09-23T00:00:01.000Z" },
    { id: "mem_c", title: "语言", markdown: "回复保持简体中文".repeat(80), at: "2026-09-23T00:00:02.000Z" },
  ], 30);
  assert.match(body, /语言/);
  assert.match(body, /称呼/);
});

test("injected user memory is a hidden custom message and can be replaced", () => {
  const first = withUserMemoryMessages(
    [{ role: "user", content: "hello" }],
    [{ id: "mem_a", title: "称呼", markdown: "称呼用 Milk" }],
  );
  assert.equal(first[0].customType, "milksu.user-memory");
  assert.equal(first[0].display, false);
  assert.match(first[0].content[0].text, /称呼用 Milk/);
  assert.equal(first[1].content, "hello");
  const cleared = withUserMemoryMessages(first, []);
  assert.equal(cleared.length, 1);
  assert.equal(cleared[0].content, "hello");
});

test("an older memory snapshot does not replace a newer one", () => {
  const next = applyUserMemorySnapshot(
    { memories: [{ id: "mem_b" }], revision: 4 },
    [{ id: "mem_a" }],
    3,
  );
  assert.equal(next.applied, false);
  assert.equal(next.memories[0].id, "mem_b");
});
