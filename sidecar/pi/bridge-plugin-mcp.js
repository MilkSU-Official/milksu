import { constants } from "node:fs";
import { access, lstat, realpath } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";

export const pluginMcpServerName = "milksu-plugins";

const pluginMcpCommandEnvironment = "MILKSU_PLUGIN_MCP_COMMAND";
const pluginMcpAppDataEnvironment = "MILKSU_PLUGIN_MCP_APPDATA";

function launcherValue(name) {
  return String(process.env[name] ?? "").trim();
}

export function pluginMcpSessionRequiresReload(
  previousServers,
  recoveryPurpose = "",
) {
  if (recoveryPurpose === "background-tasks") return false;
  const launcherPresent = Boolean(
    launcherValue(pluginMcpCommandEnvironment)
    || launcherValue(pluginMcpAppDataEnvironment),
  );
  return launcherPresent && !(
    Array.isArray(previousServers)
    && previousServers.includes(pluginMcpServerName)
  );
}

async function canonicalLauncherFile(value, label) {
  const requested = String(value ?? "").trim();
  if (!requested || !isAbsolute(requested)) {
    throw new Error(`MilkSU ${label} must be a launcher-owned absolute path`);
  }
  const metadata = await lstat(requested);
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error(`MilkSU ${label} must be a regular, non-symlink file`);
  }
  if (process.platform !== "win32") {
    await access(requested, constants.X_OK);
  }
  return realpath(requested);
}

async function canonicalLauncherDirectory(value, label) {
  const requested = String(value ?? "").trim();
  if (!requested || !isAbsolute(requested)) {
    throw new Error(`MilkSU ${label} must be a launcher-owned absolute path`);
  }
  const metadata = await lstat(requested);
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new Error(`MilkSU ${label} must be a regular, non-symlink directory`);
  }
  return realpath(requested);
}

// This server is intentionally not built from .mcp.json or a renderer payload.
// The supervised Go launcher supplies exactly one executable and one app-data
// root. The MCP SDK adds only its small platform environment allowlist; the
// explicit child environment below contains no model-provider credential.
export async function createFirstPartyPluginMcpServer() {
  const rawCommand = launcherValue(pluginMcpCommandEnvironment);
  const rawAppData = launcherValue(pluginMcpAppDataEnvironment);
  if (!rawCommand && !rawAppData) return undefined;
  if (!rawCommand || !rawAppData) {
    throw new Error("MilkSU first-party Plugin MCP launcher descriptor is incomplete");
  }
  const [command, appData] = await Promise.all([
    canonicalLauncherFile(rawCommand, "Plugin MCP command"),
    canonicalLauncherDirectory(rawAppData, "Plugin MCP data directory"),
  ]);
  return {
    name: pluginMcpServerName,
    server: {
      command,
      args: ["plugin-mcp"],
      env: { MILKSU_APPDATA_DIR: appData },
      cwd: dirname(command),
      lifecycle: "lazy",
      directTools: false,
    },
  };
}
