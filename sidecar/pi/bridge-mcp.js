import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
} from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { sandboxProfile } from "./bridge-policy.js";
import {
  browserUseMcpServerName,
  codingBrowserEvidenceRelativePath,
  codingBrowserExcludedTools,
  codingBrowserMcpServerName,
} from "./bridge-browser-policy.js";

const maxConfigBytes = 1 << 20;
const maxSelectedServers = 16;
const maxReviewedTools = 64;
export { codingBrowserMcpServerName };
export { browserUseMcpServerName };
export const computerUseMcpServerName = "milksu-computer-use";
const bridgeDirectory = dirname(fileURLToPath(import.meta.url));
const sidecarResourceDirectory = existsSync(join(
  bridgeDirectory,
  "node_modules",
  "@playwright",
  "mcp",
))
  ? bridgeDirectory
  : resolve(bridgeDirectory, "..", "..");
const playwrightMcpCliPath = join(
  sidecarResourceDirectory,
  "node_modules",
  "@playwright",
  "mcp",
  "cli.js",
);
const shortRuntimeRoot = process.platform === "darwin" ? "/private/tmp" : tmpdir();
const playwrightSocketRoot = join(shortRuntimeRoot, "milksu-playwright");
const computerUseSocketRoot = join(shortRuntimeRoot, "milksu-computer-use");
const packagedComputerUseProxyPath = join(bridgeDirectory, "computer-use-proxy.cjs");
const computerUseProxyPath = existsSync(packagedComputerUseProxyPath)
  ? packagedComputerUseProxyPath
  : resolve(bridgeDirectory, "..", "computer-use", "computer-use-proxy.js");
const computerUseDriverPath = join(
  bridgeDirectory,
  process.platform === "win32" ? "cua-driver.exe" : "cua-driver",
);
const browserUseExecutableCandidates = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
];
const unixSafeChildEnvironmentNames = [
  "HOME",
  "PATH",
  "TMPDIR",
  "LANG",
  "LC_ALL",
  "SSL_CERT_DIR",
  "SSL_CERT_FILE",
];
const windowsSafeChildEnvironmentNames = [
  ...unixSafeChildEnvironmentNames,
  "SystemRoot",
  "WINDIR",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "TEMP",
  "TMP",
  "PATHEXT",
  "COMSPEC",
];
const safeChildEnvironmentNames = process.platform === "win32"
  ? windowsSafeChildEnvironmentNames
  : unixSafeChildEnvironmentNames;
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

export async function resolveReviewedMcpWorkspace(
  workspace,
  canonicalize = realpath,
) {
  const requestedWorkspace = resolve(workspace);
  const trustedWorkspace = String(process.env.MILKSU_AGENT_WORKSPACE ?? "").trim();
  if (
    trustedWorkspace
    && requestedWorkspace === resolve(trustedWorkspace)
    && requestedWorkspace === resolve(process.cwd())
  ) {
    return requestedWorkspace;
  }
  return canonicalize(workspace);
}

async function ensurePrivateDirectoryTree(root, segments, label) {
  let current = root;
  for (const segment of segments) {
    current = join(current, segment);
    let metadata;
    try {
      metadata = await lstat(current);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      try {
        await mkdir(current, { mode: 0o700 });
      } catch (mkdirError) {
        if (mkdirError?.code !== "EEXIST") throw mkdirError;
      }
      metadata = await lstat(current);
    }
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
      throw new Error(`MilkSU rejected a symlinked or invalid ${label} directory`);
    }
    await chmod(current, 0o700);
  }
  return current;
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

