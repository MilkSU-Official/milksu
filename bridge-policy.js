import {
  createBashToolDefinition,
  createEditToolDefinition,
  createFindToolDefinition,
  createGrepToolDefinition,
  createLsToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  defineTool,
} from "@earendil-works/pi-coding-agent";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { constants } from "node:fs";
import {
  access,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  writeFile,
} from "node:fs/promises";
import { createConnection } from "node:net";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { Type } from "typebox";

const workspaceSchemaVersion = "ctf-workspace.milksu.dev/v1alpha1";
const toolBuilderRole = "tool-builder";
const strategistRole = "strategist";
const codingToolNames = ["read", "bash", "edit", "write", "grep", "find", "ls"];
const codingGoalToolNames = ["goal_complete", "goal_blocked"];
const codingReadOnlyToolNames = [
  "read",
  "grep",
  "find",
  "ls",
  "bg_status",
  "milksu_progress",
  "lsp_diagnostics",
  ...codingGoalToolNames,
];
const codingWorkspaceAutoToolNames = [
  "read",
  "bash",
  "edit",
  "write",
  "grep",
  "find",
  "ls",
  "bg_task",
  "bg_status",
  "milksu_progress",
  "lsp_diagnostics",
  ...codingGoalToolNames,
];
const codingArchitectureToolNames = [
  "read",
  "grep",
  "find",
  "ls",
  "write",
  "milksu_archify",
  "milksu_progress",
  ...codingGoalToolNames,
];
const codingProductReadOnlyToolNames = [
  "read",
  "grep",
  "find",
  "ls",
  "milksu_progress",
  "lsp_diagnostics",
  ...codingGoalToolNames,
];
const codingProductTestToolNames = [
  "read",
  "bash",
  "grep",
  "find",
  "ls",
  "milksu_progress",
  "lsp_diagnostics",
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
  "lsp_diagnostics",
  ...codingGoalToolNames,
];
// A Coding session must construct the full reviewed tool catalog up front.
// Pi's setActiveTools() can narrow or restore tools that already exist, but it
// cannot add definitions that were omitted when createAgentSession() ran.
export const codingSessionToolNames = [
  ...new Set([...codingWorkspaceAutoToolNames, "milksu_archify"]),
];
const ctfLocalToolNames = [
  ...codingToolNames,
  "milksu_progress",
  "ctf_capabilities",
  "ctf_decode",
  "ctf_triage",
  "ctf_inspect",
];
const ctfNetworkToolNames = ["ctf_http", "ctf_socket"];
const ctfToolNames = [...ctfLocalToolNames, ...ctfNetworkToolNames];
const coachToolNames = [
  "read",
  "edit",
  "write",
  "grep",
  "find",
  "ls",
  "milksu_progress",
  "ctf_capabilities",
  "ctf_decode",
  "ctf_triage",
  "ctf_inspect",
];
const strategistToolNames = ["read", "write", "grep", "find", "ls", "milksu_progress"];
const defaultExecution = {
  workspaceOnly: true,
  defaultCommandTimeoutSeconds: 120,
  maxCommandTimeoutSeconds: 300,
  maxToolEventOutputBytes: 60000,
};
const commandPath = [
  "/Library/Developer/CommandLineTools/usr/bin",
  "/usr/bin",
  "/bin",
  "/usr/sbin",
  "/sbin",
  "/opt/homebrew/bin",
  "/usr/local/bin",
].join(":");
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

function normalizeExecution(value) {
  const execution = value && typeof value === "object" ? value : {};
  const defaultTimeout = Math.min(
    Math.max(Number(execution.defaultCommandTimeoutSeconds) || defaultExecution.defaultCommandTimeoutSeconds, 1),
    300,
  );
  const maxTimeout = Math.min(
    Math.max(Number(execution.maxCommandTimeoutSeconds) || defaultExecution.maxCommandTimeoutSeconds, defaultTimeout),
    900,
  );
  return {
    workspaceOnly: true,
    defaultCommandTimeoutSeconds: defaultTimeout,
    maxCommandTimeoutSeconds: maxTimeout,
    maxToolEventOutputBytes: Math.min(
      Math.max(Number(execution.maxToolEventOutputBytes) || defaultExecution.maxToolEventOutputBytes, 4096),
      60000,
    ),
  };
}

function normalizeActiveTools(manifest) {
  const requested = manifest?.policy?.allowedTools;
  const fallback = manifest?.policy?.mode === "coach" ? coachToolNames : ctfToolNames;
  const values = Array.isArray(requested) && requested.length > 0 ? [...requested] : [...fallback];
  if (!values.includes("milksu_progress")) values.push("milksu_progress");
  const reviewOnly = manifest?.policy?.mode === strategistRole;
  if (!reviewOnly && !values.includes("ctf_capabilities")) values.push("ctf_capabilities");
  if (!reviewOnly && !values.includes("ctf_decode")) values.push("ctf_decode");
  const targets = Array.isArray(manifest?.source?.scope?.targets)
    ? manifest.source.scope.targets
    : [];
  if (
    ![toolBuilderRole, strategistRole].includes(manifest?.policy?.mode)
    && targets.some(target => String(target?.kind) === "origin")
    && !values.includes("ctf_http")
  ) {
    values.push("ctf_http");
  }
  if (
    ![toolBuilderRole, strategistRole].includes(manifest?.policy?.mode)
    && targets.some(target => String(target?.kind) === "socket")
    && !values.includes("ctf_socket")
  ) {
    values.push("ctf_socket");
  }
  const allowed = new Set(ctfToolNames);
  const normalized = [...new Set(values.map(value => String(value).trim()).filter(Boolean))];
  const unsupported = normalized.filter(value => !allowed.has(value));
  if (unsupported.length > 0) {
    throw new Error(`Unsupported CTF Agent tools: ${unsupported.join(", ")}`);
  }
  const activeTools = manifest?.policy?.mode === "coach"
    ? normalized.filter(value => value !== "bash")
    : normalized;
  if (activeTools.length === 0) {
    throw new Error("CTF Agent tool policy cannot be empty");
  }
  return activeTools;
}

function assertScopeActive(manifest) {
  const scope = manifest?.source?.scope;
  if (!scope || typeof scope !== "object") {
    throw new Error("CTF network tool denied: the challenge has no user-granted scope");
  }
  if (scope.revokedAt) {
    throw new Error("CTF network tool denied: the user-granted scope was revoked");
  }
  if (scope.expiresAt) {
    const expiresAt = Date.parse(String(scope.expiresAt));
    if (!Number.isFinite(expiresAt) || Date.now() >= expiresAt) {
      throw new Error("CTF network tool denied: the user-granted scope expired");
    }
  }
  return scope;
}

function authorizedOrigins(manifest) {
  const scope = assertScopeActive(manifest);
  const origins = new Set();
  for (const target of Array.isArray(scope.targets) ? scope.targets : []) {
    if (String(target?.kind) !== "origin") continue;
    try {
      const parsed = new URL(String(target.value));
      if (
        ["http:", "https:"].includes(parsed.protocol)
        && parsed.username === ""
        && parsed.password === ""
      ) {
        origins.add(parsed.origin);
      }
    } catch {
      // Invalid targets are never admitted as an implicit authorization.
    }
  }
  return origins;
}

function authorizedSockets(manifest) {
  const scope = assertScopeActive(manifest);
  return new Set(
    (Array.isArray(scope.targets) ? scope.targets : [])
      .filter(target => String(target?.kind) === "socket")
      .map(target => String(target.value || "").trim())
      .filter(Boolean),
  );
}

export function scopeAllowsNetwork(manifest) {
  // Managed Labs expose one exact loopback origin through ctf_http. Their
  // general-purpose shell remains networkless so a challenge cannot turn an
  // admitted lab identifier into ambient host, Docker, or internet access.
  if (String(manifest?.source?.kind) === "local-lab") return false;
  const targets = manifest?.source?.scope?.targets;
  if (!Array.isArray(targets)) return false;
  return targets.some(target => ["origin", "socket"].includes(String(target?.kind)));
}

