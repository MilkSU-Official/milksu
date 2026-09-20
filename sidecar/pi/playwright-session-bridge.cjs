"use strict";

const { spawn } = require("node:child_process");
const { existsSync, readFileSync } = require("node:fs");
const { createInterface } = require("node:readline");
const { setTimeout: delay } = require("node:timers/promises");

const cdpEndpointPattern = /^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/;
const pollMs = 50;
const childRpcTimeoutMs = 20_000;
const advertisedTools = Object.freeze([
  { name: "browser_navigate", description: "Open a URL in the focused isolated browser tab." },
  { name: "browser_navigate_back", description: "Go back one history entry." },
  { name: "browser_snapshot", description: "Read the accessibility tree of the focused tab." },
  { name: "browser_click", description: "Click an element from the latest snapshot." },
  { name: "browser_type", description: "Type into an element from the latest snapshot." },
  { name: "browser_fill_form", description: "Fill a form from the latest snapshot." },
  { name: "browser_press_key", description: "Press a keyboard key in the focused tab." },
  { name: "browser_take_screenshot", description: "Capture the focused tab." },
  { name: "browser_tabs", description: "List or select isolated browser tabs." },
  { name: "browser_wait_for", description: "Wait for text or a short delay." },
  { name: "browser_select_option", description: "Choose an option from the latest snapshot." },
  { name: "browser_hover", description: "Hover an element from the latest snapshot." },
  { name: "browser_console_messages", description: "Read recent console messages." },
  { name: "browser_network_requests", description: "Read recent network requests." },
  { name: "browser_close", description: "Close the focused isolated browser tab." },
].map((tool) => ({
  ...tool,
  inputSchema: { type: "object", additionalProperties: true },
})));

let child;
let nextChildId = 1;
const pending = new Map();

function trimmedEnv(name) {
  return String(process.env[name] ?? "").trim();
}

const waitMs = Number(trimmedEnv("MILKSU_PLAYWRIGHT_CDP_WAIT_MS") || 30_000) || 30_000;

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

function readDescriptorEndpoint(file) {
  if (!file || !existsSync(file)) return "";
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return "";
  }
  const endpoint = String(parsed?.cdpEndpoint ?? "").trim();
  return cdpEndpointPattern.test(endpoint) ? endpoint : "";
}

function currentCdpEndpoint() {
  const direct = trimmedEnv("MILKSU_CODING_BROWSER_CDP");
  if (cdpEndpointPattern.test(direct)) return direct;
  return readDescriptorEndpoint(trimmedEnv("MILKSU_CODING_BROWSER_DESCRIPTOR_FILE"));
}

async function waitForCdp() {
  const deadline = Date.now() + waitMs;
  while (Date.now() <= deadline) {
    const endpoint = currentCdpEndpoint();
    if (endpoint) return endpoint;
    await delay(pollMs);
  }
  throw new Error(
    "MilkSU isolated browser is not ready. Open a tab with milksu_workspace first.",
  );
}

function sendChild(message, timeoutMs = childRpcTimeoutMs) {
  return new Promise((resolve, reject) => {
    if (!child?.stdin) {
      reject(new Error("isolated browser is not attached"));
      return;
    }
    const id = nextChildId++;
    const timer = setTimeout(() => {
      if (!pending.has(id)) return;
      pending.delete(id);
      reject(new Error("Playwright MCP timed out"));
    }, timeoutMs);
    pending.set(id, {
      resolve: (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      reject: (error) => {
        clearTimeout(timer);
        reject(error);
      },
    });
    child.stdin.write(`${JSON.stringify({ ...message, id })}\n`, (error) => {
      if (error) {
        pending.delete(id);
        clearTimeout(timer);
        reject(error);
      }
    });
  });
}

function forgetChild(error) {
  child = undefined;
  for (const waiter of pending.values()) {
    waiter.reject(error);
  }
  pending.clear();
}

async function ensureChild() {
  if (child) return;
  const cli = trimmedEnv("MILKSU_PLAYWRIGHT_MCP_CLI");
  if (!cli || !existsSync(cli)) {
    throw new Error("MilkSU packaged Playwright MCP CLI is unavailable");
  }
  const endpoint = await waitForCdp();
  child = spawn(process.execPath, [cli, "--cdp-endpoint", endpoint, ...process.argv.slice(2)], {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    env: process.env,
  });
  const input = createInterface({ input: child.stdout });
  input.on("line", (line) => {
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
  child.on("error", (error) => {
    forgetChild(error);
  });
  child.on("exit", () => {
    forgetChild(new Error("isolated browser closed"));
  });
  await sendChild({
    jsonrpc: "2.0",
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "milksu-pi", version: "1" },
    },
  });
  if (!child?.stdin) {
    throw new Error("isolated browser is not attached");
  }
  child.stdin.write(`${JSON.stringify({
    jsonrpc: "2.0",
    method: "notifications/initialized",
    params: {},
  })}\n`);
  await sendChild({
    jsonrpc: "2.0",
    method: "tools/list",
    params: {},
  });
}

function stopChild(signal) {
  if (child && !child.killed) child.kill(signal);
}

process.on("SIGTERM", () => {
  stopChild("SIGTERM");
  process.exit(0);
});
process.on("SIGINT", () => {
  stopChild("SIGINT");
  process.exit(0);
});

const input = createInterface({ input: process.stdin });
input.on("line", (line) => {
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
    write({
      jsonrpc: "2.0",
      id,
      result: {
        tools: advertisedTools,
      },
    });
    return;
  }
  if (method === "tools/call") {
    void ensureChild()
      .then(() => sendChild({
        jsonrpc: "2.0",
        method: "tools/call",
        params,
      }))
      .then((result) => write({ jsonrpc: "2.0", id, result }))
      .catch((error) => {
        const text = error instanceof Error ? error.message : String(error);
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