export function projectMcpServersFromSelection(value) {
  const candidates = Array.isArray(value)
    ? value.filter(name => ![
        codingBrowserMcpServerName,
        browserUseMcpServerName,
        computerUseMcpServerName,
      ].includes(String(name).trim()))
    : value;
  return normalizeSelectedMcpServers(candidates).filter(name => ![
    codingBrowserMcpServerName,
    browserUseMcpServerName,
    computerUseMcpServerName,
  ].includes(name));
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

function hostEnvironmentValue(source, name) {
  if (!source || typeof source !== "object") return undefined;
  if (typeof source[name] === "string" && source[name]) return source[name];
  if (process.platform !== "win32") return undefined;
  const match = Object.keys(source).find(key => key.toLowerCase() === name.toLowerCase());
  const value = match ? source[match] : undefined;
  return typeof value === "string" && value ? value : undefined;
}

function environmentAssignmentsToObject(assignments) {
  const environment = {};
  for (const assignment of assignments) {
    const index = assignment.indexOf("=");
    if (index <= 0) continue;
    environment[assignment.slice(0, index)] = assignment.slice(index + 1);
  }
  return environment;
}

function mcpRuntimeEnvironment(runtimeHome, runtimeTemporary) {
  if (process.platform === "win32") {
    return {
      HOME: runtimeHome,
      USERPROFILE: runtimeHome,
      TMPDIR: runtimeTemporary,
      TEMP: runtimeTemporary,
      TMP: runtimeTemporary,
    };
  }
  return {
    HOME: runtimeHome,
    TMPDIR: runtimeTemporary,
  };
}

function safeChildEnvironment(definition, serverName, runtimeEnvironment = {}) {
  const assignments = safeChildEnvironmentNames.flatMap(name => {
    const value = hostEnvironmentValue(runtimeEnvironment, name)
      ?? hostEnvironmentValue(process.env, name);
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

function sanitizeLocalDefinition(
  definition,
  serverName,
  workspace,
  { extraReadableRoots = [], extraWritableRoots = [], allowNetwork = true } = {},
) {
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
  const childEnvironment = safeChildEnvironment(
    definition,
    serverName,
    mcpRuntimeEnvironment(runtimeHome, runtimeTemporary),
  );
  if (process.platform === "darwin") {
    return {
      ...definition,
      command: "/usr/bin/sandbox-exec",
      args: [
        "-p",
        sandboxProfile(
          workspace,
          allowNetwork,
          [],
          false,
          extraReadableRoots,
          [runtimeHome, runtimeTemporary, ...extraWritableRoots],
        ),
        "/usr/bin/env",
        "-i",
        ...childEnvironment,
        command,
        ...args,
      ],
      env: {},
      cwd: workspace,
      lifecycle: "lazy",
      directTools: false,
    };
  }
  return {
    ...definition,
    command,
    args,
    env: environmentAssignmentsToObject(childEnvironment),
    cwd: workspace,
    lifecycle: "lazy",
    directTools: false,
  };
}

function sanitizeServerDefinition(definition, serverName, workspace, options) {
  if (!definition || typeof definition !== "object" || Array.isArray(definition)) {
    throw new Error(`MCP server "${serverName}" must be an object`);
  }
  if (definition.disabled === true) {
    throw new Error(`MCP server "${serverName}" is disabled in .mcp.json`);
  }
  const { milksu: _reviewMetadata, ...runtimeDefinition } = definition;
  if (runtimeDefinition.command) {
    return sanitizeLocalDefinition(runtimeDefinition, serverName, workspace, options);
  }
  if (runtimeDefinition.url) {
    return sanitizeRemoteDefinition(runtimeDefinition, serverName);
  }
  if (runtimeDefinition.socket) {
    return {
      ...runtimeDefinition,
      lifecycle: "lazy",
      directTools: false,
    };
  }
  throw new Error(`MCP server "${serverName}" has no command, URL, or socket`);
}

function reviewedProjectMcpDefinition(definition, serverName) {
  if (!definition || typeof definition !== "object" || Array.isArray(definition)) {
    throw new Error(`MCP server "${serverName}" must be an object`);
  }
  const source = definition.milksu?.source;
  const version = definition.milksu?.version;
  const taskScope = definition.milksu?.taskScope;
  const validText = (value, limit) => (
    typeof value === "string"
    && value === value.trim()
    && value.length > 0
    && [...value].length <= limit
    && !/[\u0000-\u001f\u007f]/u.test(value)
  );
  if (!validText(source, 160)) {
    throw new Error(
      `MCP server "${serverName}" must declare a bounded milksu.source`,
    );
  }
  if (
    !validText(version, 80)
    || /[\s*^~<>=|,]/u.test(version)
    || version.toLowerCase().split(/[._/-]/u).includes("x")
    || ["latest", "next", "canary", "main", "master", "head"]
      .includes(version.toLowerCase())
  ) {
    throw new Error(
      `MCP server "${serverName}" must declare a fixed milksu.version`,
    );
  }
  if (!validText(taskScope, 240)) {
    throw new Error(
      `MCP server "${serverName}" must declare a bounded milksu.taskScope`,
    );
  }
  if (
    !Array.isArray(definition.includeTools)
    || definition.includeTools.length === 0
    || definition.includeTools.length > maxReviewedTools
    || definition.includeTools.some(value => !validText(value, 100))
  ) {
    throw new Error(
      `MCP server "${serverName}" must declare 1-${maxReviewedTools} reviewed includeTools`,
    );
  }
  return {
    ...definition,
    includeTools: [...new Set(definition.includeTools)]
      .sort((left, right) => left.localeCompare(right)),
  };
}

function adapterConfig(mcpServers) {
  return {
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
  };
}

export function normalizeCodingBrowserDescriptor(value) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("MilkSU Coding Browser descriptor must be an object");
  }
  const fields = Object.keys(value).sort();
  if (
    fields.length !== 2
    || fields[0] !== "cdpEndpoint"
    || fields[1] !== "sessionId"
  ) {
    throw new Error(
      "MilkSU Coding Browser descriptor may contain only sessionId and cdpEndpoint",
    );
  }
  const sessionId = String(value.sessionId ?? "").trim();
  if (!/^browser_[A-Za-z0-9-]{8,128}$/.test(sessionId)) {
    throw new Error("MilkSU rejected an invalid Coding Browser session id");
  }
  const rawEndpoint = String(value.cdpEndpoint ?? "").trim();
  const endpointMatch = /^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})\/?$/.exec(rawEndpoint);
  const port = Number(endpointMatch?.[1] ?? 0);
  if (!endpointMatch || !Number.isInteger(port) || port > 65535) {
    throw new Error(
      "MilkSU Coding Browser CDP endpoint must be http://127.0.0.1:<port>",
    );
  }
  return {
    sessionId,
    cdpEndpoint: `http://127.0.0.1:${port}`,
  };
}

