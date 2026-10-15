import { constants } from "node:fs";
import { access, lstat, realpath } from "node:fs/promises";
import { basename, isAbsolute } from "node:path";

export const pluginMcpServerName = "milksu-plugins";

const pluginMcpCommandEnvironment = "MILKSU_PLUGIN_MCP_COMMAND";
const pluginMcpArgsEnvironment = "MILKSU_PLUGIN_MCP_ARGS";
const pluginMcpAppDataEnvironment = "MILKSU_PLUGIN_MCP_APPDATA";

function launcherValue(name) {
  return String(process.env[name] ?? "").trim();
}

function launcherArgs() {
  const raw = launcherValue(pluginMcpArgsEnvironment);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map((item) => String(item));
  } catch {
    // Runtime also accepts a whitespace-separated fallback.
  }
  return raw.split(/\s+/).filter(Boolean);
}

function commandNeedsElectronAsNode(command) {
  const base = basename(command).replace(/\.exe$/i, "").toLowerCase();
  return base !== "node";
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
// The TypeScript runtime supplies one executable, its args, and one app-data
// root. The MCP SDK adds only its small platform environment allowlist; the
// explicit child environment below contains no model-provider credential.
export async function createFirstPartyPluginMcpServer() {
  const rawCommand = launcherValue(pluginMcpCommandEnvironment);
  const rawAppData = launcherValue(pluginMcpAppDataEnvironment);
  const args = launcherArgs();
  if (!rawCommand && !rawAppData && args.length === 0) return undefined;
  if (!rawCommand || !rawAppData || args.length === 0) {
    throw new Error("MilkSU first-party Plugin MCP launcher descriptor is incomplete");
  }
  const [command, appData] = await Promise.all([
    canonicalLauncherFile(rawCommand, "Plugin MCP command"),
    canonicalLauncherDirectory(rawAppData, "Plugin MCP data directory"),
  ]);
  const env = { MILKSU_APPDATA_DIR: appData };
  if (commandNeedsElectronAsNode(command)) env.ELECTRON_RUN_AS_NODE = "1";
  return {
    name: pluginMcpServerName,
    server: {
      command,
      args,
      env,
      cwd: appData,
      lifecycle: "lazy",
      directTools: false,
    },
  };
}
