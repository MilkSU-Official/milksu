import {
  createBashToolDefinition,
  createEditToolDefinition,
  createFindToolDefinition,
  createGrepToolDefinition,
  createLsToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  defineTool,
  getShellConfig,
} from "@earendil-works/pi-coding-agent";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import {
  lstat,
  mkdir,
  realpath,
  writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import {
  dirname,
  delimiter,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { Type } from "typebox";
import {
  codingGoalToolNames,
  codingSessionToolNames,
  codingWebResearchToolNames,
  normalizeCodingPolicy,
} from "./bridge-coding-policy.js";
import {
  codingCollaborationToolName,
  collaborationWorktreePaths,
} from "./bridge-collaboration.js";
import { envToolNames } from "./bridge-env.js";
import { isResearchSessionRole } from "./bridge-workspace.js";
import { wrapEditToolDefinition } from "./bridge-edit-anchor.js";
import {
  codingImageGenToolName,
  createImageGenTool,
} from "./bridge-imagegen.js";

export {
  codingSessionToolNames,
  normalizeCodingPolicy,
} from "./bridge-coding-policy.js";
export function scopeAllowsNetwork() {
  return true;
}

const codingProductReadOnlyToolNames = [
  "read",
  "grep",
  "find",
  "ls",
  "milksu_progress",
  "milksu_ask",
  "milksu_workspace",
  "lsp_diagnostics",
  ...codingWebResearchToolNames,
  ...codingGoalToolNames,
];
const codingProductTestToolNames = [
  "read",
  "bash",
  "grep",
  "find",
  "ls",
  "milksu_progress",
  "milksu_ask",
  "milksu_workspace",
  "lsp_diagnostics",
  ...codingWebResearchToolNames,
  ...codingGoalToolNames,
];
const codingProductFixToolNames = [
  "read",
  "bash",
  "edit",
  "write",
  "grep",
  "find",
  "ls",
  "milksu_progress",
  "milksu_ask",
  "milksu_workspace",
  "lsp_diagnostics",
  "lsp_fix",
  ...codingWebResearchToolNames,
  ...codingGoalToolNames,
];
// The command PATH a sandboxed project command receives. It is a fixed,
// policy-visible list rather than the user's PATH, and it therefore has to name
// the places each platform actually keeps its tools.
function defaultCommandPath() {
  if (process.platform === "win32") {
    const systemRoot = process.env.SystemRoot || process.env.WINDIR || "C:\\Windows";
    return [
      join(systemRoot, "System32"),
      systemRoot,
      join(systemRoot, "System32", "Wbem"),
      join(systemRoot, "System32", "WindowsPowerShell", "v1.0"),
    ].join(delimiter);
  }
  if (process.platform === "darwin") {
    return [
      "/Library/Developer/CommandLineTools/usr/bin",
      "/usr/bin",
      "/bin",
      "/usr/sbin",
      "/sbin",
      "/opt/homebrew/bin",
      "/usr/local/bin",
    ].join(delimiter);
  }
  return [
    "/usr/local/sbin",
    "/usr/local/bin",
    "/usr/sbin",
    "/usr/bin",
    "/sbin",
    "/bin",
    "/snap/bin",
    "/var/lib/flatpak/exports/bin",
    "/run/current-system/sw/bin",
  ].join(delimiter);
}
const commandPath = defaultCommandPath();
const protectedWorkspaceEntries = [
  "challenge.json",
  "AGENTS.md",
  "TASK.md",
  "TOOLING.md",
  "MEMORY.md",
  "materials",
  "evidence",
  ".git",
];

function within(root, target) {
  const path = relative(root, target);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
}

async function nearestExistingAncestor(path) {
  let current = path;
  for (;;) {
    try {
      await lstat(current);
      return current;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    const parent = dirname(current);
    if (parent === current) return current;
    current = parent;
  }
}

async function mutationOwnerRoot(requestedPath, allowedRoots) {
  let ancestor = requestedPath;
  for (;;) {
    try {
      const info = await lstat(ancestor);
      if (info.isSymbolicLink()) {
        const parent = dirname(ancestor);
        if (parent === ancestor) return undefined;
        ancestor = parent;
        continue;
      }
      const canonicalAncestor = await realpath(ancestor);
      const ownedPath = resolve(
        canonicalAncestor,
        relative(ancestor, requestedPath),
      );
      const root = allowedRoots.find(value => within(value, ownedPath));
      return root ? { root, ownedPath } : undefined;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    const parent = dirname(ancestor);
    if (parent === ancestor) return undefined;
    ancestor = parent;
  }
}

export async function assertWorkspacePath(workspace, requestedPath) {
  const root = await resolveReviewedWorkspace(workspace);
  const absolutePath = resolve(requestedPath);
  if (absolutePath === root) return root;
  const existing = await nearestExistingAncestor(absolutePath);
  const canonicalAncestor = await realpath(existing);
  const unresolvedSuffix = relative(existing, absolutePath);
  const canonicalPath = resolve(canonicalAncestor, unresolvedSuffix);
  if (!within(root, canonicalPath)) {
    throw new Error(`MilkSU workspace policy denied path outside or through a symlink: ${requestedPath}`);
  }
  return canonicalPath;
}

async function assertWorkspaceMutationPath(
  workspace,
  requestedPath,
  extraProtectedEntries = [],
  includeCTFProtectedEntries = true,
) {
  const root = await resolveReviewedWorkspace(workspace);
  const safePath = await assertWorkspacePath(root, requestedPath);
  const relativePath = relative(root, safePath);
  const protectedEntry = [
    ...(includeCTFProtectedEntries ? protectedWorkspaceEntries : []),
    ...extraProtectedEntries,
  ].find(entry => (
    relativePath === entry || relativePath.startsWith(`${entry}${sep}`)
  ));
  if (protectedEntry) {
    throw new Error(`MilkSU workspace policy denied mutation of protected entry: ${protectedEntry}`);
  }
  return safePath;
}

function sandboxString(value) {
  return JSON.stringify(value);
}

const networkSystemReadableRoots = [
  "/private/etc/ssl",
  "/etc/ssl",
];

export function sandboxProfile(
  workspace,
  allowNetwork,
  extraProtectedEntries = [],
  includeCTFProtectedEntries = true,
  extraReadableRoots = [],
  extraWritableRoots = [],
) {
  const readableRoots = [
    workspace,
    dirname(process.execPath),
    ...extraReadableRoots,
    ...extraWritableRoots,
    ...(allowNetwork ? networkSystemReadableRoots : []),
    "/System",
    "/usr",
    "/bin",
    "/sbin",
    "/Library",
    "/private/var/select",
    "/Applications/Xcode.app",
    "/opt/homebrew",
    "/usr/local",
  ];
  // sandbox-exec evaluates path traversal one component at a time. A reviewed
  // resource can be readable while its ancestors (for example /Users) still
  // reject lstat/realpath, which prevents Node CLIs such as Archify from ever
  // reaching the admitted directory. Grant metadata only—not file contents—
  // for every ancestor needed to traverse each readable root.
  const metadataOnlyRoots = ["/opt"];
  for (const root of readableRoots) {
    let parent = dirname(root);
    while (parent !== dirname(parent)) {
      metadataOnlyRoots.push(parent);
      parent = dirname(parent);
    }
  }
  const rules = [
    "(version 1)",
    '(import "system.sb")',
    "(allow process*)",
    "(allow sysctl-read)",
    `(allow file-read-metadata ${[...new Set(metadataOnlyRoots)].map(path => (
      `(literal ${sandboxString(path)})`
    )).join(" ")})`,
    `(allow file-read* ${readableRoots.map(path => `(subpath ${sandboxString(path)})`).join(" ")})`,
    `(allow file-write* ${[workspace, ...extraWritableRoots].map(path => (
      `(subpath ${sandboxString(path)})`
    )).join(" ")})`,
    `(deny file-write* ${[
      ...(includeCTFProtectedEntries ? protectedWorkspaceEntries : []),
      ...extraProtectedEntries,
    ].map(entry => {
      const path = join(workspace, entry);
      return ["materials", "evidence", ".git", ".milksu"].includes(entry)
        ? `(subpath ${sandboxString(path)})`
        : `(literal ${sandboxString(path)})`;
    }).join(" ")})`,
  ];
  if (allowNetwork) rules.push("(allow network*)");
  return rules.join("\n");
}

function commandRuntimeDirectory(workspace) {
  const configured = String(process.env.MILKSU_WORKSPACE_RUNTIME || "").trim();
  return configured ? resolve(configured) : join(workspace, ".milksu");
}

function commandEnvironment(workspace, source = {}, runtimeDirectory = commandRuntimeDirectory(workspace)) {
  const home = join(runtimeDirectory, "home");
  const temporary = join(runtimeDirectory, "tmp");
  const runtimeBin = join(runtimeDirectory, "runtime-bin");
  const environment = {
    PATH: `${runtimeBin}${delimiter}${commandPath}`,
    HOME: home,
    TMPDIR: temporary,
    LANG: source.LANG || "en_US.UTF-8",
    TERM: source.TERM || "dumb",
    SHELL: "/bin/bash",
  };
  for (const name of ["LC_ALL", "SSL_CERT_DIR", "SSL_CERT_FILE"]) {
    if (source[name]) environment[name] = source[name];
  }
  return environment;
}

async function ensureSandboxedCommandRuntime(runtimeDirectory) {
  const runtimeBin = join(runtimeDirectory, "runtime-bin");
  const nodeWrapper = join(runtimeBin, "node");
  const nodeBinary = process.execPath;
  await mkdir(runtimeBin, { recursive: true, mode: 0o700 });
  // Do not let ambient NODE_OPTIONS alter project commands. sandbox-exec owns
  // network denial, workspace writes, and protected .git/.milksu paths here.
  await writeFile(
    nodeWrapper,
    `#!/bin/sh\nunset NODE_OPTIONS\nexec ${JSON.stringify(nodeBinary)} "$@"\n`,
    { mode: 0o700 },
  );
}

function killChildProcess(child) {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
}

const windowsHostEnvironmentNames = [
  "SystemRoot",
  "WINDIR",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "TEMP",
  "TMP",
  "PATHEXT",
  "COMSPEC",
  "ProgramFiles",
  "ProgramFiles(x86)",
  "ProgramData",
  "USERNAME",
  "USERDOMAIN",
];

function hostEnvironmentValue(source, name) {
  if (!source || typeof source !== "object") return undefined;
  if (typeof source[name] === "string" && source[name]) return source[name];
  if (process.platform !== "win32") return undefined;
  const match = Object.keys(source).find(key => key.toLowerCase() === name.toLowerCase());
  const value = match ? source[match] : undefined;
  return typeof value === "string" && value ? value : undefined;
}

function fullAccessCommandEnvironment(source = {}, shellPath = "") {
  const environment = {
    PATH: hostEnvironmentValue(source, "PATH") || commandPath,
    HOME: source.MILKSU_USER_HOME || hostEnvironmentValue(source, "HOME") || homedir() || "/",
    TMPDIR: hostEnvironmentValue(source, "TMPDIR")
      || hostEnvironmentValue(source, "TEMP")
      || tmpdir(),
    LANG: hostEnvironmentValue(source, "LANG") || "en_US.UTF-8",
    TERM: hostEnvironmentValue(source, "TERM") || "dumb",
    SHELL: shellPath || hostEnvironmentValue(source, "SHELL") || "/bin/bash",
  };
  for (const name of ["LC_ALL", "SSL_CERT_DIR", "SSL_CERT_FILE"]) {
    const value = hostEnvironmentValue(source, name);
    if (value) environment[name] = value;
  }
  if (source.MILKSU_USER_SSH_AUTH_SOCK) {
    environment.SSH_AUTH_SOCK = source.MILKSU_USER_SSH_AUTH_SOCK;
  }
  if (process.platform === "win32") {
    for (const name of windowsHostEnvironmentNames) {
      const value = hostEnvironmentValue(source, name);
      if (value) environment[name] = value;
    }
  }
  return environment;
}

const blockedBackgroundEnvironmentNames = new Set([
  "BASH_ENV",
  "ENV",
  "HOME",
  "LD_LIBRARY_PATH",
  "NODE_OPTIONS",
  "PATH",
  "SHELL",
  "TMPDIR",
]);

function sanitizedBackgroundEnvironment(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const environment = {};
  for (const [rawName, rawValue] of Object.entries(value)) {
    const name = String(rawName).trim();
    if (
      !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)
      || blockedBackgroundEnvironmentNames.has(name)
      || name.startsWith("DYLD_")
      || name.startsWith("MILKSU_")
      || name.startsWith("PI_")
      || /(?:^|_)(?:API_?KEY|AUTH|COOKIE|CREDENTIAL|PASSWORD|SECRET|TOKEN)(?:_|$)/i.test(name)
    ) {
      continue;
    }
    environment[name] = String(rawValue).replaceAll("\0", "");
  }
  return environment;
}

function reviewedBackgroundOutputPath(value) {
  if (!value) return "";
  const configuredRuntime = String(process.env.MILKSU_WORKSPACE_RUNTIME ?? "").trim();
  if (!configuredRuntime) {
    throw new Error(
      "MilkSU denied a background process without a private runtime",
    );
  }
  const runtimeDirectory = resolve(configuredRuntime);
  const outputPath = resolve(value);
  const path = relative(runtimeDirectory, outputPath);
  if (
    path === ""
    || path === ".."
    || path.startsWith(`..${sep}`)
    || isAbsolute(path)
  ) {
    throw new Error(
      "MilkSU denied a background process log outside its private runtime",
    );
  }
  return outputPath;
}

export function buildCodingBackgroundLaunch(
  specification,
  trustedOutputPath = "",
) {
  const cwd = resolve(specification.cwd || process.cwd());
  reviewedBackgroundOutputPath(trustedOutputPath);
  const explicitEnvironment = sanitizedBackgroundEnvironment(specification.env);
  const direct = specification.shell === false;
  const shellConfig = direct ? undefined : getShellConfig();
  const environment = {
    ...fullAccessCommandEnvironment(process.env, shellConfig?.shell),
    ...explicitEnvironment,
  };
  if (direct) {
    return {
      file: specification.argv[0],
      arguments: specification.argv.slice(1),
      cwd,
      environment,
    };
  }
  const commandFromStdin = shellConfig.commandTransport === "stdin";
  const shellArguments = ["--noprofile", "--norc", ...shellConfig.args];
  return {
    file: shellConfig.shell,
    arguments: commandFromStdin
      ? shellArguments
      : [...shellArguments, specification.command],
    stdin: commandFromStdin ? specification.command : undefined,
    cwd,
    environment,
  };
}

export function normalizeCodingProductAction(_workspace, value) {
  if (!value || typeof value !== "object") return undefined;
  if (["understand", "test", "review", "fix", "summary"].includes(value.kind)) {
    return { kind: value.kind };
  }
  return undefined;
}

function codingProductActionTools(action, fallback) {
  if (["understand", "review", "summary"].includes(action?.kind)) {
    return [...codingProductReadOnlyToolNames];
  }
  if (action?.kind === "test") return [...codingProductTestToolNames];
  if (action?.kind === "fix") return [...codingProductFixToolNames];
  return fallback;
}

function createArchifyTool(workspace, reviewedResourceRoots, productAction) {
  const archifyRoot = reviewedResourceRoots.find(path => (
    existsSync(join(path, "bin", "archify.mjs"))
  ));
  return defineTool({
    name: "milksu_archify",
    label: "Validate and deliver with Archify",
    description: "Run the reviewed packaged Archify CLI without a generic shell. "
      + "Use validate after writing a candidate specification and deliver only after validation "
      + "passes. MilkSU confines inputs and outputs to the selected workspace.",
    parameters: Type.Object({
      action: Type.Union([
        Type.Literal("validate"),
        Type.Literal("deliver"),
      ]),
      diagramType: Type.Optional(Type.Union([
        Type.Literal("architecture"),
        Type.Literal("workflow"),
        Type.Literal("sequence"),
        Type.Literal("dataflow"),
        Type.Literal("lifecycle"),
      ])),
      inputPath: Type.String({ maxLength: 1024 }),
      outputPath: Type.Optional(Type.String({ maxLength: 1024 })),
      quality: Type.Optional(Type.Union([
        Type.Literal("standard"),
        Type.Literal("showcase"),
      ])),
    }),
    execute: async (_toolCallId, params, signal) => {
      if (!archifyRoot) {
        throw new Error("MilkSU packaged Archify resource is unavailable");
      }
      const root = await resolveReviewedWorkspace(workspace);
      const input = await assertWorkspacePath(root, resolve(root, params.inputPath));
      const diagramType = params.diagramType || "architecture";
      const quality = params.quality || "showcase";
      const argumentsList = [
        join(archifyRoot, "bin", "archify.mjs"),
        params.action,
        diagramType,
        input,
      ];
      let output;
      if (params.action === "deliver") {
        if (!params.outputPath) {
          throw new Error("milksu_archify deliver requires outputPath");
        }
        output = await assertWorkspaceMutationPath(
          root,
          resolve(root, params.outputPath),
          [".git", ".milksu"],
          false,
        );
        argumentsList.push(output);
      }
      argumentsList.push("--quality", quality, "--json", "--repo-root", root);

      const runtimeDirectory = commandRuntimeDirectory(root);
      const runtimeHome = join(runtimeDirectory, "home");
      const runtimeTemporary = join(runtimeDirectory, "tmp");
      const runtimeBin = join(runtimeDirectory, "runtime-bin");
      await mkdir(runtimeHome, { recursive: true, mode: 0o700 });
      await mkdir(runtimeTemporary, { recursive: true, mode: 0o700 });
      await ensureSandboxedCommandRuntime(runtimeDirectory);

      const result = await new Promise((resolvePromise, rejectPromise) => {
        const child = spawn(
          "/usr/bin/sandbox-exec",
          [
            "-p",
            sandboxProfile(
              root,
              false,
              [],
              false,
              [archifyRoot, runtimeBin],
              [runtimeHome, runtimeTemporary],
            ),
            join(runtimeBin, "node"),
            ...argumentsList,
          ],
          {
            cwd: root,
            detached: true,
            env: commandEnvironment(root, process.env, runtimeDirectory),
            stdio: ["ignore", "pipe", "pipe"],
          },
        );
        const chunks = [];
        let bytes = 0;
        let timedOut = false;
        const append = chunk => {
          if (bytes >= 131072) return;
          const data = Buffer.from(chunk);
          const remaining = 131072 - bytes;
          chunks.push(data.subarray(0, remaining));
          bytes += Math.min(data.length, remaining);
        };
        const onAbort = () => killChildProcess(child);
        const timeout = setTimeout(() => {
          timedOut = true;
          killChildProcess(child);
        }, 120_000);
        signal?.addEventListener("abort", onAbort, { once: true });
        child.stdout?.on("data", append);
        child.stderr?.on("data", append);
        child.on("error", error => {
          clearTimeout(timeout);
          signal?.removeEventListener("abort", onAbort);
          rejectPromise(error);
        });
        child.on("close", exitCode => {
          clearTimeout(timeout);
          signal?.removeEventListener("abort", onAbort);
          const text = Buffer.concat(chunks, bytes).toString("utf8").trim();
          if (signal?.aborted) {
            rejectPromise(new Error("Archify action aborted"));
          } else if (timedOut) {
            rejectPromise(new Error("Archify action timed out after 120 seconds"));
          } else if (exitCode !== 0) {
            rejectPromise(new Error(text || `Archify exited with code ${exitCode}`));
          } else {
            resolvePromise(text);
          }
        });
      });
      let receipt;
      try {
        receipt = JSON.parse(result);
      } catch {
        receipt = { ok: true, output: result };
      }
      return {
        content: [{ type: "text", text: JSON.stringify(receipt, null, 2) }],
        details: receipt,
      };
    },
  });
}

async function resolveReviewedWorkspace(workspace) {
  const requestedWorkspace = resolve(workspace);
  const trustedWorkspace = String(process.env.MILKSU_AGENT_WORKSPACE ?? "").trim();
  if (
    trustedWorkspace
    && requestedWorkspace === resolve(trustedWorkspace)
    && requestedWorkspace === resolve(process.cwd())
  ) {
    return requestedWorkspace;
  }
  return realpath(workspace);
}

// PR-2 批次 B2：门开路径（harness-bridge-tools.js）复用同一构造器，保证
// read/bash/edit/write/grep/find/ls 与门关会话逐字节同源。只加 export，行为不变。
export async function createCodingToolDefinitions(
  workspace,
  resourceReadRoots = [],
  productAction = undefined,
  codingCollaboration = undefined,
) {
  const root = await resolveReviewedWorkspace(workspace);
  const reviewedResourceRoots = [];
  const collaborationPaths = [];
  for (const value of resourceReadRoots) {
    try {
      reviewedResourceRoots.push(await realpath(value));
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  for (const value of collaborationWorktreePaths(codingCollaboration)) {
    try {
      const reviewed = await realpath(value);
      collaborationPaths.push(reviewed);
      reviewedResourceRoots.push(reviewed);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  const protectedEntries = [".git", ".milksu"];
  const ensure = path => assertWorkspacePath(root, path);
  const resolveReadScope = async path => {
    for (const allowedRoot of [
      root,
      ...reviewedResourceRoots,
    ]) {
      try {
        return {
          root: allowedRoot,
          path: await assertWorkspacePath(allowedRoot, path),
        };
      } catch {
        // Try the next explicitly reviewed read root.
      }
    }
    throw new Error(
      `MilkSU workspace policy denied path outside the workspace and reviewed resources: ${path}`,
    );
  };
  const ensureRead = async path => (await resolveReadScope(path)).path;
  const ensureMutation = async path => {
    const requestedPath = resolve(path);
    const owner = await mutationOwnerRoot(
      requestedPath,
      [root, ...collaborationPaths],
    );
    const ownerSegments = owner
      ? relative(owner.root, owner.ownedPath).split(sep)
      : [];
    if (!owner || ownerSegments.includes("node_modules")) {
      throw new Error(
        `MilkSU workspace policy denied path outside the workspace and registered writer worktrees: ${path}`,
      );
    }
    // Resolve again against the chosen lexical owner. If a writer symlink
    // escapes to the main tree, do not retry that canonical target as a main
    // workspace mutation.
    const safePath = await assertWorkspaceMutationPath(
      owner.root,
      requestedPath,
      protectedEntries,
      false,
    );
    return safePath;
  };
  const definitions = [
    // Generic Coding tools deliberately use Pi's native filesystem and shell
    // behavior. MilkSU supplies the initial cwd and approval UI, but does not
    // layer a second workspace policy over Pi's absolute-path support.
    createReadToolDefinition(root),
    createBashToolDefinition(root, {
      exposeSessionEnvironment: false,
      spawnHook: context => ({
        ...context,
        env: fullAccessCommandEnvironment(context.env),
      }),
    }),
    wrapEditToolDefinition(createEditToolDefinition(root), { root }),
    createWriteToolDefinition(root),
    createGrepToolDefinition(root),
    createFindToolDefinition(root),
    createLsToolDefinition(root),
    createArchifyTool(
      root,
      reviewedResourceRoots,
      productAction,
    ),
    createImageGenTool(root, {
      ensureRead,
      ensureMutation,
    }),
  ];
  return definitions;
}

async function loadCodingSessionPolicy(workspace, codingPolicy = {}, sessionRole = "") {
  const root = await resolveReviewedWorkspace(workspace);
  const normalized = normalizeCodingPolicy(
    codingPolicy.executionMode,
    codingPolicy.approvalPolicy,
  );
  const mcpServers = Array.isArray(codingPolicy.mcpServers)
    ? [...new Set(codingPolicy.mcpServers.map(value => String(value).trim()).filter(Boolean))]
    : [];
  const projectMcpServers = Array.isArray(codingPolicy.projectMcpServers)
    ? [...new Set(
        codingPolicy.projectMcpServers
          .map(value => String(value).trim())
          .filter(Boolean),
      )]
    : mcpServers;
  const codingBrowser = codingPolicy.codingBrowser
    && typeof codingPolicy.codingBrowser === "object"
    && !Array.isArray(codingPolicy.codingBrowser)
    ? {
        sessionId: String(codingPolicy.codingBrowser.sessionId ?? ""),
        cdpEndpoint: String(codingPolicy.codingBrowser.cdpEndpoint ?? ""),
      }
    : undefined;
  const browserUse = codingPolicy.browserUse
    && typeof codingPolicy.browserUse === "object"
    && !Array.isArray(codingPolicy.browserUse)
    && /^browser_user-[A-Za-z0-9-]{8,128}$/u.test(
      String(codingPolicy.browserUse.sessionId ?? ""),
    )
    ? { sessionId: String(codingPolicy.browserUse.sessionId) }
    : undefined;
  const computerUse = codingPolicy.computerUse
    && typeof codingPolicy.computerUse === "object"
    && !Array.isArray(codingPolicy.computerUse)
    ? {
        sessionId: String(codingPolicy.computerUse.sessionId ?? ""),
        socketPath: String(codingPolicy.computerUse.socketPath ?? ""),
        targetBundleId: String(codingPolicy.computerUse.targetBundleId ?? ""),
        targetName: String(codingPolicy.computerUse.targetName ?? ""),
        targetPid: Number(codingPolicy.computerUse.targetPid ?? 0),
        targetWindowId: Number(codingPolicy.computerUse.targetWindowId ?? 0),
      }
    : undefined;
  const codingCollaboration = codingPolicy.codingCollaboration;
  const productAction = normalizeCodingProductAction(
    root,
    codingPolicy.productAction,
  );
  const imageGenConfigured = codingPolicy.imageGenConfigured === true;
  const imageDraw = codingPolicy.imageDraw === true;
  const actionTools = codingProductActionTools(
    productAction,
    normalized.activeTools,
  ).filter(tool => tool !== codingImageGenToolName || imageGenConfigured);
  const interactiveMcpAllowed = !productAction
    && normalized.executionMode === "go"
    && normalized.approvalPolicy !== "read-only";
  const projectMcpAvailable = interactiveMcpAllowed && mcpServers.length > 0;
  const browserAvailable = interactiveMcpAllowed
    && (Boolean(codingBrowser) || Boolean(browserUse) || projectMcpServers.length > 0);
  const computerUseAvailable = interactiveMcpAllowed;
  const computerUseSessionReady = computerUseAvailable && Boolean(computerUse);
  const subagentAvailable = !productAction
    && normalized.executionMode === "go"
    && normalized.approvalPolicy !== "read-only";
  const collaborationAvailable = subagentAvailable && Boolean(codingCollaboration);
  const automaticCapabilityApproval = ["workspace-auto", "full-auto"].includes(
    normalized.approvalPolicy,
  );
  const imageGenAvailable = !productAction
    && normalized.executionMode === "go"
    && normalized.approvalPolicy !== "read-only"
    && imageGenConfigured;
  const activeTools = [...new Set([
    ...actionTools,
    ...(projectMcpAvailable || browserAvailable || computerUseSessionReady ? ["mcp"] : []),
    ...(subagentAvailable ? [codingCollaborationToolName] : []),
  ])];
  const capabilities = normalized.capabilities.map(capability => (
    capability.id === "browser"
      ? {
          ...capability,
          status: browserAvailable
            ? automaticCapabilityApproval ? "allowed" : "approval-required"
            : "unavailable",
          detail: browserAvailable
            ? browserUse
              ? "Playwright MCP 官方扩展已为本轮 Browser Use 启用；用户仍需在 Chrome/Edge "
                + "连接页选择并批准准确标签页，模型不能跳过选择或改用其他浏览器能力。"
              : codingBrowser
              ? `MilkSU 隔离浏览器已为本任务启用`
                + `${projectMcpServers.length ? `，另有 ${projectMcpServers.length} 个项目 MCP` : ""}；`
                + (automaticCapabilityApproval
                    ? "当前权限档会自动执行内置浏览器调用；固定会话边界和硬阻断保持有效。"
                    : "当前请求批准档会确认调用，也可对本对话始终允许同类内置浏览器操作。")
              : `${mcpServers.length} 个 MCP 服务器已为本任务启用；`
                + (automaticCapabilityApproval
                    ? "当前权限档会自动执行只读调用；替我审批仍会确认修改和外部账户授权。"
                    : "当前请求批准档会逐次确认调用。")
            : normalized.executionMode !== "go" || normalized.approvalPolicy === "read-only"
              ? "当前 Plan 或只读策略不会加载内置浏览器。"
              : "内置浏览器会在本回合自动打开，不要让用户去设置里启用。",
        }
      : capability.id === "imagegen"
        ? {
            ...capability,
            status: imageGenAvailable
              ? (imageDraw ? "allowed" : "approval-required")
              : "unavailable",
            detail: imageGenAvailable
              ? imageDraw
                ? "画图页已经授权这一次生图。直接调用 milksu_imagegen，不要再向用户请求工具批准。对话模型不会用于生图。"
                : "ImageGen 凭据已隔离；每次请求都会展示模型、Endpoint、尺寸、质量、输出和费用后单独批准。对话模型不会用于生图。"
              : normalized.executionMode !== "go"
                  || normalized.approvalPolicy === "read-only"
                ? "当前 Plan 或只读策略不会加载付费 ImageGen。"
                : "需要在设置 → 模型中选择生图模型，并启用账户或个人 TokenFlux；对话模型不会用于生图。",
          }
      : capability.id === "computer-use"
        ? {
            ...capability,
            status: computerUseAvailable
              ? automaticCapabilityApproval ? "allowed" : "approval-required"
              : "unavailable",
            detail: computerUseAvailable
              ? computerUse
                ? `可见会话已锁定 ${computerUse.targetName} `
                  + `(${computerUse.targetBundleId})；操作只针对这一窗，`
                  + (automaticCapabilityApproval
                      ? "当前权限档会自动执行观察和操作。"
                      : "当前请求批准档会逐次确认观察和操作。")
                : "先列出可见窗口，认准后再锁定；拿不准时用 milksu_ask，不要先让用户挑窗。"
                  + "不能用 Shell、截图目录、SQLite、IPC 或私有协议绕过可见会话。"
              : computerUse
                ? "当前 Plan、只读或产品动作不会加载 Computer Use；切换到普通 Go 后可用。"
                : "当前 Plan、只读或产品动作不会加载 Computer Use。",
          }
        : capability.id === "collaboration"
          ? {
              ...capability,
              status: subagentAvailable
                ? automaticCapabilityApproval ? "allowed" : "approval-required"
                : "unavailable",
              detail: subagentAvailable
                ? "子 Agent 默认在主工作区运行，也可使用已准备的 writer worktree；"
                  + (automaticCapabilityApproval
                      ? "当前权限档会自动执行通过边界校验的委托。"
                      : "当前请求批准档会逐次展示角色和任务。")
                : "当前 Plan、只读或一键产品动作不会加载多 Agent；切换到普通 Go 后可用。",
            }
          : capability
  ));
  const result = {
    ctf: false,
    ...normalized,
    activeTools,
    capabilities,
    workspace: root,
    productAction,
    mcpServers,
    projectMcpServers,
    mcpConfigDigest: String(codingPolicy.mcpConfigDigest ?? "").trim(),
    codingBrowser,
    browserUse,
    computerUse,
    codingCollaboration,
    imageDraw,
    readOnlyResourceRoots: [...(codingPolicy.readOnlyResourceRoots || [])],
    customTools: await createCodingToolDefinitions(
      root,
      codingPolicy.readOnlyResourceRoots,
      productAction,
      codingCollaboration,
    ),
    maxToolEventOutputBytes: 60000,
  };
  if (isResearchSessionRole(sessionRole)) {
    result.activeTools = [...new Set([...result.activeTools, ...envToolNames])];
  }
  return result;
}

export async function loadSessionPolicy(
  workspace,
  sessionRole = "",
  codingPolicy = {},
) {
  return loadCodingSessionPolicy(workspace, codingPolicy, sessionRole);
}
