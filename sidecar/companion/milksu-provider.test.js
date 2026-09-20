import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMilksuConversationProvider } from "./milksu-provider.js";

function drain(provider, unit) {
  const records = [];
  const iterator = provider.parse(unit);
  let step = iterator.next();
  while (!step.done) {
    records.push(step.value);
    step = iterator.next();
  }
  return { records, cursor: step.value };
}

test("MilkSU provider discovers conversation JSON and emits session plus messages", async () => {
  const root = await mkdtemp(join(tmpdir(), "milksu-provider-"));
  try {
    await writeFile(join(root, "coding-1.json"), `${JSON.stringify({
      id: "coding-1",
      title: "Coding work",
      createdAt: Date.parse("2026-09-20T00:00:00.000Z"),
      workspacePath: "/workspace",
      messages: [
        { id: "u1", role: "user", content: "fixed the auth handler", timestamp: Date.parse("2026-09-20T00:00:01.000Z") },
        { id: "a1", role: "assistant", content: "updated the login path", timestamp: Date.parse("2026-09-20T00:00:02.000Z") },
        { id: "t1", role: "tool", content: "should be ignored", timestamp: Date.parse("2026-09-20T00:00:03.000Z") },
      ],
    })}\n`);
    const provider = createMilksuConversationProvider({ rootDir: root });
    const units = provider.discover({ lastCursor: () => null });
    assert.equal(units.length, 1);
    assert.equal(units[0].sessionId, "coding-1");
    const { records } = drain(provider, units[0]);
    assert.equal(records[0].kind, "session");
    assert.equal(records[0].source, "milksu");
    assert.equal(records[0].title, "Coding work");
    assert.equal(records[0].message_count, 2);
    assert.equal(records.filter(record => record.kind === "message").length, 2);
    assert.ok(records.some(record => record.kind === "message" && /auth handler/.test(record.text)));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("MilkSU provider reads archived conversations and skips unchanged files", async () => {
  const root = await mkdtemp(join(tmpdir(), "milksu-provider-archived-"));
  try {
    await mkdir(join(root, "archived"), { recursive: true });
    await writeFile(join(root, "live.json"), `${JSON.stringify({
      id: "live",
      title: "Live",
      messages: [{ id: "u1", role: "user", content: "hello", timestamp: 1 }],
    })}\n`);
    await writeFile(join(root, "archived", "old.json"), `${JSON.stringify({
      id: "old",
      title: "Old",
      messages: [{ id: "u2", role: "user", content: "archived note", timestamp: 2 }],
    })}\n`);
    const provider = createMilksuConversationProvider({ rootDir: root });
    const first = provider.discover({ lastCursor: () => null });
    assert.equal(first.length, 2);
    assert.ok(first.some(unit => unit.sessionId === "old"));
    const cursors = new Map(first.map(unit => [unit.key, drain(provider, unit).cursor]));
    const second = provider.discover({ lastCursor: key => cursors.get(key) ?? null });
    assert.equal(second.length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