export function codingBrowserSelectionChanged(previous, next) {
  return JSON.stringify(normalizeCodingBrowserDescriptor(previous))
    !== JSON.stringify(normalizeCodingBrowserDescriptor(next));
}

export function normalizeBrowserUseDescriptor(value) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("MilkSU Browser Use descriptor must be an object");
  }
  const fields = Object.keys(value).sort();
  if (fields.length !== 1 || fields[0] !== "sessionId") {
    throw new Error("MilkSU Browser Use descriptor may contain only sessionId");
  }
  const sessionId = String(value.sessionId ?? "").trim();
  if (!/^browser_user-[A-Za-z0-9-]{8,128}$/.test(sessionId)) {
    throw new Error("MilkSU rejected an invalid Browser Use session id");
  }
  return { sessionId };
}

export function browserUseSelectionChanged(previous, next) {
  return JSON.stringify(normalizeBrowserUseDescriptor(previous))
    !== JSON.stringify(normalizeBrowserUseDescriptor(next));
}

export function normalizeComputerUseDescriptor(value) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("MilkSU Computer Use descriptor must be an object");
  }
  const fields = Object.keys(value).sort();
  if (
    fields.length !== 6
    || fields[0] !== "sessionId"
    || fields[1] !== "socketPath"
    || fields[2] !== "targetBundleId"
    || fields[3] !== "targetName"
    || fields[4] !== "targetPid"
    || fields[5] !== "targetWindowId"
  ) {
    throw new Error(
      "MilkSU Computer Use descriptor contains unsupported fields",
    );
  }
  const sessionId = String(value.sessionId ?? "").trim();
  if (!/^computer_[A-Za-z0-9-]{8,128}$/.test(sessionId)) {
    throw new Error("MilkSU rejected an invalid Computer Use session id");
  }
  const socketPath = String(value.socketPath ?? "").trim();
  const expectedSocket = process.platform === "win32"
    ? `\\\\.\\pipe\\milksu-computer-use-${sessionId}`
    : join(computerUseSocketRoot, sessionId, "driver.sock");
  if (socketPath !== expectedSocket) {
    throw new Error("MilkSU rejected a Computer Use socket outside its private session");
  }
  const targetBundleId = String(value.targetBundleId ?? "").trim();
  const targetName = String(value.targetName ?? "").trim();
  if (!/^[A-Za-z0-9.-]{1,256}$/.test(targetBundleId)) {
    throw new Error("MilkSU rejected an invalid Computer Use bundle id");
  }
  if (
    !targetName
    || targetName.length > 120
    || /[\u0000-\u001f\u007f]/u.test(targetName)
  ) {
    throw new Error("MilkSU rejected an invalid Computer Use target name");
  }
  const targetPid = Number(value.targetPid);
  if (!Number.isSafeInteger(targetPid) || targetPid <= 1) {
    throw new Error("MilkSU rejected an invalid Computer Use target PID");
  }
  const targetWindowId = Number(value.targetWindowId);
  if (!Number.isSafeInteger(targetWindowId) || targetWindowId <= 0) {
    throw new Error("MilkSU rejected an invalid Computer Use target window");
  }
  return {
    sessionId,
    socketPath,
    targetBundleId,
    targetName,
    targetPid,
    targetWindowId,
  };
}

