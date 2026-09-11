import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

export function createAcpClient(options = {}) {
  const command = String(options.command ?? "").trim();
  const args = Array.isArray(options.args) ? options.args : ["--profile", "acp"];
  const env = options.env ?? process.env;
  const cwd = options.cwd || process.cwd();
  if (!command) {
    throw new Error("DeepSeek Harness command is not configured");
  }

  const child = spawn(command, args, {
    cwd,
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let nextId = 1;
  const pending = new Map();
  const listeners = new Set();

  const input = createInterface({ input: child.stdout });
  input.on("line", line => {
    if (!line.trim()) return;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (message.id != null && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) {
        reject(new Error(message.error.message || "ACP error"));
        return;
      }
      resolve(message.result);
      return;
    }
    for (const listener of listeners) listener(message);
  });
  child.stderr?.on("data", () => {});
  child.on("exit", () => {
    for (const { reject } of pending.values()) {
      reject(new Error("DeepSeek Harness sidecar stopped"));
    }
    pending.clear();
  });

  function request(method, params) {
    const id = nextId++;
    const payload = { jsonrpc: "2.0", id, method, params };
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      child.stdin.write(`${JSON.stringify(payload)}\n`, error => {
        if (error) {
          pending.delete(id);
          reject(error);
        }
      });
    });
  }

  function respond(id, result) {
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
  }

  function onMessage(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  async function close() {
    input.close();
    try {
      await request("shutdown", {});
    } catch {
      // Process may already be gone.
    }
    if (!child.killed) child.kill();
  }

  return { request, respond, onMessage, close, child };
}
