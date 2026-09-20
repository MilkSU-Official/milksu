import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const bridgePath = fileURLToPath(new URL("./playwright-session-bridge.cjs", import.meta.url));

function startBridge(env) {
  const child = spawn(process.execPath, [bridgePath], {
    env: { ...process.env, ...env },
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  let buffer = "";
  const lines = [];
  const waiters = [];
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    let cut;
    while ((cut = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, cut).trim();
      buffer = buffer.slice(cut + 1);
      if (!line) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      if (waiters.length) waiters.shift()(message);
      else lines.push(message);
    }
  });
  return {
    child,
    send(message) {
      child.stdin.write(`${JSON.stringify(message)}\n`);
    },
    next(timeoutMs = 3_000) {
      if (lines.length) return Promise.resolve(lines.shift());
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error(`playwright session bridge timed out: ${child.stderr.read?.() || ""}`));
        }, timeoutMs);
        waiters.push((message) => {
          clearTimeout(timer);
          resolve(message);
        });
      });
    },
    async close() {
      if (child.exitCode != null) return;
      child.kill("SIGTERM");
      await new Promise((resolve) => child.once("exit", resolve));
    },
  };
}

test("stays alive and answers MCP when the isolated browser is not ready", async () => {
  const bridge = startBridge({
    MILKSU_PLAYWRIGHT_MCP_CLI: process.execPath,
    MILKSU_CODING_BROWSER_DESCRIPTOR_FILE: join(tmpdir(), "milksu-missing-cdp.json"),
    MILKSU_PLAYWRIGHT_CDP_WAIT_MS: "400",
  });
  try {
    bridge.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    const initialized = await bridge.next();
    assert.equal(initialized.result.serverInfo.name, "milksu-playwright");
    bridge.send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    const listed = await bridge.next();
    assert.ok(listed.result.tools.some((tool) => tool.name === "browser_snapshot"));
    bridge.send({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "browser_snapshot", arguments: {} },
    });
    const called = await bridge.next(4_000);
    assert.equal(called.result.isError, true);
    assert.match(called.result.content[0].text, /isolated browser is not ready/);
    assert.equal(bridge.child.exitCode, null);
  } finally {
    await bridge.close();
  }
});

test("execs the packaged CLI on the first tool call after the descriptor appears", async () => {
  const directory = await mkdtemp(join(tmpdir(), "milksu-pw-bridge-"));
  const cli = join(directory, "cli.cjs");
  const file = join(directory, "cdp.json");
  const marker = join(directory, "argv.txt");
  await writeFile(cli, `
const { createInterface } = require("node:readline");
const { writeFileSync } = require("node:fs");
writeFileSync(${JSON.stringify(marker)}, process.argv.slice(2).join(" "));
const input = createInterface({ input: process.stdin });
input.on("line", (line) => {
  if (!line.trim()) return;
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    process.stdout.write(JSON.stringify({
      jsonrpc: "2.0",
      id: message.id,
      result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "fake", version: "1" } },
    }) + "\\n");
    return;
  }
  if (message.method === "tools/list") {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { tools: [] } }) + "\\n");
    return;
  }
  if (message.method === "tools/call") {
    process.stdout.write(JSON.stringify({
      jsonrpc: "2.0",
      id: message.id,
      result: { content: [{ type: "text", text: "ok" }] },
    }) + "\\n");
  }
});
`);
  await writeFile(file, `${JSON.stringify({
    sessionId: "browser_12345678-abcd-4567-8901-123456789abc",
    cdpEndpoint: "http://127.0.0.1:43127",
  })}\n`);
  const bridge = startBridge({
    MILKSU_PLAYWRIGHT_MCP_CLI: cli,
    MILKSU_CODING_BROWSER_DESCRIPTOR_FILE: file,
  });
  try {
    bridge.send({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "browser_snapshot", arguments: {} },
    });
    const called = await bridge.next(4_000);
    assert.equal(called.result.content[0].text, "ok");
    const argv = await import("node:fs/promises").then((fs) => fs.readFile(marker, "utf8"));
    assert.match(argv, /--cdp-endpoint http:\/\/127\.0\.0\.1:43127/);
  } finally {
    await bridge.close();
  }
});