function sandboxString(value) {
  return JSON.stringify(value);
}

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
    PATH: `${runtimeBin}:${commandPath}`,
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
  // Node's permission model automatically injects its own --permission flags
  // into child-process NODE_OPTIONS, even when spawn() receives a sanitized
  // environment. That makes npm scripts inherit the Sidecar's read grants
  // instead of the selected project. The wrapper removes only that inherited
  // Node layer; sandbox-exec still enforces network denial, workspace-only
  // writes, and protected .git/.milksu paths for the reviewed command.
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

function createSandboxedBashOperations(
  workspace,
  execution,
  allowNetwork,
  extraProtectedEntries = [],
  includeCTFProtectedEntries = true,
  extraReadableRoots = [],
) {
  return {
    exec: async (command, cwd, options) => {
      if (process.platform !== "darwin") {
        throw new Error("CTF bash containment is currently available only on macOS");
      }
      const canonicalWorkspace = await resolveReviewedWorkspace(workspace);
      const canonicalCwd = await assertWorkspacePath(canonicalWorkspace, cwd);
      const runtimeDirectory = commandRuntimeDirectory(canonicalWorkspace);
      const runtimeHome = join(runtimeDirectory, "home");
      const runtimeTemporary = join(runtimeDirectory, "tmp");
      const runtimeBin = join(runtimeDirectory, "runtime-bin");
      const timeout = Math.min(
        Math.max(Number(options.timeout) || execution.defaultCommandTimeoutSeconds, 1),
        execution.maxCommandTimeoutSeconds,
      );
      await mkdir(join(runtimeDirectory, "home"), { recursive: true, mode: 0o700 });
      await mkdir(join(runtimeDirectory, "tmp"), { recursive: true, mode: 0o700 });
      await ensureSandboxedCommandRuntime(runtimeDirectory);

      return await new Promise((resolvePromise, rejectPromise) => {
        const child = spawn(
          "/usr/bin/sandbox-exec",
          [
            "-p",
            sandboxProfile(
              canonicalWorkspace,
              allowNetwork,
              extraProtectedEntries,
              includeCTFProtectedEntries,
              [...extraReadableRoots, runtimeBin],
              [runtimeHome, runtimeTemporary],
            ),
            "/bin/bash",
            "--noprofile",
            "--norc",
            "-c",
            command,
          ],
          {
            cwd: canonicalCwd,
            detached: true,
            env: commandEnvironment(canonicalWorkspace, options.env, runtimeDirectory),
            stdio: ["ignore", "pipe", "pipe"],
          },
        );
        let settled = false;
        let timedOut = false;
        const finish = callback => {
          if (settled) return;
          settled = true;
          clearTimeout(timeoutHandle);
          options.signal?.removeEventListener("abort", onAbort);
          callback();
        };
        const onAbort = () => {
          killChildProcess(child);
        };
        const timeoutHandle = setTimeout(() => {
          timedOut = true;
          killChildProcess(child);
        }, timeout * 1000);

        options.signal?.addEventListener("abort", onAbort, { once: true });
        child.stdout?.on("data", options.onData);
        child.stderr?.on("data", options.onData);
        child.on("error", error => finish(() => rejectPromise(error)));
        child.on("close", exitCode => {
          finish(() => {
            if (options.signal?.aborted) {
              rejectPromise(new Error("aborted"));
              return;
            }
            if (timedOut) {
              rejectPromise(new Error(`timeout:${timeout}`));
              return;
            }
            resolvePromise({ exitCode });
          });
        });
      });
    },
  };
}

