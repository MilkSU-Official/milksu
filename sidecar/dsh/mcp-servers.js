import { existsSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

export const milksuAcpMcpServerName = "milksu";

export function acpEnvEntries(env) {
  if (Array.isArray(env)) {
    return env
      .filter(entry => entry && typeof entry.name === "string" && typeof entry.value === "string")
      .map(entry => ({ name: entry.name, value: entry.value }));
  }
  if (!env || typeof env !== "object") return [];
  const entries = [];
  const seen = new Set();
  for (const [name, value] of Object.entries(env)) {
    const key = String(name ?? "").trim();
    if (!key || seen.has(key) || key.includes("=") || key.includes("\0") || value == null) continue;
    const text = String(value);
    if (text.includes("\0")) continue;
    seen.add(key);
    entries.push({ name: key, value: text });
  }
  return entries;
}

export function isAcpStdioMcpServer(server) {
  if (!server || typeof server !== "object") return false;
  if ("type" in server) return false;
  if (typeof server.name !== "string" || !server.name.trim()) return false;
  if (typeof server.command !== "string" || !isAbsolute(server.command)) return false;
  if (!Array.isArray(server.args) || !server.args.every(value => typeof value === "string")) {
    return false;
  }
  if (!Array.isArray(server.env)) return false;
  return server.env.every(entry => (
    entry
    && typeof entry === "object"
    && typeof entry.name === "string"
    && entry.name.length > 0
    && typeof entry.value === "string"
  ));
}

export function acpStdioMcpServer({ name, command, args = [], env = {} } = {}) {
  const serverName = String(name ?? "").trim();
  const resolvedCommand = String(command ?? "").trim();
  if (!serverName || !resolvedCommand) return null;
  const absoluteCommand = isAbsolute(resolvedCommand)
    ? resolvedCommand
    : resolve(resolvedCommand);
  const server = {
    name: serverName,
    command: absoluteCommand,
    args: (Array.isArray(args) ? args : []).map(value => String(value)),
    env: acpEnvEntries(env),
  };
  return isAcpStdioMcpServer(server) ? server : null;
}

export function resolveProductMcpScript(here) {
  const root = String(here ?? "").trim();
  if (!root) return "";
  const packaged = join(root, "product-mcp.cjs");
  const source = join(root, "product-mcp.js");
  if (existsSync(packaged)) return resolve(packaged);
  if (existsSync(source)) return resolve(source);
  return "";
}

export function milksuProductMcpServer({
  conversationId,
  ipcPath,
  scriptPath,
  execPath = process.execPath,
} = {}) {
  const ipc = String(ipcPath ?? "").trim();
  const scriptRaw = String(scriptPath ?? "").trim();
  const script = scriptRaw && (isAbsolute(scriptRaw) ? scriptRaw : resolve(scriptRaw));
  const id = String(conversationId ?? "").trim();
  if (!ipc || !script || !id) return null;
  return acpStdioMcpServer({
    name: milksuAcpMcpServerName,
    command: execPath,
    args: [script],
    env: {
      MILKSU_DSH_IPC: ipc,
      MILKSU_CONVERSATION_ID: id,
    },
  });
}
