import assert from "node:assert/strict";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, isAbsolute, join } from "node:path";
import test from "node:test";
import { codingBrowserDescriptorFile, dshProductIpc } from "../hostpath.js";
import { dshPlaywrightMcpServerName } from "./mcp-servers.js";

const here = dirname(fileURLToPath(import.meta.url));

function runBridge(extraEnv = {}) {
  const child = spawn(process.execPath, [join(here, "run-bridge.mjs")], {
    cwd: here,
    env: {
      ...process.env,
      MILKSU_DSH_COMMAND: process.execPath,
      MILKSU_DSH_ACP_ARGS: join(here, "fake-acp.mjs"),
      ...extraEnv,
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

test("DSH compact reports a host IPC error instead of inventing session/compact", async () => {
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
    assert.match(String(ended.error ?? ""), /host IPC|ECONNREFUSED|ENOENT|not configured/i);
    assert.equal(/session\/compact/i.test(String(ended.error ?? "")), false);
  } finally {
    bridge.child.kill();
  }
});

test("DSH handoff reports a compact failure instead of opening an empty session", async () => {
  const bridge = runBridge();
  try {
    bridge.send({
      action: "create_session",
      conversationId: "conv-handoff-fail",
      cwd: here,
    });
    await bridge.waitFor("ready");
    bridge.send({
      action: "handoff_session",
      conversationId: "conv-handoff-fail",
      requestId: "handoff-1",
    });
    const handed = await bridge.waitFor("session_handoff");
    assert.equal(handed.requestId, "handoff-1");
    assert.match(String(handed.error ?? ""), /host IPC|ECONNREFUSED|ENOENT|not configured/i);
    assert.equal(handed.forkedSessionId, undefined);
    assert.equal(
      bridge.events.some(event => event.type === "ready" && event.id !== "conv-handoff-fail"),
      false,
    );
  } finally {
    bridge.child.kill();
  }
});

test("DSH handoff seeds the new session after compact", async () => {
  const hostPath = dshProductIpc(`host-handoff-${process.pid}`);
  try {
    unlinkSync(hostPath);
  } catch {
    // First listen.
  }
  const bridge = runBridge({ MILKSU_DSH_HOST_IPC: hostPath });
  try {
    bridge.send({
      action: "create_session",
      conversationId: "conv-handoff",
      cwd: here,
    });
    await bridge.waitFor("ready");
    const calls = [];
    const server = createServer(socket => {
      let buffer = "";
      socket.on("data", chunk => {
        buffer += chunk.toString("utf8");
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const message = JSON.parse(line);
          calls.push(message);
          if (message.method === "compact") {
            socket.write(`${JSON.stringify({
              id: message.id,
              result: {
                tokensBefore: 80,
                estimatedTokensAfter: 20,
                surfaceText: "User: keep the dock\n\nAssistant: ok",
              },
            })}\n`);
            continue;
          }
          if (message.method === "seed_context") {
            socket.write(`${JSON.stringify({
              id: message.id,
              result: { seeded: true },
            })}\n`);
            continue;
          }
          socket.write(`${JSON.stringify({ id: message.id, result: {} })}\n`);
        }
      });
    });
    await new Promise((resolve, reject) => {
      server.listen(hostPath, resolve);
      server.on("error", reject);
    });
    try {
      bridge.send({
        action: "handoff_session",
        conversationId: "conv-handoff",
        requestId: "handoff-host",
      });
      const handed = await bridge.waitFor("session_handoff");
      assert.equal(handed.requestId, "handoff-host");
      assert.equal(handed.error, undefined);
      assert.match(String(handed.forkedSessionId ?? ""), /^dsh_/);
      assert.equal(handed.compaction.tokensBefore, 80);
      assert.equal(handed.compaction.surfaceText, "User: keep the dock\n\nAssistant: ok");
      assert.equal(handed.compaction.summary, "");
      assert.equal(
        calls.some(call => (
          call.method === "seed_context"
          && call.params?.text === "User: keep the dock\n\nAssistant: ok"
        )),
        true,
      );
    } finally {
      server.close();
    }
  } finally {
    bridge.child.kill();
    try {
      unlinkSync(hostPath);
    } catch {
      // Already gone.
    }
  }
});

test("DSH compact uses the host plugin", async () => {
  const hostPath = dshProductIpc(`host-compact-${process.pid}`);
  try {
    unlinkSync(hostPath);
  } catch {
    // First listen.
  }
  const bridge = runBridge({ MILKSU_DSH_HOST_IPC: hostPath });
  try {
    bridge.send({
      action: "create_session",
      conversationId: "conv-compact",
      cwd: here,
    });
    await bridge.waitFor("ready");
    const server = createServer(socket => {
      let buffer = "";
      socket.on("data", chunk => {
        buffer += chunk.toString("utf8");
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const message = JSON.parse(line);
          socket.write(`${JSON.stringify({
            id: message.id,
            result: { tokensBefore: 120, estimatedTokensAfter: 40 },
          })}\n`);
        }
      });
    });
    await new Promise((resolve, reject) => {
      server.listen(hostPath, resolve);
      server.on("error", reject);
    });
    try {
      bridge.send({
        action: "compact_session",
        conversationId: "conv-compact",
        requestId: "compact-host",
      });
      const ended = await bridge.waitFor("compaction_end");
      assert.equal(ended.requestId, "compact-host");
      assert.equal(ended.error, undefined);
      assert.equal(ended.compaction.tokensBefore, 120);
      assert.equal(ended.compaction.estimatedTokensAfter, 40);
    } finally {
      server.close();
    }
  } finally {
    bridge.child.kill();
    try {
      unlinkSync(hostPath);
    } catch {
      // Already gone.
    }
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
    assert.equal(
      bridge.events.some(event => (
        event.type === "error" && /Method not found|session\/cancel/i.test(String(event.error ?? ""))
      )),
      false,
    );
  } finally {
    bridge.child.kill();
  }
});

test("DSH session/new sends ACP stdio product MCP with env entries", async () => {
  const dump = join(tmpdir(), `milksu-dsh-acp-${process.pid}.json`);
  try {
    unlinkSync(dump);
  } catch {
    // First write.
  }
  const bridge = runBridge({ MILKSU_DSH_FAKE_ACP_DUMP: dump });
  try {
    bridge.send({
      action: "create_session",
      conversationId: "conv-mcp",
      cwd: here,
    });
    await bridge.waitFor("ready");
    const created = JSON.parse(readFileSync(dump, "utf8"));
    assert.ok(created.mcpServers.length >= 1);
    const server = created.mcpServers.find(item => item.name === "milksu");
    const playwright = created.mcpServers.find(item => item.name === dshPlaywrightMcpServerName);
    assert.ok(server);
    assert.ok(playwright);
    assert.equal(playwright.type, undefined);
    assert.equal(server.type, undefined);
    assert.equal(isAbsolute(server.command), true);
    assert.ok(Array.isArray(server.env));
    assert.ok(server.env.some(entry => entry.name === "MILKSU_DSH_IPC" && entry.value));
    assert.ok(server.env.some(entry => (
      entry.name === "MILKSU_CONVERSATION_ID" && entry.value === "conv-mcp"
    )));
  } finally {
    bridge.child.kill();
    try {
      unlinkSync(dump);
    } catch {
      // Already gone.
    }
  }
});

test("DSH TokenFlux session keeps vendor-prefixed Flash on the ACP wire", async () => {
  const dump = join(tmpdir(), `milksu-dsh-tokenflux-${process.pid}.json`);
  try {
    unlinkSync(dump);
  } catch {
    // First write.
  }
  const bridge = runBridge({
    MILKSU_DSH_FAKE_ACP_DUMP: dump,
    DEEPSEEK_BASE_URL: "https://tokenflux.dev/v1",
    MILKSU_DSH_LLM_PROTOCOL: "chat-completions",
  });
  try {
    bridge.send({
      action: "create_session",
      conversationId: "conv-tokenflux",
      cwd: here,
      model: "deepseek/deepseek-flash",
    });
    await bridge.waitFor("ready");
    const applied = JSON.parse(readFileSync(dump, "utf8"));
    assert.equal(applied.configId, "model");
    assert.equal(applied.value, JSON.stringify(["deepseek-official", "deepseek/deepseek-flash"]));
  } finally {
    bridge.child.kill();
    try {
      unlinkSync(dump);
    } catch {
      // Already gone.
    }
  }
});

test("DSH session maps TokenFlux default Flash onto deepseek-flash", async () => {
  const dump = join(tmpdir(), `milksu-dsh-flash-${process.pid}.json`);
  try {
    unlinkSync(dump);
  } catch {
    // First write.
  }
  const bridge = runBridge({ MILKSU_DSH_FAKE_ACP_DUMP: dump });
  try {
    bridge.send({
      action: "create_session",
      conversationId: "conv-flash",
      cwd: here,
      model: "deepseek/deepseek-v4-flash",
    });
    await bridge.waitFor("ready");
    const applied = JSON.parse(readFileSync(dump, "utf8"));
    assert.equal(applied.configId, "model");
    assert.match(String(applied.value), /deepseek-flash/);
    assert.equal(/deepseek-v4-flash/.test(String(applied.value)), false);
  } finally {
    bridge.child.kill();
    try {
      unlinkSync(dump);
    } catch {
      // Already gone.
    }
  }
});

test("DSH session applies the selected ACP catalog model", async () => {
  const dump = join(tmpdir(), `milksu-dsh-model-${process.pid}.json`);
  try {
    unlinkSync(dump);
  } catch {
    // First write.
  }
  const bridge = runBridge({ MILKSU_DSH_FAKE_ACP_DUMP: dump });
  try {
    bridge.send({
      action: "create_session",
      conversationId: "conv-model",
      cwd: here,
      model: "deepseek-v4-flash-vision-exp",
    });
    await bridge.waitFor("ready");
    const applied = JSON.parse(readFileSync(dump, "utf8"));
    assert.equal(applied.configId, "model");
    assert.match(String(applied.value), /deepseek-v4-flash-vision-exp/);
  } finally {
    bridge.child.kill();
    try {
      unlinkSync(dump);
    } catch {
      // Already gone.
    }
  }
});

test("DSH resumeSessionId uses session/resume when the ACP session is still live", async () => {
  const dump = join(tmpdir(), `milksu-dsh-resume-${process.pid}.json`);
  try {
    unlinkSync(dump);
  } catch {
    // First write.
  }
  const bridge = runBridge({ MILKSU_DSH_FAKE_ACP_DUMP: dump });
  try {
    bridge.send({
      action: "create_session",
      conversationId: "conv-resume-src",
      cwd: here,
    });
    await bridge.waitFor("ready");
    const created = JSON.parse(readFileSync(dump, "utf8"));
    bridge.send({
      action: "create_session",
      conversationId: "conv-resume-dst",
      cwd: here,
      resumeSessionId: created.sessionId,
    });
    const started = Date.now();
    let ready;
    while (Date.now() - started < 3000) {
      ready = [...bridge.events].reverse().find(event => (
        event.type === "ready" && event.id === "conv-resume-dst"
      ));
      if (ready) break;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.equal(ready?.resumed, true);
    const dumped = JSON.parse(readFileSync(dump, "utf8"));
    assert.equal(dumped.resumed, true);
    assert.ok(dumped.received.some(item => item.method === "session/resume"));
  } finally {
    bridge.child.kill();
    try {
      unlinkSync(dump);
    } catch {
      // Already gone.
    }
  }
});

test("DSH greeting create_session does not write a coding-browser descriptor", async () => {
  const conversationId = `conv-hi-cdp-${process.pid}`;
  const descriptorFile = codingBrowserDescriptorFile(conversationId);
  const bridge = runBridge();
  try {
    bridge.send({
      action: "create_session",
      conversationId,
      cwd: here,
    });
    await bridge.waitFor("ready");
    assert.equal(existsSync(descriptorFile), false);
  } finally {
    bridge.child.kill();
    try {
      rmSync(dirname(descriptorFile), { recursive: true, force: true });
    } catch {
      // Nothing to clean.
    }
  }
});

test("DSH attaches the coding-browser descriptor after a typed workspace response", async () => {
  const conversationId = `conv-late-cdp-${process.pid}`;
  const descriptorFile = codingBrowserDescriptorFile(conversationId);
  const bridge = runBridge();
  try {
    bridge.send({
      action: "create_session",
      conversationId,
      cwd: here,
    });
    await bridge.waitFor("ready");
    assert.equal(existsSync(descriptorFile), false);
    bridge.send({
      action: "workspace_action_response",
      conversationId,
      requestId: "workspace-late-cdp",
      ok: true,
      result: "{\"tabs\":[]}",
      codingBrowser: {
        sessionId: "browser_testdsh01",
        cdpEndpoint: "http://127.0.0.1:9333",
      },
    });
    const started = Date.now();
    while (Date.now() - started < 2000) {
      if (existsSync(descriptorFile)) break;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.equal(existsSync(descriptorFile), true);
    const written = JSON.parse(readFileSync(descriptorFile, "utf8"));
    assert.equal(written.sessionId, "browser_testdsh01");
    assert.equal(written.cdpEndpoint, "http://127.0.0.1:9333");
  } finally {
    bridge.child.kill();
    try {
      rmSync(dirname(descriptorFile), { recursive: true, force: true });
    } catch {
      // Nothing to clean.
    }
  }
});

test("DSH send_message can attach a later-opened browser without creating it", async () => {
  const conversationId = `conv-reuse-cdp-${process.pid}`;
  const descriptorFile = codingBrowserDescriptorFile(conversationId);
  const bridge = runBridge();
  try {
    bridge.send({
      action: "send_message",
      conversationId,
      prompt: "hi",
      cwd: here,
    });
    await bridge.waitFor("message_done");
    assert.equal(existsSync(descriptorFile), false);
    bridge.send({
      action: "send_message",
      conversationId,
      prompt: "continue",
      cwd: here,
      codingBrowser: {
        sessionId: "browser_testdsh02",
        cdpEndpoint: "http://127.0.0.1:9334",
      },
    });
    const started = Date.now();
    while (Date.now() - started < 2000) {
      if (existsSync(descriptorFile)) break;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.equal(existsSync(descriptorFile), true);
    const written = JSON.parse(readFileSync(descriptorFile, "utf8"));
    assert.equal(written.sessionId, "browser_testdsh02");
    assert.equal(written.cdpEndpoint, "http://127.0.0.1:9334");
  } finally {
    bridge.child.kill();
    try {
      rmSync(dirname(descriptorFile), { recursive: true, force: true });
    } catch {
      // Nothing to clean.
    }
  }
});

test("DSH send_message on different sessions is not serialized", async () => {
  const bridge = runBridge({ MILKSU_DSH_FAKE_PROMPT_MS: "180" });
  try {
    bridge.send({ action: "create_session", conversationId: "parent", cwd: here });
    await bridge.waitFor("ready");
    bridge.send({ action: "create_session", conversationId: "child", cwd: here });
    await new Promise(resolve => setTimeout(resolve, 40));
    const started = Date.now();
    bridge.send({ action: "send_message", conversationId: "parent", prompt: "slow", cwd: here });
    bridge.send({ action: "send_message", conversationId: "child", prompt: "fast", cwd: here });
    const childDone = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`child did not settle: ${JSON.stringify(bridge.events)}`)), 2000);
      const tick = () => {
        const done = bridge.events.find(event => (
          event.type === "turn_settled" && event.id === "child"
        ));
        if (done) {
          clearTimeout(timer);
          resolve(done);
          return;
        }
        setTimeout(tick, 15);
      };
      tick();
    });
    const parentDone = bridge.events.find(event => (
      event.type === "turn_settled" && event.id === "parent"
    ));
    assert.ok(childDone);
    assert.equal(parentDone, undefined);
    assert.ok(Date.now() - started < 160);
  } finally {
    bridge.child.kill();
  }
});

