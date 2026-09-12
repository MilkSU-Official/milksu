import { writeFileSync } from "node:fs";
import { createInterface } from "node:readline";

const sessions = new Map();
let nextId = 1;
const dumpPath = String(process.env.MILKSU_DSH_FAKE_ACP_DUMP ?? "").trim();
const received = [];
let lastCreated = {};
const v41 = JSON.stringify(["deepseek-official", "deepseek-flash"]);
const flash = JSON.stringify(["deepseek-official", "deepseek-v4-flash"]);
const vision = JSON.stringify(["deepseek-official", "deepseek-v4-flash-vision-exp"]);
const catalog = [
  {
    id: "model",
    currentValue: flash,
    options: [{
      group: "deepseek-official",
      options: [
        { value: v41, name: "deepseek-flash" },
        { value: flash, name: "deepseek-v4-flash" },
        { value: vision, name: "deepseek-v4-flash-vision-exp" },
        { value: JSON.stringify(["deepseek-official", "deepseek-v4-pro"]), name: "deepseek-v4-pro" },
      ],
    }],
  },
  {
    id: "reasoning_effort",
    currentValue: "",
    options: [
      { value: "", name: "Provider default" },
      { value: "low", name: "Low" },
      { value: "high", name: "High" },
    ],
  },
];

function dump(extra = {}) {
  if (!dumpPath) return;
  writeFileSync(dumpPath, JSON.stringify({
    ...lastCreated,
    received,
    ...extra,
  }), { encoding: "utf8", mode: 0o600 });
}

function write(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function notify(method, params) {
  write({ jsonrpc: "2.0", method, params });
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
  received.push({ method, hasId: Object.hasOwn(message, "id") });
  if (method === "initialize") {
    write({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: 1,
        agentCapabilities: { loadSession: false },
        agentInfo: { name: "fake-acp", version: "0" },
      },
    });
    return;
  }
  if (method === "session/new") {
    const sessionId = `acp_${nextId++}`;
    sessions.set(sessionId, { cwd: params?.cwd, configOptions: structuredClone(catalog) });
    lastCreated = {
      cwd: params?.cwd,
      mcpServers: params?.mcpServers ?? [],
      sessionId,
    };
    dump();
    write({ jsonrpc: "2.0", id, result: { sessionId, configOptions: catalog } });
    return;
  }
  if (method === "session/set_config_option") {
    const record = sessions.get(params?.sessionId);
    if (!record) {
      write({ jsonrpc: "2.0", id, error: { code: -32602, message: "unknown session" } });
      return;
    }
    const options = structuredClone(record.configOptions);
    const option = options.find(item => item.id === params?.configId);
    if (!option) {
      write({ jsonrpc: "2.0", id, error: { code: -32602, message: `unknown session config option: ${params?.configId}` } });
      return;
    }
    option.currentValue = params?.value;
    record.configOptions = options;
    dump({
      sessionId: params.sessionId,
      configId: params.configId,
      value: params.value,
      configOptions: options,
    });
    write({ jsonrpc: "2.0", id, result: { configOptions: options } });
    return;
  }
  if (method === "session/prompt") {
    const sessionId = params?.sessionId;
    write({ jsonrpc: "2.0", id, result: {} });
    notify("session/update", {
      sessionId,
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "ok" },
      },
    });
    return;
  }
  if (method === "session/cancel") {
    if (id == null) return;
    write({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } });
    return;
  }
  if (method === "session/close" || method === "shutdown") {
    write({ jsonrpc: "2.0", id, result: {} });
    return;
  }
  if (id == null) return;
  write({ jsonrpc: "2.0", id, error: { code: -32601, message: `Unknown method ${method}` } });
});