export function computerUseSelectionChanged(previous, next) {
  return JSON.stringify(normalizeComputerUseDescriptor(previous))
    !== JSON.stringify(normalizeComputerUseDescriptor(next));
}

export function computerUseSandboxProfile(socketPath, runtimeRoot) {
  const runtimeHome = join(runtimeRoot, "home");
  const runtimeTemporary = join(runtimeRoot, "tmp");
  const readableRoots = [
    bridgeDirectory,
    dirname(computerUseProxyPath),
    runtimeRoot,
    "/System",
    "/usr",
    "/bin",
    "/sbin",
    "/Library",
    "/private/var/select",
  ];
  const metadataOnlyRoots = ["/private", "/private/tmp"];
  for (const root of readableRoots) {
    let parent = dirname(root);
    while (parent !== dirname(parent)) {
      metadataOnlyRoots.push(parent);
      parent = dirname(parent);
    }
  }
  return [
    "(version 1)",
    '(import "system.sb")',
    "(allow process*)",
    "(allow sysctl-read)",
    `(allow file-read-metadata ${[...new Set(metadataOnlyRoots)].map(path => (
      `(literal ${JSON.stringify(path)})`
    )).join(" ")})`,
    `(allow file-read* ${readableRoots.map(path => (
      `(subpath ${JSON.stringify(path)})`
    )).join(" ")})`,
    `(allow file-write* (subpath ${JSON.stringify(runtimeHome)}) `
      + `(subpath ${JSON.stringify(runtimeTemporary)}))`,
    `(allow network-outbound (remote unix-socket (path-literal ${JSON.stringify(socketPath)})))`,
  ].join("\n");
}

