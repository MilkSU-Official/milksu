import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

export const codingCollaborationToolName = "subagent";

const readOnlyAgents = new Set([
  "planner",
  "reviewer",
  "scout",
  "security-auditor",
]);
const worktreeAgents = new Set([
  "debugger",
  "docs-writer",
  "refactorer",
  "verifier",
  "worker",
]);
const allAgents = new Set([...readOnlyAgents, ...worktreeAgents]);
const maxWriterWorktrees = 2;
const maxTasksPerCall = 4;
const maxTaskCharacters = 16000;

function exactObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function validObjectID(value) {
  return /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(value);
}

function taskKey(conversationId) {
  return createHash("sha256").update(conversationId).digest("hex").slice(0, 32);
}

function realpath(value, label) {
  try {
    return realpathSync(String(value ?? "").trim());
  } catch {
    throw new Error(`${label} is unavailable`);
  }
}

export function normalizeCodingCollaboration(
  value,
  conversationId,
  workspace,
  collaborationRoot = process.env.MILKSU_CODING_COLLABORATION_ROOT,
) {
  if (value === undefined || value === null) return undefined;
  if (!exactObject(value) || Number(value.schemaVersion) !== 2) {
    throw new Error("MilkSU rejected an invalid Coding collaboration descriptor");
  }
  const normalizedConversation = String(conversationId ?? "").trim();
  if (!normalizedConversation || String(value.conversationId ?? "").trim() !== normalizedConversation) {
    throw new Error("Coding collaboration does not belong to the current task");
  }
  const normalizedWorkspace = realpath(workspace, "Coding workspace");
  if (realpath(value.workspace, "Coding collaboration workspace") !== normalizedWorkspace) {
    throw new Error("Coding collaboration does not belong to the current workspace");
  }
  const baseHead = String(value.baseHead ?? "").trim();
  if (!validObjectID(baseHead)) {
    throw new Error("Coding collaboration has an invalid base commit");
  }
  const normalizedRoot = realpath(
    collaborationRoot,
    "Coding collaboration root",
  );
  const worktrees = Array.isArray(value.worktrees) ? value.worktrees : [];
  if (worktrees.length < 1 || worktrees.length > maxWriterWorktrees) {
    throw new Error("Coding collaboration requires one or two writer worktrees");
  }
  const key = taskKey(normalizedConversation);
  const normalizedWorktrees = worktrees.map((entry, index) => {
    if (!exactObject(entry)) {
      throw new Error("Coding collaboration contains an invalid worktree");
    }
    const id = `writer-${index + 1}`;
    const branch = `codex/agent-${key.slice(0, 12)}-writer-${index + 1}`;
    const path = realpath(entry.path, `${id} collaboration worktree`);
    const expectedPath = join(normalizedRoot, key, id);
    if (
      String(entry.id ?? "").trim() !== id
      || String(entry.branch ?? "").trim() !== branch
      || path !== expectedPath
    ) {
      throw new Error(`Coding collaboration boundary mismatch for ${id}`);
    }
    return Object.freeze({ id, path, branch });
  });
  return Object.freeze({
    schemaVersion: 2,
    conversationId: normalizedConversation,
    workspace: normalizedWorkspace,
    baseHead,
    worktrees: Object.freeze(normalizedWorktrees),
  });
}

export function codingCollaborationChanged(previous, requested) {
  const summary = value => JSON.stringify(value
    ? {
        conversationId: value.conversationId,
        workspace: value.workspace,
        baseHead: value.baseHead,
        worktrees: value.worktrees,
      }
    : null);
  return summary(previous) !== summary(requested);
}

function resolveRequestedCwd(value, workspace) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return workspace;
  }
  const raw = String(value).trim();
  const withoutPrefix = raw.startsWith("@") ? raw.slice(1) : raw;
  const candidate = isAbsolute(withoutPrefix)
    ? withoutPrefix
    : resolve(workspace, withoutPrefix);
  return realpath(candidate, "Subagent working directory");
}

function taskEntries(input) {
  if (!exactObject(input)) {
    throw new Error("Subagent input must be an object");
  }
  const hasSingle = typeof input.agent === "string" || typeof input.task === "string";
  const hasParallel = Array.isArray(input.tasks) && input.tasks.length > 0;
  const hasChain = Array.isArray(input.chain) && input.chain.length > 0;
  if (Number(hasSingle) + Number(hasParallel) + Number(hasChain) !== 1) {
    throw new Error("Use exactly one subagent mode: single, parallel, or chain");
  }
  if (hasSingle) {
    if (typeof input.agent !== "string" || typeof input.task !== "string") {
      throw new Error("Single subagent mode requires both agent and task");
    }
    return { mode: "single", values: [input] };
  }
  const mode = hasParallel ? "parallel" : "chain";
  const values = hasParallel ? input.tasks : input.chain;
  if (values.length > maxTasksPerCall) {
    throw new Error(
      `MilkSU allows at most ${maxTasksPerCall} subagent tasks per approved call`,
    );
  }
  if (values.some(value => !exactObject(value))) {
    throw new Error(`Subagent ${mode} entries must be objects`);
  }
  return { mode, values };
}

