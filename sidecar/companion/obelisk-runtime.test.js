import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  queryCompanionMemory,
  refreshCompanionIndex,
  searchCompanionIndex,
} from "./obelisk-runtime.js";

test("Obelisk persist plus MilkSU provider is searchable and has a single writer", async () => {
  const root = await mkdtemp(join(tmpdir(), "milksu-obelisk-"));
  try {
    const conversations = join(root, "conversations");
    const indexPath = join(root, "obelisk.sqlite");
    await mkdir(conversations, { recursive: true });
    await writeFile(join(conversations, "coding-1.json"), `${JSON.stringify({
      id: "coding-1",
      title: "Coding work",
      messages: [
        { id: "u1", role: "user", content: "fixed the auth handler", timestamp: Date.parse("2026-09-20T00:00:01.000Z") },
      ],
    })}\n`);
    const roots = {
      piSessions: join(root, "pi"),
      dshSessions: join(root, "dsh"),
      companionSessions: join(root, "companion"),
      conversations,
    };
    const first = refreshCompanionIndex({ path: indexPath, roots });
    assert.equal(first.written, true);
    const hits = searchCompanionIndex("auth", { path: indexPath, limit: 8 });
    assert.ok(hits.some(hit => hit.sessionId === "coding-1" && /auth/.test(hit.snippet)));
    const recalled = await queryCompanionMemory(
      { action: "recall", sessionId: "coding-1" },
      { path: indexPath, roots },
    );
    assert.equal(recalled.written, false);
    assert.ok(recalled.messages.some(message => /auth handler/.test(message.text)));
    const second = refreshCompanionIndex({ path: indexPath, roots, waitMs: 0 });
    assert.ok(second.written === true || second.error === "writer_busy");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("turn search can skip the live companion transcript", async () => {
  const root = await mkdtemp(join(tmpdir(), "milksu-obelisk-"));
  try {
    const conversations = join(root, "conversations");
    const indexPath = join(root, "obelisk.sqlite");
    const roots = {
      piSessions: join(root, "pi"),
      dshSessions: join(root, "dsh"),
      companionSessions: join(root, "companion-sessions"),
      conversations,
    };
    await mkdir(conversations, { recursive: true });
    await writeFile(join(conversations, "coding-1.json"), `${JSON.stringify({
      id: "coding-1",
      title: "登录修复",
      messages: [
        { id: "u1", role: "user", content: "fixed the auth handler", timestamp: Date.parse("2026-09-20T00:00:01.000Z") },
      ],
    })}\n`);
    await writeFile(join(conversations, "companion.json"), `${JSON.stringify({
      id: "companion",
      title: "看板娘",
      messages: [
        { id: "u2", role: "user", content: "fixed the auth handler in this chat", timestamp: Date.parse("2026-09-21T00:00:01.000Z") },
      ],
    })}\n`);
    refreshCompanionIndex({ path: indexPath, roots });
    const hits = await queryCompanionMemory(
      { action: "search", query: "auth handler", excludeSessionId: "companion" },
      { path: indexPath, roots },
    );
    assert.equal(hits.written, false);
    assert.ok(hits.results.some(hit => hit.sessionId === "coding-1"));
    assert.equal(hits.results.some(hit => hit.sessionId === "companion"), false);
    assert.ok(hits.results.every(hit => hit.title && !hit.title.startsWith("[companion]")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("memory search stays read-only when the setting is off", async () => {
  const result = await queryCompanionMemory(
    { action: "search", query: "auth" },
    { memorySearchEnabled: false, path: "/does-not-exist/obelisk.sqlite" },
  );
  assert.equal(result.written, false);
  assert.deepEqual(result.results, []);
});