export async function createFirstPartyComputerUseMcpServer(descriptor) {
  const computerUse = normalizeComputerUseDescriptor(descriptor);
  if (!computerUse) return undefined;
  const [proxyMetadata, driverMetadata] = await Promise.all([
    lstat(computerUseProxyPath),
    lstat(computerUseDriverPath),
  ]);
  if (
    proxyMetadata.isSymbolicLink()
    || !proxyMetadata.isFile()
    || driverMetadata.isSymbolicLink()
    || !driverMetadata.isFile()
  ) {
    throw new Error("MilkSU packaged Computer Use runtime is unavailable");
  }
  if (process.platform !== "win32") {
    const socketMetadata = await lstat(computerUse.socketPath);
    if (socketMetadata.isSymbolicLink() || !socketMetadata.isSocket()) {
      throw new Error("MilkSU packaged Computer Use runtime is unavailable");
    }
  }
  const runtimeRoot = process.platform === "win32"
    ? join(tmpdir(), "milksu-computer-use", computerUse.sessionId)
    : dirname(computerUse.socketPath);
  const runtimeHome = join(runtimeRoot, "home");
  const runtimeTemporary = join(runtimeRoot, "tmp");
  await Promise.all([
    mkdir(runtimeHome, { recursive: true, mode: 0o700 }),
    mkdir(runtimeTemporary, { recursive: true, mode: 0o700 }),
  ]);
  const proxyArguments = [
    computerUseProxyPath,
    "--socket",
    computerUse.socketPath,
    "--session",
    computerUse.sessionId,
    "--target-name",
    computerUse.targetName,
    "--target-bundle-id",
    computerUse.targetBundleId,
    "--target-window-id",
    String(computerUse.targetWindowId),
    "--target-pid",
    String(computerUse.targetPid),
    "--driver",
    computerUseDriverPath,
  ];
  if (process.platform === "win32") {
    const systemRoot = process.env.SystemRoot || "C:\\Windows";
    return {
      computerUse,
      server: {
        command: process.execPath,
        args: proxyArguments,
        env: {
          SystemRoot: systemRoot,
          WINDIR: systemRoot,
          USERPROFILE: runtimeHome,
          APPDATA: join(runtimeHome, "AppData", "Roaming"),
          LOCALAPPDATA: join(runtimeHome, "AppData", "Local"),
          TEMP: runtimeTemporary,
          TMP: runtimeTemporary,
          PATH: join(systemRoot, "System32"),
          CUA_DRIVER_EMBEDDED: "1",
          CUA_DRIVER_RS_TELEMETRY_ENABLED: "false",
          CUA_LOG: "warn",
        },
        cwd: runtimeRoot,
        lifecycle: "lazy",
        directTools: false,
      },
    };
  }
  return {
    computerUse,
    server: {
      command: "/usr/bin/sandbox-exec",
      args: [
        "-p",
        computerUseSandboxProfile(computerUse.socketPath, runtimeRoot),
        "/usr/bin/env",
        "-i",
        `HOME=${runtimeHome}`,
        `TMPDIR=${runtimeTemporary}`,
        "PATH=/usr/bin:/bin:/usr/sbin:/sbin",
        "LANG=en_US.UTF-8",
        "CUA_DRIVER_EMBEDDED=1",
        "CUA_DRIVER_RS_TELEMETRY_ENABLED=false",
        process.execPath,
        ...proxyArguments,
      ],
      env: {},
      cwd: runtimeRoot,
      lifecycle: "lazy",
      directTools: false,
    },
  };
}

export async function createFirstPartyPlaywrightMcpServer(workspace, descriptor) {
  const browser = normalizeCodingBrowserDescriptor(descriptor);
  if (!browser) return undefined;
  const root = await resolveReviewedMcpWorkspace(workspace);
  const cliMetadata = await lstat(playwrightMcpCliPath);
  if (cliMetadata.isSymbolicLink() || !cliMetadata.isFile()) {
    throw new Error("MilkSU packaged Playwright MCP CLI is unavailable");
  }
  const runtimeRoot = await ensurePrivateDirectoryTree(
    root,
    [".milksu", "mcp-runtime"],
    "Coding Browser runtime",
  );
  const evidenceRelativePath = codingBrowserEvidenceRelativePath(browser.sessionId);
  if (!evidenceRelativePath) {
    throw new Error("MilkSU rejected an invalid Coding Browser evidence path");
  }
  const evidenceRoot = await ensurePrivateDirectoryTree(
    root,
    evidenceRelativePath.split("/"),
    "Coding Browser evidence",
  );
  await Promise.all([
    mkdir(join(runtimeRoot, "home"), { recursive: true, mode: 0o700 }),
    mkdir(join(runtimeRoot, "tmp"), { recursive: true, mode: 0o700 }),
  ]);
  // Playwright creates a Unix domain socket while attaching over CDP. macOS
  // limits socket paths to roughly 104 bytes, so the user-data directory is too
  // deep even though it is otherwise writable. Keep only this ephemeral socket
  // under a short, session-derived directory.
  const socketRoot = join(
    playwrightSocketRoot,
    browser.sessionId.slice(-12),
  );
  await mkdir(socketRoot, { recursive: true, mode: 0o700 });
  return {
    browser,
    server: sanitizeServerDefinition(
      {
        command: process.execPath,
        args: [
          playwrightMcpCliPath,
          "--cdp-endpoint",
          browser.cdpEndpoint,
          "--output-dir",
          evidenceRoot,
          "--output-max-size",
          String(16 << 20),
          "--console-level=debug",
          "--save-session",
          "--codegen=none",
          "--output-mode=stdout",
        ],
        env: {
          PWTEST_SOCKETS_DIR: socketRoot,
        },
        excludeTools: codingBrowserExcludedTools,
      },
      codingBrowserMcpServerName,
      root,
      {
        extraReadableRoots: [sidecarResourceDirectory],
        extraWritableRoots: [socketRoot, evidenceRoot],
      },
    ),
  };
}

