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
const maxTasksPerCall = 2;
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
  if (!exactObject(value) || Number(value.schemaVersion) !== 1) {
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
  if (worktrees.length < 1 || worktrees.length > maxTasksPerCall) {
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
    schemaVersion: 1,
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

export function validateSubagentInput(input, collaboration) {
  if (!collaboration) {
    throw new Error("prepare Coding collaboration worktrees before delegating");
  }
  if (input.agentScope !== undefined && input.agentScope !== "user") {
    throw new Error("MilkSU allows only reviewed bundled subagents");
  }
  if (input.confirmProjectAgents === false) {
    throw new Error("MilkSU does not allow bypassing subagent source confirmation");
  }
  const { mode, values } = taskEntries(input);
  const allowedPaths = new Set([
    collaboration.workspace,
    ...collaboration.worktrees.map(worktree => worktree.path),
  ]);
  const worktreePaths = new Set(
    collaboration.worktrees.map(worktree => worktree.path),
  );
  const effectfulParallelPaths = new Set();
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
      collaboration.workspace,
    );
    if (!allowedPaths.has(cwd)) {
      throw new Error(
        `Subagent ${agent} must use the main workspace or a registered writer worktree`,
      );
    }
    if (worktreeAgents.has(agent) && !worktreePaths.has(cwd)) {
      throw new Error(`Subagent ${agent} requires its own writer worktree`);
    }
    if (mode === "parallel" && worktreeAgents.has(agent)) {
      if (effectfulParallelPaths.has(cwd)) {
        throw new Error(
          "Parallel effectful subagents must use distinct writer worktrees",
        );
      }
      effectfulParallelPaths.add(cwd);
    }
    return Object.freeze({
      agent,
      task,
      cwd,
      access: worktreeAgents.has(agent) ? "worktree" : "read-only",
    });
  });
  return Object.freeze({ mode, tasks: Object.freeze(tasks) });
}

export function formatSubagentApproval(input, collaboration) {
  const request = validateSubagentInput(input, collaboration);
  const rows = request.tasks.map(task => {
    const worktree = collaboration.worktrees.find(value => value.path === task.cwd);
    const location = worktree
      ? `${worktree.id} · ${worktree.branch}`
      : "主工作树（只读角色）";
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
