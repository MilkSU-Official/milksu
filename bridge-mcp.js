import { createHash } from "node:crypto";
import { lstat, mkdir, open, readFile, realpath } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { sandboxProfile } from "./bridge-policy.js";

const maxConfigBytes = 1 << 20;
const maxSelectedServers = 16;
const safeChildEnvironmentNames = [
  "HOME",
  "PATH",
  "TMPDIR",
  "LANG",
  "LC_ALL",
  "SSL_CERT_DIR",
  "SSL_CERT_FILE",
];
const protectedEnvironmentNames = new Set([
  "ANTHROPIC_API_KEY",
  "DEEPSEEK_API_KEY",
  "DEEPSEEK_BASE_URL",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "GOOGLE_BASE_URL",
  "GROQ_API_KEY",
  "GROQ_BASE_URL",
  "KOURICHAT_API_KEY",
  "KOURICHAT_BASE_URL",
  "MILKSU_RELAY_KEY",
  "MILKSU_RELAY_URL",
  "MISTRAL_API_KEY",
  "MISTRAL_BASE_URL",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "ANTHROPIC_BASE_URL",
]);
const environmentReferencePattern = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$env:([A-Za-z_][A-Za-z0-9_]*)|\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g;

function within(root, target) {
  const path = relative(root, target);
  return path === ""
    || (!path.startsWith(`..${sep}`) && path !== ".." && !path.startsWith("../"));
}

export function normalizeSelectedMcpServers(value) {
  if (!Array.isArray(value)) return [];
  const selected = [...new Set(value.map(item => String(item).trim()).filter(Boolean))];
  if (selected.length > maxSelectedServers) {
    throw new Error(`MilkSU supports at most ${maxSelectedServers} MCP servers per task`);
  }
  for (const name of selected) {
    if (name.length > 80 || /[\u0000-\u001f\u007f]/u.test(name)) {
      throw new Error("MilkSU rejected an invalid MCP server name");
    }
  }
  return selected.sort((left, right) => left.localeCompare(right));
}

function interpolateSafeEnvironment(value, label) {
  return String(value).replace(
    environmentReferencePattern,
    (match, braced, prefixed, alternate) => {
      const name = braced || prefixed || alternate;
      if (protectedEnvironmentNames.has(name)) {
        throw new Error(`${label} cannot reference the model-provider credential ${name}`);
      }
      return process.env[name] ?? "";
    },
  );
}

function validateEnvironmentName(name, label) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`${label} contains an invalid environment variable name`);
  }
  if (protectedEnvironmentNames.has(name)) {
    throw new Error(`${label} cannot override the model-provider credential ${name}`);
  }
}

function safeChildEnvironment(definition, serverName, runtimeEnvironment = {}) {
  const assignments = safeChildEnvironmentNames.flatMap(name => {
    const value = runtimeEnvironment[name] ?? process.env[name];
    return typeof value === "string" && value
      ? [`${name}=${value.replaceAll("\0", "")}`]
      : [];
  });
  for (const [name, rawValue] of Object.entries(definition.env ?? {})) {
    validateEnvironmentName(name, `MCP server "${serverName}"`);
    const value = interpolateSafeEnvironment(
      rawValue,
      `MCP server "${serverName}" environment variable "${name}"`,
    ).replaceAll("\0", "");
    assignments.push(`${name}=${value}`);
  }
  return assignments;
}

function sanitizeRemoteDefinition(definition, serverName) {
  const headers = Object.fromEntries(
    Object.entries(definition.headers ?? {}).map(([name, value]) => [
      name,
      interpolateSafeEnvironment(
        value,
        `MCP server "${serverName}" header "${name}"`,
      ),
    ]),
  );
  if (definition.bearerTokenEnv) {
    throw new Error(
      `MCP server "${serverName}" cannot read bearerTokenEnv from the Sidecar process; `
      + "store a dedicated credential in the project MCP configuration instead",
    );
  }
  const bearerToken = definition.bearerToken === undefined
    ? undefined
    : String(definition.bearerToken);
  if (bearerToken && environmentReferencePattern.test(bearerToken)) {
    environmentReferencePattern.lastIndex = 0;
    throw new Error(
      `MCP server "${serverName}" bearer token cannot interpolate Sidecar environment variables`,
    );
  }
  environmentReferencePattern.lastIndex = 0;
  return {
    ...definition,
    headers,
    bearerToken,
    lifecycle: "lazy",
    directTools: false,
  };
}