function fullAccessCommandEnvironment(source = {}) {
  const environment = {
    PATH: source.PATH || commandPath,
    HOME: source.MILKSU_USER_HOME || source.HOME || "/",
    TMPDIR: source.TMPDIR || "/tmp",
    LANG: source.LANG || "en_US.UTF-8",
    TERM: source.TERM || "dumb",
    SHELL: source.SHELL || "/bin/bash",
  };
  for (const name of ["LC_ALL", "SSL_CERT_DIR", "SSL_CERT_FILE"]) {
    if (source[name]) environment[name] = source[name];
  }
  if (source.MILKSU_USER_SSH_AUTH_SOCK) {
    environment.SSH_AUTH_SOCK = source.MILKSU_USER_SSH_AUTH_SOCK;
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

export async function prepareCodingBackgroundAuthorization(
  workspace,
  approvalPolicy,
  input,
  resourceReadRoots = [],
) {
  const root = await resolveReviewedWorkspace(workspace);
  const requested = typeof input?.cwd === "string" && input.cwd.trim()
    ? input.cwd.trim()
    : root;
  const candidate = isAbsolute(requested) ? requested : resolve(root, requested);
  const cwd = candidate === root ? root : await realpath(candidate);
  const fullAccess = approvalPolicy === "full-auto";
  if (!fullAccess) await assertWorkspacePath(root, cwd);

  const readableRoots = [];
  for (const value of resourceReadRoots) {
    try {
      readableRoots.push(await realpath(value));
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  const runtimeDirectory = commandRuntimeDirectory(root);
  await mkdir(join(runtimeDirectory, "home"), { recursive: true, mode: 0o700 });
  await mkdir(join(runtimeDirectory, "tmp"), { recursive: true, mode: 0o700 });
  await ensureSandboxedCommandRuntime(runtimeDirectory);

  input.cwd = cwd;
  return {
    workspace: root,
    cwd,
    mode: fullAccess ? "full-auto" : "workspace-auto",
    readableRoots,
    runtimeDirectory,
  };
}

export function buildCodingBackgroundLaunch(specification, authorization) {
  const workspace = resolve(authorization.workspace);
  const cwd = resolve(specification.cwd || authorization.cwd);
  if (cwd !== resolve(authorization.cwd)) {
    throw new Error("MilkSU denied a background process whose cwd changed after authorization");
  }
  if (
    authorization.mode !== "full-auto"
    && relative(workspace, cwd).split(sep).includes("..")
  ) {
    throw new Error("MilkSU denied a background process outside the selected project");
  }

  const explicitEnvironment = sanitizedBackgroundEnvironment(specification.env);
  const direct = specification.shell === false;
  const command = direct ? specification.argv?.[0] : "/bin/bash";
  const argumentsList = direct
    ? specification.argv.slice(1)
    : ["--noprofile", "--norc", "-c", specification.command];

  if (authorization.mode === "full-auto") {
    return {
      file: command,
      arguments: argumentsList,
      cwd,
      environment: {
        ...fullAccessCommandEnvironment(process.env),
        ...explicitEnvironment,
      },
    };
  }

  const runtimeDirectory = resolve(authorization.runtimeDirectory);
  const runtimeHome = join(runtimeDirectory, "home");
  const runtimeTemporary = join(runtimeDirectory, "tmp");
  const runtimeBin = join(runtimeDirectory, "runtime-bin");
  return {
    file: "/usr/bin/sandbox-exec",
    arguments: [
      "-p",
      sandboxProfile(
        workspace,
        true,
        [],
        false,
        [...authorization.readableRoots, runtimeBin],
        [runtimeHome, runtimeTemporary],
      ),
      command,
      ...argumentsList,
    ],
    cwd,
    environment: {
      ...commandEnvironment(workspace, process.env, runtimeDirectory),
      ...explicitEnvironment,
    },
  };
}

function createFullAccessBashOperations(execution) {
  return {
    exec: async (command, cwd, options = {}) => {
      const timeout = Math.min(
        Math.max(Number(options.timeout) || execution.defaultCommandTimeoutSeconds, 1),
        execution.maxCommandTimeoutSeconds,
      );
      return await new Promise((resolvePromise, rejectPromise) => {
        const child = spawn(
          "/bin/bash",
          ["--noprofile", "--norc", "-c", command],
          {
            cwd: resolve(cwd),
            detached: true,
            env: fullAccessCommandEnvironment({
              ...process.env,
              ...options.env,
            }),
            stdio: ["ignore", "pipe", "pipe"],
          },
        );
        let settled = false;
        let timedOut = false;
        const finish = callback => {
          if (settled) return;
          settled = true;
          clearTimeout(timeoutHandle);
          options.signal?.removeEventListener("abort", onAbort);
          callback();
        };
        const onAbort = () => {
          killChildProcess(child);
        };
        const timeoutHandle = setTimeout(() => {
          timedOut = true;
          killChildProcess(child);
        }, timeout * 1000);

        options.signal?.addEventListener("abort", onAbort, { once: true });
        child.stdout?.on("data", options.onData);
        child.stderr?.on("data", options.onData);
        child.on("error", error => finish(() => rejectPromise(error)));
        child.on("close", exitCode => {
          finish(() => {
            if (options.signal?.aborted) {
              rejectPromise(new Error("aborted"));
              return;
            }
            if (timedOut) {
              rejectPromise(new Error(`timeout:${timeout}`));
              return;
            }
            resolvePromise({ exitCode });
          });
        });
      });
    },
  };
}

function detectImageMimeType(path, data) {
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return "image/png";
  }
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return "image/jpeg";
  }
  if (data.length >= 6 && ["GIF87a", "GIF89a"].includes(data.subarray(0, 6).toString("ascii"))) {
    return "image/gif";
  }
  if (
    data.length >= 12
    && data.subarray(0, 4).toString("ascii") === "RIFF"
    && data.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  const extension = basename(path).toLowerCase();
  if (extension.endsWith(".png")) return "image/png";
  if (extension.endsWith(".jpg") || extension.endsWith(".jpeg")) return "image/jpeg";
  if (extension.endsWith(".gif")) return "image/gif";
  if (extension.endsWith(".webp")) return "image/webp";
  return undefined;
}

function detectCTFFileKind(path, data) {
  const image = detectImageMimeType(path, data);
  if (image) return image;
  if (data.length >= 4 && data.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) {
    return "application/x-elf";
  }
  if (data.length >= 2 && data.subarray(0, 2).toString("ascii") === "MZ") {
    return "application/x-dosexec";
  }
  if (data.length >= 4 && data.subarray(0, 4).equals(Buffer.from([0xcf, 0xfa, 0xed, 0xfe]))) {
    return "application/x-mach-binary";
  }
  if (data.length >= 4 && data.subarray(0, 4).equals(Buffer.from([0xfe, 0xed, 0xfa, 0xcf]))) {
    return "application/x-mach-binary";
  }
  if (data.length >= 4 && data.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) {
    return "application/zip";
  }
  if (data.length >= 2 && data[0] === 0x1f && data[1] === 0x8b) {
    return "application/gzip";
  }
  if (data.length >= 5 && data.subarray(0, 5).toString("ascii") === "%PDF-") {
    return "application/pdf";
  }
  const text = data.toString("utf8");
  if (!text.includes("\uFFFD")) return "text/plain";
  return "application/octet-stream";
}

function byteEntropy(data) {
  if (data.length === 0) return 0;
  const counts = new Uint32Array(256);
  for (const value of data) counts[value] += 1;
  let entropy = 0;
  for (const count of counts) {
    if (count === 0) continue;
    const probability = count / data.length;
    entropy -= probability * Math.log2(probability);
  }
  return Math.round(entropy * 1000) / 1000;
}

function printableRatio(data) {
  if (data.length === 0) return 0;
  let printable = 0;
  for (const value of data) {
    if (value === 0x09 || value === 0x0a || value === 0x0d || (value >= 0x20 && value <= 0x7e)) {
      printable += 1;
    }
  }
  return Math.round((printable / data.length) * 1000) / 1000;
}

function encodingHints(data) {
  if (data.length === 0 || data.length > 256 * 1024) return [];
  const value = data.toString("utf8").trim();
  if (!value || value.includes("\uFFFD")) return [];
  const compact = value.replace(/\s+/g, "");
  const hints = [];
  if (compact.length >= 8 && compact.length % 2 === 0 && /^[0-9a-f]+$/i.test(compact)) {
    hints.push("hex-like");
  }
  if (
    compact.length >= 8
    && compact.length % 4 === 0
    && /^[A-Za-z0-9+/]+={0,2}$/.test(compact)
  ) {
    hints.push("base64-like");
  }
  if (/^(?:[01]{8}\s*){2,}$/.test(value)) hints.push("binary-bytes-like");
  if (/^(?:[.\-/]{1,5}\s+){2,}[.\-/]{1,5}$/.test(value)) hints.push("morse-like");
  return hints;
}

function printableStrings(data, minimumLength, limit) {
  const values = [];
  let start = -1;
  for (let index = 0; index <= data.length; index += 1) {
    const value = data[index];
    const printable = index < data.length && value >= 0x20 && value <= 0x7e;
    if (printable && start < 0) start = index;
    if ((!printable || index === data.length) && start >= 0) {
      if (index - start >= minimumLength) {
        values.push({
          offset: start,
          value: data.subarray(start, index).toString("ascii").slice(0, 512),
        });
        if (values.length >= limit) break;
      }
      start = -1;
    }
  }
  return values;
}

function hexWindow(data, offset, length) {
  const end = Math.min(data.length, offset + length);
  const lines = [];
  for (let index = offset; index < end; index += 16) {
    const chunk = data.subarray(index, Math.min(index + 16, end));
    const hex = [...chunk].map(value => value.toString(16).padStart(2, "0")).join(" ");
    const ascii = [...chunk]
      .map(value => (value >= 0x20 && value <= 0x7e ? String.fromCharCode(value) : "."))
      .join("");
    lines.push(`${index.toString(16).padStart(8, "0")}  ${hex.padEnd(47)}  ${ascii}`);
  }
  return lines.join("\n");
}

function createCTFInspectTool(workspace, ensure) {
  return defineTool({
    name: "ctf_inspect",
    label: "Inspect CTF material",
    description: "Deterministically inspect one file inside the authorized CTF workspace. "
      + "Use summary for type/hash/entropy, strings for bounded printable strings, "
      + "or hex for a bounded byte window. It never executes the file.",
    parameters: Type.Object({
      path: Type.String({ description: "Workspace-relative or absolute path to one file." }),
      operation: Type.Optional(Type.Union([
        Type.Literal("summary"),
        Type.Literal("strings"),
        Type.Literal("hex"),
      ])),
      offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 16 * 1024 * 1024 })),
      length: Type.Optional(Type.Integer({ minimum: 1, maximum: 4096 })),
      minimumStringLength: Type.Optional(Type.Integer({ minimum: 4, maximum: 64 })),
    }),
    execute: async (_toolCallId, params) => {
      const requestedPath = isAbsolute(params.path) ? params.path : resolve(workspace, params.path);
      const safePath = await ensure(requestedPath);
      const metadata = await lstat(safePath);
      if (!metadata.isFile()) throw new Error("ctf_inspect accepts regular files only");
      if (metadata.size > 16 * 1024 * 1024) {
        throw new Error("ctf_inspect input exceeds the 16 MiB analysis limit");
      }
      const data = await readFile(safePath);
      const operation = params.operation || "summary";
      let result;
      if (operation === "strings") {
        const minimumLength = params.minimumStringLength || 4;
        const values = printableStrings(data, minimumLength, 200);
        result = {
          path: relative(workspace, safePath),
          operation,
          minimumLength,
          returned: values.length,
          truncated: values.length === 200,
          strings: values,
        };
      } else if (operation === "hex") {
        const offset = Math.min(params.offset || 0, data.length);
        const length = Math.min(params.length || 256, 4096);
        result = {
          path: relative(workspace, safePath),
          operation,
          offset,
          length: Math.min(length, Math.max(data.length - offset, 0)),
          hex: hexWindow(data, offset, length),
        };
      } else {
        result = {
          path: relative(workspace, safePath),
          operation: "summary",
          size: data.length,
          sha256: createHash("sha256").update(data).digest("hex"),
          detectedType: detectCTFFileKind(safePath, data.subarray(0, Math.min(data.length, 4096))),
          entropyBitsPerByte: byteEntropy(data),
          printableRatio: printableRatio(data),
          encodingHints: encodingHints(data),
          magicHex: data.subarray(0, Math.min(data.length, 32)).toString("hex"),
        };
      }
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        details: result,
      };
    },
  });
}

