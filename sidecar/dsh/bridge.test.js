import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import test from "node:test";

const here = dirname(fileURLToPath(import.meta.url));

function runBridge() {
  const child = spawn(process.execPath, [join(here, "run-bridge.mjs")], {
    cwd: here,
    env: {
      ...process.env,
      MILKSU_DSH_COMMAND: process.execPath,
      MILKSU_DSH_ACP_ARGS: join(here, "fake-acp.mjs"),
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const events = [];
  let buffer = "";
  child.stdout.on("data", chunk => {
    buffer += chunk.toString("utf8");
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      events.push(JSON.parse(line));
    }
  });
  function send(command) {
    child.stdin.write(`${JSON.stringify(command)}\n`);
  }
  async function waitFor(type, timeout = 3000) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      const match = events.find(event => event.type === type);
      if (match) return match;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw new Error(`timed out waiting for ${type}: ${JSON.stringify(events)}`);
  }
  return { child, events, send, waitFor };
}

test("DSH bridge reports a spawn failure as a JSONL error", async () => {
  const child = spawn(process.execPath, [join(here, "run-bridge.mjs")], {
    cwd: here,
    env: {
      ...process.env,
      MILKSU_DSH_COMMAND: join(here, "no-such-dsh-binary"),
      MILKSU_DSH_ACP_ARGS: "--profile acp",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const events = [];
  let buffer = "";
  child.stdout.on("data", chunk => {
    buffer += chunk.toString("utf8");
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      events.push(JSON.parse(line));
    }
  });
  try {
    child.stdin.write(`${JSON.stringify({
      action: "create_session",
      conversationId: "conv-missing",
      cwd: here,
    })}\n`);
    const started = Date.now();
    while (Date.now() - started < 2000) {
      const error = events.find(event => event.type === "error" && event.error);
      if (error) {
        assert.match(String(error.error), /ENOENT|not found|spawn/i);
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw new Error(`missing spawn error: ${JSON.stringify(events)}`);
  } finally {
    child.kill();
  }
});

test("DSH bridge streams a prompt through ACP", async () => {
  const bridge = runBridge();
  try {
    bridge.send({
      action: "send_message",
      conversationId: "conv-1",
      prompt: "hello",
      cwd: here,
    });
    const delta = await bridge.waitFor("text_delta");
    assert.equal(delta.delta, "ok");
    await bridge.waitFor("turn_settled");
  } finally {
    bridge.child.kill();
  }
});

test("DSH compact reports a real error when ACP has no compact method", async () => {
  const bridge = runBridge();
  try {
    bridge.send({
      action: "create_session",
      conversationId: "conv-3",
      cwd: here,
    });
    await bridge.waitFor("ready");
    bridge.send({
      action: "compact_session",
      conversationId: "conv-3",
      requestId: "compact-1",
    });
    const ended = await bridge.waitFor("compaction_end");
    assert.equal(ended.requestId, "compact-1");
    assert.match(String(ended.error ?? ""), /Unknown method|session\/compact/i);
  } finally {
    bridge.child.kill();
  }
});

test("DSH bridge abort does not throw", async () => {
  const bridge = runBridge();
  try {
    bridge.send({
      action: "create_session",
      conversationId: "conv-2",
      cwd: here,
    });
    await bridge.waitFor("ready");
    bridge.send({ action: "abort_session", conversationId: "conv-2" });
    const settled = await bridge.waitFor("turn_settled");
    assert.equal(settled.aborted, true);
  } finally {
    bridge.child.kill();
  }
});