function sanitizeLocalDefinition(definition, serverName, workspace) {
  const command = String(definition.command ?? "").trim();
  if (!command || command.includes("\0")) {
    throw new Error(`MCP server "${serverName}" has an invalid command`);
  }
  const args = Array.isArray(definition.args)
    ? definition.args.map(value => String(value).replaceAll("\0", ""))
    : [];
  const runtimeRoot = join(workspace, ".milksu", "mcp-runtime");
  const runtimeHome = join(runtimeRoot, "home");
  const runtimeTemporary = join(runtimeRoot, "tmp");
  return {
    ...definition,
    command: "/usr/bin/sandbox-exec",
    args: [
      "-p",
      sandboxProfile(
        workspace,
        true,
        [],
        false,
        [],
        [runtimeHome, runtimeTemporary],
      ),
      "/usr/bin/env",
      "-i",
      ...safeChildEnvironment(definition, serverName, {
        HOME: runtimeHome,
        TMPDIR: runtimeTemporary,
      }),
      command,
      ...args,
    ],
    env: {},
    cwd: workspace,
    lifecycle: "lazy",
    directTools: false,
  };
}

function sanitizeServerDefinition(definition, serverName, workspace) {
  if (!definition || typeof definition !== "object" || Array.isArray(definition)) {
    throw new Error(`MCP server "${serverName}" must be an object`);
  }
  if (definition.disabled === true) {
    throw new Error(`MCP server "${serverName}" is disabled in .mcp.json`);
  }
  if (definition.command) return sanitizeLocalDefinition(definition, serverName, workspace);
  if (definition.url) return sanitizeRemoteDefinition(definition, serverName);
  if (definition.socket) {
    return {
      ...definition,
      lifecycle: "lazy",
      directTools: false,
    };
  }
  throw new Error(`MCP server "${serverName}" has no command, URL, or socket`);
}

export async function loadSelectedMcpConfig(
  workspace,
  requestedServers,
  expectedDigest,
) {
  const selected = normalizeSelectedMcpServers(requestedServers);
  if (selected.length === 0) {
    return { selected, config: undefined };
  }

  const root = await realpath(workspace);
  const configPath = resolve(root, ".mcp.json");
  if (!within(root, configPath)) {
    throw new Error("MilkSU rejected the project MCP config path");
  }
  const metadata = await lstat(configPath);
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error("MilkSU requires .mcp.json to be a regular project file");
  }
  if (metadata.size <= 0 || metadata.size > maxConfigBytes) {
    throw new Error("MilkSU requires .mcp.json to be between 1 byte and 1 MiB");
  }
  const raw = await readFile(join(root, ".mcp.json"), "utf8");
  if (Buffer.byteLength(raw) > maxConfigBytes) {
    throw new Error("MilkSU rejected an oversized .mcp.json");
  }
  const digest = createHash("sha256").update(raw).digest("hex");
  if (String(expectedDigest ?? "").trim() !== digest) {
    throw new Error(
      "Project .mcp.json changed after this task selected its MCP servers; "
      + "review and enable them again",
    );
  }
  let document;
  try {
    document = JSON.parse(raw);
  } catch (error) {
    throw new Error(`MilkSU could not parse .mcp.json: ${error.message}`);
  }
  const configured = document?.mcpServers;
  if (!configured || typeof configured !== "object" || Array.isArray(configured)) {
    throw new Error("MilkSU could not find mcpServers in .mcp.json");
  }
  const mcpServers = {};
  const runtimeRoot = join(root, ".milksu", "mcp-runtime");
  await Promise.all([
    mkdir(join(runtimeRoot, "home"), { recursive: true, mode: 0o700 }),
    mkdir(join(runtimeRoot, "tmp"), { recursive: true, mode: 0o700 }),
  ]);
  for (const name of selected) {
    if (!Object.hasOwn(configured, name)) {
      throw new Error(`MCP server "${name}" is not present in .mcp.json`);
    }
    mcpServers[name] = sanitizeServerDefinition(configured[name], name, root);
  }
  return {
    selected,
    config: {
      settings: {
        toolPrefix: "server",
        hostConfigDiscovery: "off",
        idleTimeout: 10,
        outputGuard: true,
        directTools: false,
        disableProxyTool: false,
        sampling: false,
        samplingAutoApprove: false,
        elicitation: false,
        autoAuth: false,
      },
      mcpServers,
    },
  };
}

export async function ensureMcpMetadataCache(agentDir) {
  await mkdir(agentDir, { recursive: true, mode: 0o700 });
  const cachePath = join(agentDir, "mcp-cache.json");
  let file;
  try {
    file = await open(cachePath, "wx", 0o600);
  } catch (error) {
    if (error?.code === "EEXIST") return;
    throw error;
  }
  try {
    await file.writeFile('{"version":1,"servers":{}}\n', "utf8");
  } finally {
    await file.close();
  }
}

export function mcpSelectionChanged(previous, next) {
  return JSON.stringify(normalizeSelectedMcpServers(previous))
    !== JSON.stringify(normalizeSelectedMcpServers(next));
}