function createCTFTriageTool(workspace, ensure) {
  return defineTool({
    name: "ctf_triage",
    label: "Triage CTF materials",
    description: "Build a deterministic, bounded inventory of regular files inside an authorized "
      + "CTF workspace. It reports type, size, hash, entropy, printable ratio, and encoding hints "
      + "without executing any material. Use it before choosing category-specific tooling.",
    parameters: Type.Object({
      path: Type.Optional(Type.String({
        description: "Workspace-relative or absolute file/directory. Defaults to materials.",
      })),
      maxFiles: Type.Optional(Type.Integer({
        minimum: 1,
        maximum: 64,
        description: "Maximum number of file records to return. Defaults to 32.",
      })),
    }),
    execute: async (_toolCallId, params) => {
      const requested = params.path || "materials";
      const requestedPath = isAbsolute(requested) ? requested : resolve(workspace, requested);
      const safeStart = await ensure(requestedPath);
      const maxFiles = params.maxFiles || 32;
      const maxVisitedEntries = 4096;
      const maxFileBytes = 16 * 1024 * 1024;
      const maxTotalBytes = 32 * 1024 * 1024;
      const ignoredDirectories = new Set([".git", ".milksu", "node_modules", "evidence"]);
      const files = [];
      const skipped = [];
      let visitedEntries = 0;
      let analyzedBytes = 0;
      let truncated = false;

      const recordFile = async (absolutePath, metadata) => {
        if (files.length >= maxFiles) {
          truncated = true;
          return;
        }
        const displayPath = relative(workspace, absolutePath);
        if (metadata.size > maxFileBytes) {
          skipped.push({
            path: displayPath,
            reason: "file exceeds the 16 MiB per-file analysis limit",
            size: metadata.size,
          });
          return;
        }
        if (analyzedBytes + metadata.size > maxTotalBytes) {
          skipped.push({
            path: displayPath,
            reason: "cumulative 32 MiB analysis limit reached",
            size: metadata.size,
          });
          truncated = true;
          return;
        }
        const data = await readFile(absolutePath);
        analyzedBytes += data.length;
        files.push({
          path: displayPath,
          size: data.length,
          sha256: createHash("sha256").update(data).digest("hex"),
          detectedType: detectCTFFileKind(
            absolutePath,
            data.subarray(0, Math.min(data.length, 4096)),
          ),
          entropyBitsPerByte: byteEntropy(data),
          printableRatio: printableRatio(data),
          encodingHints: encodingHints(data),
        });
      };

      const visit = async absolutePath => {
        if (truncated || files.length >= maxFiles) {
          truncated = true;
          return;
        }
        if (visitedEntries >= maxVisitedEntries) {
          truncated = true;
          return;
        }
        visitedEntries += 1;
        const metadata = await lstat(absolutePath);
        if (metadata.isSymbolicLink()) {
          skipped.push({
            path: relative(workspace, absolutePath),
            reason: "symbolic links are not inspected",
          });
          return;
        }
        if (metadata.isFile()) {
          await recordFile(absolutePath, metadata);
          return;
        }
        if (!metadata.isDirectory()) {
          skipped.push({
            path: relative(workspace, absolutePath),
            reason: "not a regular file or directory",
          });
          return;
        }
        const entries = (await readdir(absolutePath, { withFileTypes: true }))
          .sort((left, right) => left.name.localeCompare(right.name, "en"));
        for (const entry of entries) {
          if (truncated || files.length >= maxFiles) {
            truncated = true;
            break;
          }
          if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
          await visit(join(absolutePath, entry.name));
        }
      };

      await visit(safeStart);
      const result = {
        path: relative(workspace, safeStart) || ".",
        returned: files.length,
        analyzedBytes,
        visitedEntries,
        truncated,
        files,
        skipped,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        details: result,
      };
    },
  });
}

const ctfCommandCatalog = {
  core: ["python3", "node", "bash", "file", "strings", "curl", "openssl"],
  web: ["curl", "openssl", "jq", "nmap", "ffuf", "gobuster", "sqlmap"],
  pwn: ["python3", "lldb", "gdb", "objdump", "otool", "nm", "readelf", "checksec", "nc", "socat"],
  reverse: ["file", "strings", "otool", "nm", "objdump", "lldb", "gdb", "r2", "radare2", "rz-bin"],
  crypto: ["python3", "openssl", "sage", "gp"],
  forensics: ["file", "strings", "tshark", "exiftool", "binwalk", "foremost", "zsteg", "steghide", "ffmpeg", "identify"],
  misc: ["python3", "node", "perl", "ruby", "zbarimg", "qrencode"],
};

async function findCommand(command) {
  for (const directory of commandPath.split(":")) {
    const candidate = join(directory, command);
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Continue through the fixed, policy-visible command path.
    }
  }
  return "";
}

function createCTFCapabilitiesTool() {
  return defineTool({
    name: "ctf_capabilities",
    label: "Check CTF tools",
    description: "Deterministically report which common CTF command-line tools are actually "
      + "available in MilkSU's sandbox-visible PATH. Use this before planning around a debugger, "
      + "disassembler, packet analyzer, steganography utility, or scanner.",
    parameters: Type.Object({
      category: Type.Optional(Type.Union([
        Type.Literal("all"),
        Type.Literal("core"),
        Type.Literal("web"),
        Type.Literal("pwn"),
        Type.Literal("reverse"),
        Type.Literal("crypto"),
        Type.Literal("forensics"),
        Type.Literal("misc"),
      ])),
    }),
    execute: async (_toolCallId, params) => {
      const category = params.category || "all";
      const categories = category === "all"
        ? Object.keys(ctfCommandCatalog)
        : [category];
      const names = [...new Set(categories.flatMap(name => ctfCommandCatalog[name] || []))];
      const available = {};
      const missing = [];
      for (const name of names) {
        const path = await findCommand(name);
        if (path) available[name] = path;
        else missing.push(name);
      }
      const result = {
        category,
        path: commandPath,
        available,
        missing,
        guidance: missing.length > 0
          ? "Use an installed equivalent, write a minimal workspace script, or create a TOOLING.md request for the Coding Agent."
          : "All checked commands are available.",
      };
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        details: result,
      };
    },
  });
}

function decodeBase32(value) {
  const compact = value.replace(/\s+/g, "").toUpperCase();
  if (!compact || !/^[A-Z2-7]+=*$/.test(compact)) {
    throw new Error("ctf_decode input is not canonical Base32");
  }
  const unpadded = compact.replace(/=+$/, "");
  const remainder = unpadded.length % 8;
  const expectedPadding = new Map([[0, 0], [2, 6], [4, 4], [5, 3], [7, 1]]);
  const padding = compact.length - unpadded.length;
  if (!expectedPadding.has(remainder) || (padding > 0 && (
    compact.length % 8 !== 0 || padding !== expectedPadding.get(remainder)
  ))) {
    throw new Error("ctf_decode Base32 input has an invalid length");
  }
  let accumulator = 0;
  let bits = 0;
  const bytes = [];
  for (const character of unpadded) {
    const code = character.charCodeAt(0);
    const value5 = code >= 65 && code <= 90 ? code - 65 : code - 24;
    accumulator = (accumulator << 5) | value5;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((accumulator >>> bits) & 0xff);
      accumulator &= (1 << bits) - 1;
    }
  }
  if (bits > 0 && accumulator !== 0) {
    throw new Error("ctf_decode Base32 input has non-zero trailing padding bits");
  }
  return Buffer.from(bytes);
}