test("DSH steer_message followups the parent without waiting for session/prompt", async () => {
  const followups = [];
  const server = createServer(socket => {
    let buffer = "";
    socket.on("data", chunk => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }
        if (message.method === "followup") followups.push(message.params?.prompt);
        socket.write(`${JSON.stringify({ id: message.id, result: { queued: true } })}\n`);
      }
    });
  });
  const bridge = runBridge({ MILKSU_DSH_FAKE_PROMPT_MS: "400" });
  try {
    bridge.send({ action: "create_session", conversationId: "parent", cwd: here });
    await bridge.waitFor("ready");
    const hostPath = dshProductIpc(`host-${bridge.child.pid}`);
    await new Promise((resolve, reject) => {
      server.listen(hostPath, resolve);
      server.on("error", reject);
    });
    const started = Date.now();
    bridge.send({ action: "send_message", conversationId: "parent", prompt: "slow", cwd: here });
    await new Promise(resolve => setTimeout(resolve, 40));
    bridge.send({ action: "steer_message", conversationId: "parent", prompt: "continue" });
    const until = Date.now() + 1500;
    while (Date.now() < until && !followups.includes("continue")) {
      await new Promise(resolve => setTimeout(resolve, 15));
    }
    assert.ok(followups.includes("continue"), `missing followup: ${JSON.stringify(followups)}`);
    assert.ok(Date.now() - started < 300);
    assert.equal(
      bridge.events.some(event => event.type === "turn_settled" && event.id === "parent"),
      false,
    );
  } finally {
    bridge.child.kill();
    server.close();
  }
});

