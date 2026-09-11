import { createInterface } from "node:readline";

const sessions = new Map();
let nextId = 1;

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
    sessions.set(sessionId, { cwd: params?.cwd });
    write({ jsonrpc: "2.0", id, result: { sessionId } });
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
  if (method === "session/cancel" || method === "session/close" || method === "session/compact" || method === "shutdown") {
    write({ jsonrpc: "2.0", id, result: {} });
    return;
  }
  write({ jsonrpc: "2.0", id, error: { code: -32601, message: `Unknown method ${method}` } });
});