function decodeCTFValue(input, encoding) {
  switch (encoding) {
  case "hex": {
    const compact = input.replace(/\s+/g, "").replace(/^0x/i, "");
    if (!compact || compact.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(compact)) {
      throw new Error("ctf_decode hex input must contain complete hexadecimal bytes");
    }
    return Buffer.from(compact, "hex");
  }
  case "base64": {
    const compact = input.replace(/\s+/g, "");
    if (
      !compact
      || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(compact)
    ) {
      throw new Error("ctf_decode input is not canonical Base64");
    }
    return Buffer.from(compact, "base64");
  }
  case "base32":
    return decodeBase32(input);
  case "url":
    if (!/%[0-9a-f]{2}/i.test(input)) {
      throw new Error("ctf_decode URL input has no percent-encoded bytes");
    }
    try {
      return Buffer.from(decodeURIComponent(input), "utf8");
    } catch {
      throw new Error("ctf_decode URL input contains an invalid percent escape");
    }
  case "rot13":
    return Buffer.from(input.replace(/[A-Za-z]/g, character => {
      const base = character <= "Z" ? 65 : 97;
      return String.fromCharCode(base + ((character.charCodeAt(0) - base + 13) % 26));
    }), "utf8");
  case "binary-bytes": {
    const groups = input.trim().split(/\s+/);
    if (groups.length === 0 || groups.some(group => !/^[01]{8}$/.test(group))) {
      throw new Error("ctf_decode binary input must be whitespace-separated 8-bit bytes");
    }
    return Buffer.from(groups.map(group => Number.parseInt(group, 2)));
  }
  default:
    throw new Error(`ctf_decode does not support ${encoding}`);
  }
}

function createCTFDecodeTool() {
  return defineTool({
    name: "ctf_decode",
    label: "Decode one CTF transform",
    description: "Apply one explicit, deterministic decoding transform. Choose the encoding from "
      + "material evidence; this tool does not guess chains or claim that decoded text is a flag. "
      + "Call again for another evidenced layer and record each transform in notes.md.",
    parameters: Type.Object({
      input: Type.String({ maxLength: 262144 }),
      encoding: Type.Union([
        Type.Literal("hex"),
        Type.Literal("base64"),
        Type.Literal("base32"),
        Type.Literal("url"),
        Type.Literal("rot13"),
        Type.Literal("binary-bytes"),
      ]),
    }),
    execute: async (_toolCallId, params) => {
      const decoded = decodeCTFValue(params.input, params.encoding);
      if (decoded.length > 262144) {
        throw new Error("ctf_decode output exceeds 256 KiB");
      }
      const result = {
        encoding: params.encoding,
        decodedBytes: decoded.length,
        sha256: createHash("sha256").update(decoded).digest("hex"),
        printableRatio: printableRatio(decoded),
        ...boundedBody(decoded),
      };
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        details: result,
      };
    },
  });
}

const blockedHTTPHeaders = new Set([
  "connection",
  "content-length",
  "host",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "transfer-encoding",
  "upgrade",
]);

function normalizeHTTPHeaders(value) {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("ctf_http headers must be an object");
  }
  const entries = Object.entries(value);
  if (entries.length > 32) throw new Error("ctf_http accepts at most 32 request headers");
  const headers = {};
  for (const [rawName, rawValue] of entries) {
    const name = String(rawName).trim();
    const lower = name.toLowerCase();
    const headerValue = String(rawValue);
    if (
      !/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name)
      || blockedHTTPHeaders.has(lower)
      || /[\r\n]/.test(headerValue)
      || headerValue.length > 8192
    ) {
      throw new Error(`ctf_http denied unsafe request header: ${name || "(empty)"}`);
    }
    headers[name] = headerValue;
  }
  return headers;
}

async function readBoundedResponse(response, maxBytes) {
  if (!response.body) return { data: Buffer.alloc(0), truncated: false };
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  let truncated = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const remaining = maxBytes - total;
      if (remaining <= 0) {
        truncated = true;
        await reader.cancel();
        break;
      }
      const chunk = Buffer.from(value);
      if (chunk.length > remaining) {
        chunks.push(chunk.subarray(0, remaining));
        total += remaining;
        truncated = true;
        await reader.cancel();
        break;
      }
      chunks.push(chunk);
      total += chunk.length;
    }
  } finally {
    reader.releaseLock();
  }
  return { data: Buffer.concat(chunks, total), truncated };
}

function boundedBody(data, contentType = "") {
  const text = data.toString("utf8");
  const textualType = /(?:^text\/|json|xml|javascript|x-www-form-urlencoded)/i.test(contentType);
  const replacementCount = [...text].filter(character => character === "\uFFFD").length;
  const likelyText = textualType || (replacementCount === 0 && printableRatio(data) >= 0.75);
  return likelyText
    ? { bodyEncoding: "utf8", body: text }
    : { bodyEncoding: "base64", body: data.toString("base64") };
}

function createCTFHTTPTool(manifest) {
  return defineTool({
    name: "ctf_http",
    label: "Request authorized CTF origin",
    description: "Send one bounded HTTP request only to an exact origin in challenge.json. "
      + "Ambient browser cookies and model-provider credentials are never attached. Redirects "
      + "are returned but not followed; inspect Location and call again only if it remains in scope.",
    parameters: Type.Object({
      url: Type.String({ maxLength: 4096 }),
      method: Type.Optional(Type.Union([
        Type.Literal("GET"),
        Type.Literal("HEAD"),
        Type.Literal("POST"),
        Type.Literal("PUT"),
        Type.Literal("PATCH"),
        Type.Literal("DELETE"),
        Type.Literal("OPTIONS"),
      ])),
      headers: Type.Optional(Type.Record(
        Type.String({ maxLength: 128 }),
        Type.String({ maxLength: 8192 }),
      )),
      body: Type.Optional(Type.String({ maxLength: 262144 })),
      timeoutSeconds: Type.Optional(Type.Integer({ minimum: 1, maximum: 30 })),
      maxResponseBytes: Type.Optional(Type.Integer({ minimum: 1024, maximum: 1048576 })),
    }),
    execute: async (_toolCallId, params) => {
      const origins = authorizedOrigins(manifest);
      let parsed;
      try {
        parsed = new URL(params.url);
      } catch {
        throw new Error("ctf_http requires an absolute http(s) URL");
      }
      if (
        !["http:", "https:"].includes(parsed.protocol)
        || parsed.username !== ""
        || parsed.password !== ""
        || !origins.has(parsed.origin)
      ) {
        throw new Error(`ctf_http denied URL outside the exact authorized origins: ${parsed.origin}`);
      }
      const method = params.method || "GET";
      if (["GET", "HEAD"].includes(method) && params.body !== undefined) {
        throw new Error(`${method} requests cannot include a body`);
      }
      const headers = normalizeHTTPHeaders(params.headers);
      const body = params.body === undefined ? undefined : params.body;
      const timeoutSeconds = params.timeoutSeconds || 15;
      const maxResponseBytes = params.maxResponseBytes || 262144;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutSeconds * 1000);
      try {
        const response = await fetch(parsed, {
          method,
          headers,
          body,
          redirect: "manual",
          signal: controller.signal,
        });
        const bounded = await readBoundedResponse(response, maxResponseBytes);
        const responseHeaders = {};
        for (const [name, value] of response.headers.entries()) responseHeaders[name] = value;
        const result = {
          requestedUrl: parsed.toString(),
          responseUrl: response.url,
          method,
          status: response.status,
          statusText: response.statusText,
          redirected: response.status >= 300 && response.status < 400,
          headers: responseHeaders,
          bytesReturned: bounded.data.length,
          truncated: bounded.truncated,
          ...boundedBody(bounded.data, response.headers.get("content-type") || ""),
        };
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          details: result,
        };
      } catch (error) {
        if (controller.signal.aborted) {
          throw new Error(`ctf_http timed out after ${timeoutSeconds}s`);
        }
        throw error;
      } finally {
        clearTimeout(timeout);
      }
    },
  });
}

function decodeSocketPayload(value, encoding) {
  const input = value || "";
  switch (encoding) {
  case "hex":
    if (input.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(input)) {
      throw new Error("ctf_socket hex payload must contain complete hexadecimal bytes");
    }
    return Buffer.from(input, "hex");
  case "base64":
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input)) {
      throw new Error("ctf_socket payload is not canonical base64");
    }
    return Buffer.from(input, "base64");
  default:
    return Buffer.from(input, "utf8");
  }
}

