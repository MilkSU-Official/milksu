import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { steerSession } from "./bridge-steering.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("baseline: Pi steer is queued after tool calls, not mid-stream abort", async () => {
  const source = await readFile(
    join(root, "node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js"),
    "utf8",
  );
  assert.match(
    source,
    /Delivered after the current assistant turn finishes executing its tool calls/,
  );
  assert.match(source, /before the next LLM call/);
});

test("baseline: MilkSU steer_message only calls session.steer", async () => {
  const calls = [];
  await steerSession(new Map([["c1", { async steer(message) { calls.push(message); } }]]), {
    conversationId: "c1",
    prompt: "改用另一条路径",
  });
  assert.deepEqual(calls, ["改用另一条路径"]);
});
