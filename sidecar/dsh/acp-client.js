import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { formatProcessFailure, redactProcessText } from "./redact.js";

export function formatAcpError(error) {
  const message = String(error?.message || "ACP error").trim() || "ACP error";
  const data = error?.data;
  let detail = "";
  if (typeof data === "string") {
    detail = data.trim();
  } else if (data && typeof data === "object") {
    const candidate = data.details ?? data.detail ?? data.message ?? data.error;
    if (typeof candidate === "string") {
      detail = candidate.trim();
    }
  }
  const combined = detail && detail !== message ? `${message}: ${detail}` : message;
  return redactProcessText(combined);
}

const stderrLimit = 8 << 10;

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
  let failed = false;
  let closing = false;
  let lastFailure = "";
  let stderrText = "";
  const pending = new Map();
  const listeners = new Set();

  function failAll(reason) {
    if (failed) return;
    failed = true;
    lastFailure = formatProcessFailure(reason, stderrText);
    for (const { reject } of pending.values()) {
      reject(new Error(lastFailure));
    }
    pending.clear();
    if (typeof options.onFailure === "function") {
      options.onFailure(lastFailure);
    }
  }

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
        reject(new Error(formatAcpError(message.error)));
        return;
      }
      resolve(message.result);
      return;
    }
    for (const listener of listeners) listener(message);
  });
  child.stderr?.on("data", chunk => {
    stderrText += chunk.toString("utf8");
    if (stderrText.length > stderrLimit) {
      stderrText = stderrText.slice(-stderrLimit);
    }
  });
  child.on("error", error => {
    failAll(error?.message || error);
  });
  child.on("exit", (code, signal) => {
    if (closing && pending.size === 0) return;
    if (code === 0 && pending.size === 0) return;
    const reason = signal
      ? `DeepSeek Harness sidecar signal ${signal}`
      : `DeepSeek Harness sidecar exit ${code ?? "unknown"}`;
    failAll(reason);
  });

  function request(method, params) {
    if (failed) {
      return Promise.reject(new Error(lastFailure || "DeepSeek Harness sidecar stopped"));
    }
    const id = nextId++;
    const payload = { jsonrpc: "2.0", id, method, params };
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      if (!child.stdin) {
        pending.delete(id);
        reject(new Error(lastFailure || "DeepSeek Harness sidecar is not running"));
        return;
      }
      child.stdin.write(`${JSON.stringify(payload)}\n`, error => {
        if (error) {
          pending.delete(id);
          reject(error);
        }
      });
    });
  }

  function respond(id, result) {
    if (!child.stdin || failed) return;
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
  }

  function onMessage(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  async function close() {
    closing = true;
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