function parseSocketTarget(target) {
  let parsed;
  try {
    parsed = new URL(`tcp://${target}`);
  } catch {
    throw new Error("ctf_socket target must be an exact authorized host:port");
  }
  const port = Number(parsed.port);
  if (!parsed.hostname || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("ctf_socket target must include a valid TCP port");
  }
  const host = parsed.hostname.startsWith("[") && parsed.hostname.endsWith("]")
    ? parsed.hostname.slice(1, -1)
    : parsed.hostname;
  return { host, port };
}

function runSocketRequest(target, payload, timeoutSeconds, maxResponseBytes) {
  const address = parseSocketTarget(target);
  return new Promise((resolvePromise, rejectPromise) => {
    const socket = createConnection(address);
    const chunks = [];
    let total = 0;
    let settled = false;
    let truncated = false;
    let idleTimeout = false;
    const finish = (error = undefined) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) {
        rejectPromise(error);
        return;
      }
      resolvePromise({
        data: Buffer.concat(chunks, total),
        truncated,
        idleTimeout,
      });
    };
    socket.setTimeout(timeoutSeconds * 1000);
    socket.on("connect", () => socket.end(payload));
    socket.on("data", value => {
      const chunk = Buffer.from(value);
      const remaining = maxResponseBytes - total;
      if (remaining <= 0) {
        truncated = true;
        finish();
        return;
      }
      if (chunk.length > remaining) {
        chunks.push(chunk.subarray(0, remaining));
        total += remaining;
        truncated = true;
        finish();
        return;
      }
      chunks.push(chunk);
      total += chunk.length;
    });
    socket.on("end", () => finish());
    socket.on("close", () => finish());
    socket.on("timeout", () => {
      if (total === 0) {
        finish(new Error(`ctf_socket timed out after ${timeoutSeconds}s without a response`));
        return;
      }
      idleTimeout = true;
      finish();
    });
    socket.on("error", error => finish(error));
  });
}

function createCTFSocketTool(manifest) {
  return defineTool({
    name: "ctf_socket",
    label: "Talk to authorized CTF socket",
    description: "Open one bounded TCP connection only to an exact host:port in challenge.json, "
      + "send one payload, and return a bounded response. Use a workspace script for multi-step "
      + "protocols after recording the protocol evidence.",
    parameters: Type.Object({
      target: Type.String({ maxLength: 512 }),
      payload: Type.Optional(Type.String({ maxLength: 262144 })),
      payloadEncoding: Type.Optional(Type.Union([
        Type.Literal("utf8"),
        Type.Literal("hex"),
        Type.Literal("base64"),
      ])),
      timeoutSeconds: Type.Optional(Type.Integer({ minimum: 1, maximum: 30 })),
      maxResponseBytes: Type.Optional(Type.Integer({ minimum: 1024, maximum: 262144 })),
    }),
    execute: async (_toolCallId, params) => {
      const sockets = authorizedSockets(manifest);
      const target = String(params.target || "").trim();
      if (!sockets.has(target)) {
        throw new Error(`ctf_socket denied target outside the exact authorized sockets: ${target}`);
      }
      const payload = decodeSocketPayload(params.payload, params.payloadEncoding || "utf8");
      if (payload.length > 262144) throw new Error("ctf_socket payload exceeds 256 KiB");
      const response = await runSocketRequest(
        target,
        payload,
        params.timeoutSeconds || 10,
        params.maxResponseBytes || 65536,
      );
      const result = {
        target,
        payloadBytes: payload.length,
        bytesReturned: response.data.length,
        truncated: response.truncated,
        idleTimeout: response.idleTimeout,
        ...boundedBody(response.data),
      };
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        details: result,
      };
    },
  });
}

function globPatternToRegex(pattern) {
  const source = String(pattern).replaceAll("\\", "/");
  let expression = "^";
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === "*" && source[index + 1] === "*") {
      index += 1;
      if (source[index + 1] === "/") {
        index += 1;
        expression += "(?:.*/)?";
      } else {
        expression += ".*";
      }
    } else if (character === "*") {
      expression += "[^/]*";
    } else if (character === "?") {
      expression += "[^/]";
    } else {
      expression += character.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
    }
  }
  return new RegExp(`${expression}$`);
}

async function findWorkspaceFiles(workspace, start, pattern, limit) {
  const expression = globPatternToRegex(pattern);
  const matches = [];
  async function visit(directory, prefix = "") {
    if (matches.length >= limit) return;
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (matches.length >= limit) return;
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolutePath = join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        await visit(absolutePath, relativePath);
        continue;
      }
      const candidate = pattern.includes("/") ? relativePath : entry.name;
      if (expression.test(candidate)) matches.push(absolutePath);
    }
  }
  await assertWorkspacePath(workspace, start);
  await visit(start);
  return matches;
}

export function normalizeCodingPolicy(
  executionMode = "go",
  approvalPolicy = "workspace-auto",
) {
  const normalizedExecutionMode = executionMode === "go" ? "go" : "plan";
  const normalizedApprovalPolicy = [
    "read-only",
    "ask",
    "workspace-auto",
    "full-auto",
  ].includes(approvalPolicy)
    ? approvalPolicy
    : "read-only";
  const effectfulToolsAvailable = normalizedExecutionMode === "go"
    && ["ask", "workspace-auto", "full-auto"].includes(normalizedApprovalPolicy);
  const workspaceWritesAllowed = normalizedExecutionMode === "go"
    && ["workspace-auto", "full-auto"].includes(normalizedApprovalPolicy);
  const fullAccess = normalizedExecutionMode === "go"
    && normalizedApprovalPolicy === "full-auto";
  const approvalChannelAvailable = normalizedExecutionMode === "go"
    && normalizedApprovalPolicy === "ask";
  const activeTools = effectfulToolsAvailable
    ? codingWorkspaceAutoToolNames
    : codingReadOnlyToolNames;

  return {
    executionMode: normalizedExecutionMode,
    approvalPolicy: normalizedApprovalPolicy,
    approvalChannelAvailable,
    activeTools: [...activeTools],
    capabilities: [
      {
        id: "workspace-read",
        label: "工作区读取",
        status: "allowed",
        detail: fullAccess
          ? "文件工具读取项目；终端可访问当前系统用户可读的路径。"
          : "文件与终端读取限制在当前项目和系统开发工具。",
      },
      {
        id: "workspace-write",
        label: "工作区写入",
        status: workspaceWritesAllowed
          ? "allowed"
          : normalizedApprovalPolicy === "ask" && normalizedExecutionMode === "go"
            ? "approval-required"
            : "blocked",
        detail: fullAccess
          ? "终端具有当前系统用户权限；文件工具仍以项目为默认边界。"
          : workspaceWritesAllowed
            ? "文件与命令写入限制在项目内；允许正常 Git 操作，文件工具保护 .milksu。"
          : normalizedApprovalPolicy === "ask" && normalizedExecutionMode === "go"
            ? "每次 edit / write 前暂停并在桌面展示参数；只有本次明确批准后执行。"
            : "Plan 或 Read-only 策略禁止 edit / write。",
      },
      {
        id: "command",
        label: "命令执行",
        status: workspaceWritesAllowed
          ? "allowed"
          : approvalChannelAvailable
            ? "approval-required"
            : "blocked",
        detail: fullAccess
          ? "命令自动执行，不受项目沙箱限制；模型 Provider Key 不传给子进程。"
          : workspaceWritesAllowed
            ? "项目沙箱内可运行开发命令和后台工具，支持网络。"
          : approvalChannelAvailable
            ? "每次 bash 调用前展示完整命令并等待批准；仍受项目沙箱约束。"
            : "Plan 与 Read-only 不提供 bash。",
      },
      {
        id: "network",
        label: "网络",
        status: workspaceWritesAllowed
          ? "allowed"
          : approvalChannelAvailable
            ? "approval-required"
            : "blocked",
        detail: workspaceWritesAllowed
          ? "允许开发命令访问网络。"
          : approvalChannelAvailable
            ? "网络只能通过已展示并单次批准的命令使用。"
            : "当前模式禁止网络命令。",
      },
      {
        id: "credentials",
        label: "凭据",
        status: fullAccess ? "allowed" : "blocked",
        detail: fullAccess
          ? "终端可使用当前系统用户的凭据；模型 Provider Key 仍不进入子进程。"
          : "Provider Key 不进入模型上下文，项目自动也不能读取用户凭据目录。",
      },
      {
        id: "browser",
        label: "浏览器 / MCP",
        status: "unavailable",
        detail: "尚未接入 Coding Agent；未来接入仍需逐次显式批准。",
      },
      {
        id: "computer-use",
        label: "Computer Use",
        status: "unavailable",
        detail: "尚未接入 Coding Agent；不会由 Workspace Auto 隐式启用。",
      },
    ],
  };
}