test("DSH native subagent ACP updates project into subagent_tasks", async () => {
  const bridge = runBridge({ MILKSU_DSH_FAKE_SUBAGENT: "1" });
  try {
    bridge.send({
      action: "create_session",
      conversationId: "conv-sub",
      cwd: here,
    });
    await bridge.waitFor("ready");
    bridge.send({
      action: "send_message",
      conversationId: "conv-sub",
      prompt: "open four",
      cwd: here,
    });
    const started = Date.now();
    let roster;
    while (Date.now() - started < 3000) {
      roster = [...bridge.events].reverse().find(event => event.type === "subagent_tasks");
      if (roster?.subagentTasks?.some(task => task.id === "cf4fb9a2" && task.status === "running")) {
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.ok(roster, `missing subagent_tasks: ${JSON.stringify(bridge.events)}`);
    assert.deepEqual(roster.subagentTasks, [{
      id: "cf4fb9a2",
      role: "环境巡检",
      status: "running",
      toolCallId: "call-sub-1",
    }]);
    bridge.send({
      action: "abort_session",
      conversationId: "conv-sub",
      subagentId: "cf4fb9a2",
    });
    await new Promise(resolve => setTimeout(resolve, 80));
    assert.equal(
      bridge.events.some(event => event.type === "turn_settled" && event.aborted === true),
      false,
    );
  } finally {
    bridge.child.kill();
  }
});
