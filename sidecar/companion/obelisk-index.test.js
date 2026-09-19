import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openCompanionIndex, scheduleIndex } from "./obelisk-index.js";

test("companion FTS index writes asynchronously and stays searchable", async () => {
  const dir = await mkdtemp(join(tmpdir(), "milksu-companion-fts-"));
  const index = await openCompanionIndex(join(dir, "obelisk.sqlite"));
  try {
    let finished = false;
    scheduleIndex(index, {
      sessionId: "coding-1",
      title: "Coding work",
      snippet: "fixed the auth handler",
      kernel: "pi",
    });
    assert.equal(finished, false);
    await new Promise(resolve => setTimeout(resolve, 10));
    finished = true;
    const hits = index.search("auth");
    assert.ok(hits.some(hit => hit.sessionId === "coding-1"));
  } finally {
    index.close();
    await rm(dir, { recursive: true, force: true });
  }
});