const codingArchitectureHeader = "[MilkSU product action: Generate architecture diagram]";
const codingProductActionHeaders = new Map([
  ["[MilkSU product action: Understand project]", "understand"],
  ["[MilkSU product action: Run tests]", "test"],
  ["[MilkSU product action: Review changes]", "review"],
  ["[MilkSU product action: Fix failure]", "fix"],
  ["[MilkSU product action: Summarize work]", "summary"],
]);

export function parseCodingProductAction(prompt) {
  const value = String(prompt || "");
  if (value.startsWith(codingArchitectureHeader)) {
    const specPath = /^Product spec path: (.+)$/m.exec(value)?.[1]?.trim();
    const htmlPath = /^Product HTML path: (.+)$/m.exec(value)?.[1]?.trim();
    if (!specPath || !htmlPath) return undefined;
    return {
      kind: "architecture",
      specPath,
      htmlPath,
    };
  }
  for (const [header, kind] of codingProductActionHeaders) {
    if (value.startsWith(header)) return { kind };
  }
  return undefined;
}

function normalizedCodingProductAction(workspace, value) {
  if (!value || typeof value !== "object") return undefined;
  if (["understand", "test", "review", "fix", "summary"].includes(value.kind)) {
    return { kind: value.kind };
  }
  if (value.kind !== "architecture") return undefined;
  const normalizeOutput = (path, extension) => {
    const candidate = String(path || "").trim().replaceAll("\\", "/");
    const allowedPrefix = "docs/architecture/generated/";
    if (
      !candidate.startsWith(allowedPrefix)
      || candidate.includes("../")
      || candidate.startsWith("/")
      || !candidate.endsWith(extension)
    ) {
      throw new Error(`MilkSU rejected unsafe architecture output path: ${candidate || "(empty)"}`);
    }
    return relative(workspace, resolve(workspace, candidate)).replaceAll("\\", "/");
  };
  return {
    kind: "architecture",
    specPath: normalizeOutput(value.specPath, ".architecture.json"),
    htmlPath: normalizeOutput(value.htmlPath, ".html"),
  };
}

