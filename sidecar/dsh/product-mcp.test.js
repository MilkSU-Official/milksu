import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { codingAskToolName } from "../pi/bridge-ask.js";
import { codingWorkspaceToolName } from "../pi/bridge-workspace.js";
import { dshProductIpc } from "../hostpath.js";
import { createProductIpc } from "./product-ipc.js";

const here = dirname(fileURLToPath(import.meta.url));

function startProductMcp(env) {
  const child = spawn(process.execPath, [join(here, "product-mcp.js")], {
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
  async function waitFor(id, timeout = 3000) {
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

test("product MCP lists milksu_ask and milksu_workspace", async () => {
  const mcp = startProductMcp({
    MILKSU_DSH_IPC: "",
    MILKSU_CONVERSATION_ID: "conv-list",
  });
  try {
    mcp.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    mcp.send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    const listed = await mcp.waitFor(2);
    const names = listed.result.tools.map(tool => tool.name);
    assert.deepEqual(names, [codingAskToolName, codingWorkspaceToolName]);
  } finally {
    mcp.child.kill();
  }
});

test("product MCP ask and workspace calls reach the product IPC", async () => {
  const path = dshProductIpc(`mcp-tool-${process.pid}`);
  try {
    unlinkSync(path);
  } catch {
    // First listen.
  }
  const ipc = createProductIpc(path, async message => {
    if (message.method === "ask") {
      return { id: "keep", label: "Keep Pi" };
    }
    if (message.method === "workspace") {
      assert.equal(message.params.action, "list_browser_tabs");
      return "tabs:0";
    }
    throw new Error(`unexpected method ${message.method}`);
  });
  await ipc.listen();
  const mcp = startProductMcp({
    MILKSU_DSH_IPC: path,
    MILKSU_CONVERSATION_ID: "conv-tools",
  });
  try {
    mcp.send({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: codingAskToolName,
        arguments: {
          question: "Which harness?",
          options: [{ id: "keep", label: "Keep Pi" }, { id: "dsh", label: "DSH" }],
        },
      },
    });
    const asked = await mcp.waitFor(1);
    assert.match(String(asked.result.content[0].text), /Keep Pi/);

    mcp.send({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: codingWorkspaceToolName,
        arguments: { action: "list_browser_tabs" },
      },
    });
    const workspace = await mcp.waitFor(2);
    assert.equal(workspace.result.content[0].text, "tabs:0");
  } finally {
    mcp.child.kill();
    await ipc.close();
    try {
      unlinkSync(path);
    } catch {
      // Already gone.
    }
  }
});
