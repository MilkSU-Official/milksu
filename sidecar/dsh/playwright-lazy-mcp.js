import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { setTimeout as delay } from "node:timers/promises";
import { codingBrowserDescriptorFile } from "../hostpath.js";

const conversationId = String(process.env.MILKSU_CONVERSATION_ID ?? "").trim();
const cli = String(process.env.MILKSU_PLAYWRIGHT_MCP_CLI ?? "").trim();
const descriptorFile = String(
  process.env.MILKSU_CODING_BROWSER_DESCRIPTOR_FILE
  || codingBrowserDescriptorFile(conversationId),
).trim();
const evidenceRoot = String(
  process.env.MILKSU_PLAYWRIGHT_EVIDENCE_DIR
  || (descriptorFile ? join(dirname(descriptorFile), "evidence") : ""),
).trim();
const cdpPattern = /^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/;
const waitMs = 30_000;
const pollMs = 50;

const advertisedTools = [
  "browser_navigate",
  "browser_navigate_back",
  "browser_snapshot",
  "browser_click",
  "browser_type",
  "browser_fill_form",
  "browser_press_key",
  "browser_take_screenshot",
  "browser_tabs",
  "browser_wait_for",
  "browser_select_option",
  "browser_hover",
  "browser_console_messages",
  "browser_network_requests",
  "browser_close",
].map(name => ({
  name,
  description: "Operate the focused MilkSU isolated browser tab.",
  inputSchema: { type: "object", additionalProperties: true },
}));

let child;
let nextChildId = 1;
const pending = new Map();

function write(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function toolError(id, text) {
  write({
    jsonrpc: "2.0",
    id,
    result: {
      content: [{ type: "text", text }],
      isError: true,
    },
  });
}

function readCdpEndpoint() {
  const direct = String(process.env.MILKSU_CODING_BROWSER_CDP ?? "").trim();
  if (cdpPattern.test(direct)) return direct;
  if (!descriptorFile || !existsSync(descriptorFile)) return "";
  try {
    const parsed = JSON.parse(readFileSync(descriptorFile, "utf8"));
    const endpoint = String(parsed?.cdpEndpoint ?? "").trim();
    return cdpPattern.test(endpoint) ? endpoint : "";
  } catch {
    return "";
  }
}

async function waitForCdp() {
  const deadline = Date.now() + waitMs;
  while (Date.now() <= deadline) {
    const endpoint = readCdpEndpoint();
    if (endpoint) return endpoint;
    await delay(pollMs);
  }
  throw new Error("isolated browser is not open");
}

function sendChild(message) {
  return new Promise((resolve, reject) => {
    if (!child?.stdin) {
      reject(new Error("isolated browser is not attached"));
      return;
    }
    const id = nextChildId++;
    pending.set(id, { resolve, reject });
    child.stdin.write(`${JSON.stringify({ ...message, id })}\n`, error => {
      if (error) {
        pending.delete(id);
        reject(error);
      }
    });
  });
}

async function ensureChild() {
  if (child) return;
  if (!cli || !existsSync(cli)) {
    throw new Error("MilkSU packaged Playwright MCP CLI is unavailable");
  }
  const endpoint = await waitForCdp();
  if (evidenceRoot) {
    await mkdir(evidenceRoot, { recursive: true, mode: 0o700 });
  }
  child = spawn(process.execPath, [
    cli,
    "--cdp-endpoint",
    endpoint,
    ...(evidenceRoot ? ["--output-dir", evidenceRoot] : []),
    "--output-max-size",
    String(16 << 20),
    "--console-level=debug",
    "--codegen=none",
    "--output-mode=stdout",
  ], {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    env: process.env,
  });
  const input = createInterface({ input: child.stdout });
  input.on("line", line => {
    if (!line.trim()) return;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (message.id == null || !pending.has(message.id)) return;
    const waiter = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) {
      waiter.reject(new Error(message.error.message || "Playwright MCP failed"));
      return;
    }
    waiter.resolve(message.result);
  });
  child.on("exit", () => {
    child = undefined;
    for (const waiter of pending.values()) {
      waiter.reject(new Error("isolated browser closed"));
    }
    pending.clear();
  });
  await sendChild({
    jsonrpc: "2.0",
    method: "initialize",
    params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "milksu-dsh" } },
  });
}

const input = createInterface({ input: process.stdin });
input.on("line", line => {
  if (!line.trim()) return;
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  const { id, method, params } = message;
  if (method === "initialize") {
    write({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: params?.protocolVersion || "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "milksu-playwright", version: "1" },
      },
    });
    return;
  }
  if (method === "notifications/initialized" || method === "initialized") return;
  if (method === "ping") {
    write({ jsonrpc: "2.0", id, result: {} });
    return;
  }
  if (method === "tools/list") {
    write({ jsonrpc: "2.0", id, result: { tools: advertisedTools } });
    return;
  }
  if (method === "tools/call") {
    void ensureChild()
      .then(() => sendChild({
        jsonrpc: "2.0",
        method: "tools/call",
        params,
      }))
      .then(result => write({ jsonrpc: "2.0", id, result }))
      .catch(error => {
        const text = error instanceof Error && error.message === "isolated browser is not open"
          ? "Isolated browser is not open. Use milksu_workspace to open a tab, then retry."
          : (error instanceof Error ? error.message : String(error));
        toolError(id, text);
      });
    return;
  }
  write({
    jsonrpc: "2.0",
    id,
    error: { code: -32601, message: `Unknown method ${method}` },
  });
});
