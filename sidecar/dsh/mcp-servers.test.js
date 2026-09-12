import assert from "node:assert/strict";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  acpEnvEntries,
  acpStdioMcpServer,
  isAcpStdioMcpServer,
  milksuAcpMcpServerName,
  milksuProductMcpServer,
  resolveProductMcpScript,
} from "./mcp-servers.js";

const here = dirname(fileURLToPath(import.meta.url));

test("ACP stdio MCP env must be name/value entries, not a record", () => {
  const record = {
    name: "milksu",
    command: process.execPath,
    args: [join(here, "product-mcp.js")],
    env: {
      MILKSU_DSH_IPC: "/run/milksu/dsh.sock",
      MILKSU_CONVERSATION_ID: "conv-1",
    },
  };
  assert.equal(isAcpStdioMcpServer(record), false);
  assert.equal(isAcpStdioMcpServer({ ...record, type: "stdio" }), false);
  const server = acpStdioMcpServer({
    name: "milksu",
    command: process.execPath,
    args: [join(here, "product-mcp.js")],
    env: record.env,
  });
  assert.ok(isAcpStdioMcpServer(server));
  assert.equal("type" in server, false);
  assert.deepEqual(server.env, acpEnvEntries(record.env));
});

test("product MCP descriptor uses the packaged or source script and conversation IPC", () => {
  const script = resolveProductMcpScript(here);
  assert.ok(script.endsWith("product-mcp.js") || script.endsWith("product-mcp.cjs"));
  const server = milksuProductMcpServer({
    conversationId: "conv-ask",
    ipcPath: "/var/folders/xx/dsh.sock",
    scriptPath: script,
    execPath: process.execPath,
  });
  assert.equal(server.name, milksuAcpMcpServerName);
  assert.ok(isAbsolute(server.command));
  assert.ok(isAbsolute(server.args[0]));
  assert.deepEqual(
    Object.fromEntries(server.env.map(entry => [entry.name, entry.value])),
    {
      MILKSU_DSH_IPC: "/var/folders/xx/dsh.sock",
      MILKSU_CONVERSATION_ID: "conv-ask",
    },
  );
});

test("product MCP descriptor stays off the session when IPC or script is missing", () => {
  assert.equal(milksuProductMcpServer({
    conversationId: "conv-1",
    ipcPath: "",
    scriptPath: join(here, "product-mcp.js"),
  }), null);
  assert.equal(acpStdioMcpServer({ name: "", command: process.execPath }), null);
});