async function resolveBrowserUseExecutable() {
  for (const candidate of browserUseExecutableCandidates) {
    try {
      const metadata = await lstat(candidate);
      if (!metadata.isSymbolicLink() && metadata.isFile()) return candidate;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  throw new Error(
    "MilkSU Browser Use requires Google Chrome or Microsoft Edge on macOS",
  );
}

export async function createFirstPartyBrowserUseMcpServer(
  workspace,
  descriptor,
  options = {},
) {
  const browserUse = normalizeBrowserUseDescriptor(descriptor);
  if (!browserUse) return undefined;
  const root = await resolveReviewedMcpWorkspace(workspace);
  const cliMetadata = await lstat(playwrightMcpCliPath);
  if (cliMetadata.isSymbolicLink() || !cliMetadata.isFile()) {
    throw new Error("MilkSU packaged Playwright MCP CLI is unavailable");
  }
  const executablePath = options.executablePath || await resolveBrowserUseExecutable();
  const executableMetadata = await lstat(executablePath);
  if (executableMetadata.isSymbolicLink() || !executableMetadata.isFile()) {
    throw new Error("MilkSU rejected an invalid Browser Use executable");
  }
  const runtimeRoot = await ensurePrivateDirectoryTree(
    root,
    [".milksu", "mcp-runtime"],
    "Browser Use runtime",
  );
  const evidenceRelativePath = codingBrowserEvidenceRelativePath(browserUse.sessionId);
  if (!evidenceRelativePath) {
    throw new Error("MilkSU rejected an invalid Browser Use evidence path");
  }
  const evidenceRoot = await ensurePrivateDirectoryTree(
    root,
    evidenceRelativePath.split("/"),
    "Browser Use evidence",
  );
  return {
    browserUse,
    server: sanitizeServerDefinition(
      {
        command: process.execPath,
        args: [
          playwrightMcpCliPath,
          "--extension",
          "--executable-path",
          executablePath,
          "--output-dir",
          evidenceRoot,
          "--output-max-size",
          String(16 << 20),
          "--console-level=debug",
          "--save-session",
          "--codegen=none",
          "--output-mode=stdout",
        ],
        excludeTools: codingBrowserExcludedTools,
      },
      browserUseMcpServerName,
      root,
      {
        extraReadableRoots: [sidecarResourceDirectory, executablePath],
        extraWritableRoots: [evidenceRoot],
      },
    ),
  };
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
  if (
    selected.includes(codingBrowserMcpServerName)
    || selected.includes(browserUseMcpServerName)
    || selected.includes(computerUseMcpServerName)
  ) {
    throw new Error(
      `MCP server name "${selected.find(name => (
        name === codingBrowserMcpServerName
          || name === browserUseMcpServerName
          || name === computerUseMcpServerName
      ))}" is reserved by MilkSU`,
    );
  }

  const root = await resolveReviewedMcpWorkspace(workspace);
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
    mcpServers[name] = sanitizeServerDefinition(
      reviewedProjectMcpDefinition(configured[name], name),
      name,
      root,
    );
  }
  return {
    selected,
    config: adapterConfig(mcpServers),
  };
}

export async function loadCodingMcpConfig(
  workspace,
  requestedServers,
  expectedDigest,
  codingBrowser,
  computerUse,
  browserUse,
  securityTools = [],
) {
  const project = await loadSelectedMcpConfig(
    workspace,
    projectMcpServersFromSelection(requestedServers),
    expectedDigest,
  );
  const builtIn = await createFirstPartyPlaywrightMcpServer(workspace, codingBrowser);
  const builtInComputerUse = await createFirstPartyComputerUseMcpServer(computerUse);
  const builtInBrowserUse = await createFirstPartyBrowserUseMcpServer(workspace, browserUse);
  const builtInIDA = await createManagedIDAMcpServer(workspace, securityTools);
  if (!builtIn && !builtInComputerUse && !builtInBrowserUse && !builtInIDA) {
    return {
      ...project,
      projectSelected: project.selected,
      codingBrowser: undefined,
      computerUse: undefined,
      browserUse: undefined,
      securityTools,
    };
  }
  const selected = [
    ...project.selected,
    ...(builtIn ? [codingBrowserMcpServerName] : []),
    ...(builtInBrowserUse ? [browserUseMcpServerName] : []),
    ...(builtInComputerUse ? [computerUseMcpServerName] : []),
    ...(builtInIDA ? [builtInIDA.name] : []),
  ].sort((left, right) => left.localeCompare(right));
  return {
    projectSelected: project.selected,
    selected,
    codingBrowser: builtIn?.browser,
    computerUse: builtInComputerUse?.computerUse,
    browserUse: builtInBrowserUse?.browserUse,
    securityTools,
    config: adapterConfig({
      ...(project.config?.mcpServers ?? {}),
      ...(builtIn ? { [codingBrowserMcpServerName]: builtIn.server } : {}),
      ...(builtInBrowserUse
        ? { [browserUseMcpServerName]: builtInBrowserUse.server }
        : {}),
      ...(builtInComputerUse
        ? { [computerUseMcpServerName]: builtInComputerUse.server }
        : {}),
      ...(builtInIDA ? { [builtInIDA.name]: builtInIDA.server } : {}),
    }),
  };
}

async function createManagedIDAMcpServer(workspace, securityTools) {
  const ida = securityTools.find(tool => tool.id === "ida-pro");
  if (!ida) return undefined;
  const root = await resolveReviewedMcpWorkspace(workspace);
  const runtimeRoot = await ensurePrivateDirectoryTree(
    root,
    [".milksu", "mcp-runtime"],
    "IDA MCP runtime",
  );
  await Promise.all([
    mkdir(join(runtimeRoot, "home"), { recursive: true, mode: 0o700 }),
    mkdir(join(runtimeRoot, "tmp"), { recursive: true, mode: 0o700 }),
  ]);
  const name = "milksu-ida-pro";
  const includeTools = [
    "idb_open", "idb_list", "idb_close", "server_health",
    "list_funcs", "list_globals", "imports", "imports_query",
    "lookup_funcs", "func_query", "entity_query", "int_convert", "find_regex",
    "decompile", "disasm", "func_profile", "analyze_batch", "xrefs_to",
    "xref_query", "xrefs_to_field", "callees", "basic_blocks", "find_bytes",
    "find", "insn_query", "export_funcs", "callgraph", "analyze_function",
    "analyze_component", "trace_data_flow", "read_struct", "type_query",
    "get_bytes", "get_int", "get_string", "get_global_value", "stack_frame",
  ];
  return {
    name,
    server: sanitizeServerDefinition(
      {
        command: ida.command,
        args: [
          "--stdio",
          "--profile",
          ida.profilePath,
          "--max-workers",
          "2",
        ],
        env: {
          HOME: dirname(ida.userIdaPath),
          IDAUSR: ida.userIdaPath,
        },
        includeTools,
      },
      name,
      root,
      {
        allowNetwork: false,
        extraReadableRoots: [
          dirname(dirname(ida.command)),
          ida.profilePath,
          ida.idaPath,
          ida.userIdaPath,
        ],
        extraWritableRoots: [ida.userIdaPath],
      },
    ),
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