function codingProductActionTools(action, fallback) {
  if (action?.kind === "architecture") return [...codingArchitectureToolNames];
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
      if (productAction?.kind === "architecture") {
        const inputRelative = relative(root, input).replaceAll("\\", "/");
        const outputRelative = output
          ? relative(root, output).replaceAll("\\", "/")
          : "";
        if (
          inputRelative !== productAction.specPath
          || (
            params.action === "deliver"
            && outputRelative !== productAction.htmlPath
          )
        ) {
          throw new Error("MilkSU architecture action denied an unexpected input or output path");
        }
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

async function createCodingToolDefinitions(
  workspace,
  resourceReadRoots = [],
  approvalPolicy = "workspace-auto",
  productAction = undefined,
) {
  const root = await resolveReviewedWorkspace(workspace);
  const reviewedResourceRoots = [];
  for (const value of resourceReadRoots) {
    try {
      reviewedResourceRoots.push(await realpath(value));
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  const protectedEntries = [".git", ".milksu"];
  const ensure = path => assertWorkspacePath(root, path);
  const resolveReadScope = async path => {
    for (const allowedRoot of [root, ...reviewedResourceRoots]) {
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
  const ensureMutation = async (path, allowArchitectureParent = false) => {
    const safePath = await assertWorkspaceMutationPath(
      root,
      path,
      protectedEntries,
      false,
    );
    const relativePath = relative(root, safePath).replaceAll("\\", "/");
    if (productAction?.kind === "architecture") {
      const architecturePathAllowed = relativePath === productAction.specPath
        || (
          allowArchitectureParent
          && (
            relativePath === ""
            || productAction.specPath.startsWith(`${relativePath}/`)
          )
        );
      if (!architecturePathAllowed) {
        throw new Error(
          `MilkSU architecture action only allows writing ${productAction.specPath}`,
        );
      }
    }
    return safePath;
  };
  const readOperations = {
    access: async path => access(await ensureRead(path), constants.R_OK),
    readFile: async path => readFile(await ensureRead(path)),
    detectImageMimeType: async path => {
      const safePath = await ensureRead(path);
      const file = await open(safePath, "r");
      try {
        const data = Buffer.alloc(12);
        const { bytesRead } = await file.read(data, 0, data.length, 0);
        return detectImageMimeType(safePath, data.subarray(0, bytesRead));
      } finally {
        await file.close();
      }
    },
  };
  const fullAccess = approvalPolicy === "full-auto";
  const bashOperations = fullAccess
    ? createFullAccessBashOperations(defaultExecution)
    : createSandboxedBashOperations(
        root,
        defaultExecution,
        true,
        [],
        false,
        reviewedResourceRoots,
      );
  const definitions = [
    createReadToolDefinition(root, { operations: readOperations }),
    createBashToolDefinition(root, {
      operations: bashOperations,
      // MilkSU exposes session/model context through the desktop environment
      // panel. Child commands do not need Pi's ambient PI_* variables.
      exposeSessionEnvironment: false,
    }),
    createEditToolDefinition(root, {
      operations: {
        access: async path => access(await ensure(path), constants.R_OK | constants.W_OK),
        readFile: async path => readFile(await ensure(path)),
        writeFile: async (path, content) => writeFile(
          await ensureMutation(path),
          content,
          { encoding: "utf8", mode: 0o600 },
        ),
      },
    }),
    createWriteToolDefinition(root, {
      operations: {
        mkdir: async path => mkdir(
          await ensureMutation(path, true),
          { recursive: true, mode: 0o700 },
        ),
        writeFile: async (path, content) => writeFile(
          await ensureMutation(path),
          content,
          { encoding: "utf8", mode: 0o600 },
        ),
      },
    }),
    createGrepToolDefinition(root, {
      operations: {
        isDirectory: async path => (await lstat(await ensureRead(path))).isDirectory(),
        readFile: async path => readFile(await ensureRead(path), "utf8"),
      },
    }),
    createFindToolDefinition(root, {
      operations: {
        exists: async path => {
          try {
            await lstat(await ensureRead(path));
            return true;
          } catch (error) {
            if (error?.code === "ENOENT") return false;
            throw error;
          }
        },
        glob: async (pattern, path, options) => {
          const scope = await resolveReadScope(path);
          return findWorkspaceFiles(
            scope.root,
            scope.path,
            pattern,
            options.limit,
          );
        },
      },
    }),
    createLsToolDefinition(root, {
      operations: {
        exists: async path => {
          try {
            await lstat(await ensureRead(path));
            return true;
          } catch (error) {
            if (error?.code === "ENOENT") return false;
            throw error;
          }
        },
        stat: async path => lstat(await ensureRead(path)),
        readdir: async path => readdir(await ensureRead(path)),
      },
    }),
    createArchifyTool(root, reviewedResourceRoots, productAction),
  ];
  const bash = definitions.find(tool => tool.name === "bash");
  bash.description += fullAccess
    ? " Full Access runs commands automatically with the current local user authority. "
      + "Model-provider secrets are removed from child-process environments."
    : " Project Auto runs development commands with network access while macOS sandboxing keeps "
      + "file writes inside the selected project and blocks local credential directories.";
  return definitions;
}

export async function createCTFToolDefinitions(
  workspace,
  manifest,
  execution,
  sessionRole = "",
) {
  const root = await resolveReviewedWorkspace(workspace);
  const toolBuilder = sessionRole === toolBuilderRole;
  const strategist = sessionRole === strategistRole;
  const roleProtectedEntries = toolBuilder
    ? ["candidate-flags.txt"]
    : strategist
      ? [
          "candidate-flags.txt",
          "notes.md",
          "work/tool-requests",
          "work/tools",
        ]
      : [];
  const ensure = path => assertWorkspacePath(root, path);
  const ensureMutation = async (path, allowStrategistReviewDirectory = false) => {
    const safePath = await assertWorkspaceMutationPath(
      root,
      path,
      roleProtectedEntries,
    );
    const relativePath = relative(root, safePath);
    const strategistPathAllowed = relativePath === join("work", "strategy-review.md")
      || (
        allowStrategistReviewDirectory
        && (relativePath === "" || relativePath === "work")
      );
    if (strategist && !strategistPathAllowed) {
      throw new Error(
        "CTF strategist policy denied mutation outside work/strategy-review.md",
      );
    }
    return safePath;
  };
  const readOperations = {
    access: async path => access(await ensure(path), constants.R_OK),
    readFile: async path => readFile(await ensure(path)),
    detectImageMimeType: async path => {
      const safePath = await ensure(path);
      const file = await open(safePath, "r");
      try {
        const data = Buffer.alloc(12);
        const { bytesRead } = await file.read(data, 0, data.length, 0);
        return detectImageMimeType(safePath, data.subarray(0, bytesRead));
      } finally {
        await file.close();
      }
    },
  };
  const editOperations = {
    access: async path => access(await ensure(path), constants.R_OK | constants.W_OK),
    readFile: async path => readFile(await ensure(path)),
    writeFile: async (path, content) => writeFile(
      await ensureMutation(path),
      content,
      { encoding: "utf8", mode: 0o600 },
    ),
  };
  const writeOperations = {
    mkdir: async path => mkdir(
      await ensureMutation(path, true),
      { recursive: true, mode: 0o700 },
    ),
    writeFile: async (path, content) => writeFile(
      await ensureMutation(path),
      content,
      { encoding: "utf8", mode: 0o600 },
    ),
  };
  const definitions = [
    createReadToolDefinition(root, { operations: readOperations }),
    createEditToolDefinition(root, { operations: editOperations }),
    createWriteToolDefinition(root, { operations: writeOperations }),
    createGrepToolDefinition(root, {
      operations: {
        isDirectory: async path => (await lstat(await ensure(path))).isDirectory(),
        readFile: async path => readFile(await ensure(path), "utf8"),
      },
    }),
    createFindToolDefinition(root, {
      operations: {
        exists: async path => {
          try {
            await lstat(await ensure(path));
            return true;
          } catch (error) {
            if (error?.code === "ENOENT") return false;
            throw error;
          }
        },
        glob: async (pattern, path, options) => (
          findWorkspaceFiles(root, await ensure(path), pattern, options.limit)
        ),
      },
    }),
    createLsToolDefinition(root, {
      operations: {
        exists: async path => {
          try {
            await lstat(await ensure(path));
            return true;
          } catch (error) {
            if (error?.code === "ENOENT") return false;
            throw error;
          }
        },
        stat: async path => lstat(await ensure(path)),
        readdir: async path => readdir(await ensure(path)),
      },
    }),
    createCTFCapabilitiesTool(),
    createCTFDecodeTool(),
    createCTFTriageTool(root, ensure),
    createCTFInspectTool(root, ensure),
    createCTFHTTPTool(manifest),
    createCTFSocketTool(manifest),
  ];
  if (!["coach", strategistRole].includes(manifest?.policy?.mode)) {
    const bash = createBashToolDefinition(root, {
      operations: createSandboxedBashOperations(
        root,
        execution,
        !toolBuilder && !strategist && scopeAllowsNetwork(manifest),
        roleProtectedEntries,
      ),
      exposeSessionEnvironment: false,
    });
    bash.description += ` MilkSU enforces a ${execution.defaultCommandTimeoutSeconds}s default timeout, `
      + `${execution.maxCommandTimeoutSeconds}s maximum, workspace-only writes, and a macOS sandbox.`;
    definitions.push(bash);
  }
  return definitions;
}

async function loadCodingSessionPolicy(workspace, codingPolicy = {}) {
  const root = await resolveReviewedWorkspace(workspace);
  const normalized = normalizeCodingPolicy(
    codingPolicy.executionMode,
    codingPolicy.approvalPolicy,
  );
  const mcpServers = Array.isArray(codingPolicy.mcpServers)
    ? [...new Set(codingPolicy.mcpServers.map(value => String(value).trim()).filter(Boolean))]
    : [];
  const productAction = normalizedCodingProductAction(
    root,
    codingPolicy.productAction,
  );
  const actionTools = codingProductActionTools(productAction, normalized.activeTools);
  const mcpAvailable = !productAction
    && mcpServers.length > 0
    && normalized.executionMode === "go"
    && normalized.approvalPolicy !== "read-only";
  const activeTools = mcpAvailable
    ? [...new Set([...actionTools, "mcp"])]
    : actionTools;
  const capabilities = normalized.capabilities.map(capability => (
    capability.id === "browser"
      ? {
          ...capability,
          status: mcpAvailable ? "approval-required" : "unavailable",
          detail: mcpAvailable
            ? `${mcpServers.length} 个 MCP 服务器已为本任务启用；`
              + "每次外部连接或工具调用前都会在桌面请求批准。"
            : mcpServers.length
              ? "当前 Plan、只读或一键只读动作不会加载 MCP；切换到 Go 后可用。"
            : "项目 .mcp.json 中的服务器仅在本任务“能力”菜单勾选后加载。",
        }
      : capability
  ));
  return {
    ctf: false,
    ...normalized,
    activeTools,
    capabilities,
    workspace: root,
    productAction,
    mcpServers,
    mcpConfigDigest: String(codingPolicy.mcpConfigDigest ?? "").trim(),
    readOnlyResourceRoots: [...(codingPolicy.readOnlyResourceRoots || [])],
    customTools: await createCodingToolDefinitions(
      root,
      codingPolicy.readOnlyResourceRoots,
      normalized.approvalPolicy,
      productAction,
    ),
    maxToolEventOutputBytes: 60000,
  };
}

export async function loadSessionPolicy(
  workspace,
  sessionRole = "",
  codingPolicy = {},
) {
  let content;
  try {
    content = await readFile(join(workspace, "challenge.json"), "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return loadCodingSessionPolicy(workspace, codingPolicy);
    }
    throw error;
  }
  const manifest = JSON.parse(content);
  if (manifest?.schemaVersion !== workspaceSchemaVersion) {
    return loadCodingSessionPolicy(workspace, codingPolicy);
  }
  const toolBuilder = sessionRole === toolBuilderRole;
  const strategist = sessionRole === strategistRole;
  const effectiveManifest = toolBuilder
    ? {
        ...manifest,
        policy: {
          ...manifest.policy,
          mode: toolBuilderRole,
          allowedTools: ctfLocalToolNames,
        },
      }
    : strategist
      ? {
          ...manifest,
          policy: {
            ...manifest.policy,
            mode: strategistRole,
            allowedTools: strategistToolNames,
          },
        }
      : manifest;
  const execution = normalizeExecution(effectiveManifest?.policy?.execution);
  const activeTools = normalizeActiveTools(effectiveManifest);
  const definitions = await createCTFToolDefinitions(
    workspace,
    effectiveManifest,
    execution,
    sessionRole,
  );
  return {
    ctf: true,
    activeTools,
    customTools: definitions.filter(tool => activeTools.includes(tool.name)),
    maxToolEventOutputBytes: execution.maxToolEventOutputBytes,
  };
}
