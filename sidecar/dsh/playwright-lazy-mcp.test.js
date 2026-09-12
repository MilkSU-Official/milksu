import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const here = dirname(fileURLToPath(import.meta.url));

function startLazyMcp(env = {}) {
  const child = spawn(process.execPath, [join(here, "playwright-lazy-mcp.js")], {
    cwd: here,
    env: { ...process.env, ...env },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const responses = [];
  let buffer = "";
  child.stdout.on("data", chunk => {
    buffer += chunk.toString("utf8");
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      responses.push(JSON.parse(line));
    }
  });
  function send(message) {
    child.stdin.write(`${JSON.stringify(message)}\n`);
  }
  async function waitFor(id, timeout = 2000) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      const match = responses.find(item => item.id === id);
      if (match) return match;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw new Error(`timed out waiting for MCP id ${id}: ${JSON.stringify(responses)}`);
  }
  return { child, send, waitFor };
}

test("lazy Playwright MCP lists tools before an isolated browser exists", async () => {
  const mcp = startLazyMcp({
    MILKSU_CONVERSATION_ID: "conv-lazy",
    MILKSU_CODING_BROWSER_DESCRIPTOR_FILE: join(here, "missing-cdp.json"),
  });
  try {
    mcp.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    mcp.send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    const listed = await mcp.waitFor(2);
    const names = listed.result.tools.map(tool => tool.name);
    assert.ok(names.includes("browser_navigate"));
    assert.ok(names.includes("browser_snapshot"));
  } finally {
    mcp.child.kill();
  }
});

test("lazy Playwright tool call fails closed when the isolated browser is absent", async () => {
  const mcp = startLazyMcp({
    MILKSU_CONVERSATION_ID: "conv-lazy-call",
    MILKSU_CODING_BROWSER_DESCRIPTOR_FILE: join(here, "missing-cdp.json"),
    MILKSU_PLAYWRIGHT_MCP_CLI: join(here, "no-such-playwright-cli.js"),
  });
  try {
    const started = Date.now();
    mcp.send({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "browser_navigate", arguments: { url: "https://example.com" } },
    });
    const called = await mcp.waitFor(3, 35_000);
    assert.equal(called.result.isError, true);
    assert.match(String(called.result.content[0].text), /not open|unavailable/i);
    assert.ok(Date.now() - started < 34_000);
  } finally {
    mcp.child.kill();
  }
});