export function isReadOnlySubagent(agent) {
  return readOnlyAgents.has(String(agent ?? "").trim());
}

// writerWorktreesRequired counts how many isolated writers the model asked
// to prepare. Isolation is opt-in: the default cwd is the main workspace.
export function writerWorktreesRequired(input) {
  try {
    const effectful = taskEntries(input).values.filter(entry => (
      worktreeAgents.has(String(entry?.agent ?? "").trim())
    ));
    return Math.min(effectful.length, maxWriterWorktrees);
  } catch {
    return 0;
  }
}

// assignWriterWorktrees no longer relocates effectful roles. Isolation is
// opt-in: the model keeps the main workspace unless it named a writer cwd.
export function assignWriterWorktrees(input, _collaboration) {
  return input;
}

// The subagent tool schema names the roles. This is the host cap Pi cannot
// know: four tasks per call, and the default working directory.
export function codingSubagentGuidance() {
  return [
    "MilkSU runs at most four subagent tasks per approved call.",
    "Subagents default to the main workspace.",
    "Call milksu_workspace prepare_coding_worktree only when you want an isolated writer, then pass that cwd.",
  ].join(" ");
}

export function codingWorkspaceIdentityGuidance(workspace, collaboration) {
  const mainWorkspace = String(
    workspace || collaboration?.workspace || "",
  ).trim();
  if (!mainWorkspace) return "";
  return [
    `The authoritative working directory for this main session is ${mainWorkspace}.`,
    "Resolve relative paths and describe the current repository from that directory.",
    collaboration?.worktrees?.length > 0
      ? "Managed writer worktrees are optional isolated directories; they never replace the main session working directory."
      : "A path mentioned in conversation or collaboration metadata does not replace the main session working directory.",
    "If a path-sensitive result matters, verify the current directory with the command tool before reporting it.",
  ].join(" ");
}

export function validateSubagentInput(input, collaboration, workspace) {
  const requestedRoot = String(workspace || collaboration?.workspace || "").trim();
  if (!requestedRoot) {
    throw new Error("Subagent workspace is required");
  }
  const root = resolveRequestedCwd(requestedRoot, requestedRoot);
  if (input.agentScope !== undefined && input.agentScope !== "user") {
    throw new Error("MilkSU allows only reviewed bundled subagents");
  }
  if (input.confirmProjectAgents === false) {
    throw new Error("MilkSU does not allow bypassing subagent source confirmation");
  }
  const { mode, values } = taskEntries(input);
  const allowedPaths = new Set([
    root,
    ...(collaboration?.worktrees ?? []).map(worktree => worktree.path),
  ]);
  const worktreePaths = new Set(
    (collaboration?.worktrees ?? []).map(worktree => worktree.path),
  );
  const effectfulPaths = new Set();
  const tasks = values.map((entry, index) => {
    const agent = String(entry.agent ?? "").trim();
    const task = String(entry.task ?? "").trim();
    if (!allAgents.has(agent)) {
      throw new Error(`MilkSU rejected unsupported bundled subagent "${agent}"`);
    }
    if (!task || task.length > maxTaskCharacters) {
      throw new Error(
        `Subagent task ${index + 1} must contain 1-${maxTaskCharacters} characters`,
      );
    }
    const cwd = resolveRequestedCwd(
      entry.cwd ?? input.cwd,
      root,
    );
    if (!allowedPaths.has(cwd)) {
      throw new Error(
        `Subagent ${agent} must use the main workspace or a registered writer worktree`,
      );
    }
    if (worktreePaths.has(cwd) && worktreeAgents.has(agent)) {
      if (effectfulPaths.has(cwd)) {
        throw new Error(
          "Effectful subagents must use distinct writer worktrees",
        );
      }
      effectfulPaths.add(cwd);
    }
    return Object.freeze({
      agent,
      task,
      cwd,
      access: worktreePaths.has(cwd) ? "worktree" : (
        worktreeAgents.has(agent) ? "workspace" : "read-only"
      ),
    });
  });
  return Object.freeze({ mode, tasks: Object.freeze(tasks) });
}

export function formatSubagentApproval(input, collaboration, workspace) {
  const request = validateSubagentInput(input, collaboration, workspace);
  const rows = request.tasks.map(task => {
    const worktree = collaboration?.worktrees.find(value => value.path === task.cwd);
    const location = worktree
      ? `${worktree.id} · ${worktree.branch}`
      : "主工作区";
    const preview = task.task.length > 240
      ? `${task.task.slice(0, 240)}…`
      : task.task;
    return `${task.agent} → ${location}\n${preview}`;
  });
  return [
    `${request.mode} · ${request.tasks.length} 个独立 Pi 会话`,
    ...rows,
  ].join("\n\n");
}

export function collaborationWorktreePaths(collaboration) {
  return collaboration?.worktrees?.map(value => value.path) ?? [];
}

export function isPathWithin(root, target) {
  const path = relative(root, target);
  return path === ""
    || (
      path !== ".."
      && !path.startsWith(`..${sep}`)
      && !isAbsolute(path)
    );
}
