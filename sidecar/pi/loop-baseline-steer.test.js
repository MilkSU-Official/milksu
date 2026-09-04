import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { steerSession } from "./bridge-steering.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("baseline: old Pi steer-after-tools contract was replaced by mid-turn abort+steer", async () => {
  const source = await readFile(
    join(root, "node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js"),
    "utf8",
  );
  // Historical Pi 0.84.1 comment: native steer() still waits for the tool batch.
  // MilkSU now queues steer then aborts the assistant stream when no bash is running.
  assert.match(
    source,
    /Delivered after the current assistant turn finishes executing its tool calls/,
  );
  assert.match(source, /before the next LLM call/);

  const calls = [];
  await steerSession(new Map([["c1", {
    isStreaming: true,
    isIdle: false,
    isBashRunning: false,
    async abort() {
      calls.push("abort");
    },
    async steer(message) {
      calls.push(["steer", message]);
    },
    async prompt() {
      calls.push("prompt");
    },
  }]]), {
    conversationId: "c1",
    prompt: "改用另一条路径",
  });
  assert.deepEqual(calls, [["steer", "改用另一条路径"], "abort"]);
});
