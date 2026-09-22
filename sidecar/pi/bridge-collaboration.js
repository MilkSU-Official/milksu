import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

export const codingCollaborationToolName = "subagent";

const readOnlyAgents = new Set([
  "scout",
  "researcher",
  "evidence-auditor",
  "reviewer",
  "oracle",
  "delegate",
]);
const externalCliAgents = new Set([
  "cursor-agent",
  "cursor-agent-writer",
  "claude-code",
  "claude-code-writer",
  "codex-exec",
  "codex-exec-writer",
]);
const builtinAgents = new Set([
  ...readOnlyAgents,
  "worker",
  ...externalCliAgents,
]);
const allowedActions = new Set([
  "status",
  "steer",
  "interrupt",
  "stop",
  "resume",
  "guide",
  "list",
  "get",
  "models",
  "children.list",
  "doctor",
  "validate",
  "schedule.list",
  "schedule.show",
  "schedule.history",
  "mission.list",
  "mission.show",
  "watchdog.status",
  "watchdog.check",
  "watchdog.recommend-model",
  "refine.show",
  "lane.status",
]);
const maxWriterWorktrees = 2;
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

function rejectCutFields(input) {
  if (!exactObject(input)) {
    throw new Error("Subagent input must be an object");
  }
  if (input.workflowScript !== undefined || input.workflowScriptPath !== undefined) {
    throw new Error("MilkSU does not run model-authored subagent workflow scripts");
  }
  if (input.share === true) {
    throw new Error("MilkSU does not share subagent sessions");
  }
  if (String(input.machine ?? "").trim()) {
    throw new Error("MilkSU does not open remote or tmux subagent panes");
  }
  if (
    Array.isArray(input.tasks)
    || Array.isArray(input.chain)
    || Array.isArray(input.parallel)
  ) {
    throw new Error("MilkSU accepts one subagent launch per call");
  }
  const scope = String(input.agentScope ?? "").trim();
  if (scope === "user" || scope === "project" || scope === "both") {
    throw new Error("MilkSU allows only reviewed bundled subagents");
  }
}

export function isReadOnlySubagent(agent) {
  return readOnlyAgents.has(String(agent ?? "").trim());
}

// Isolation is opt-in. MilkSU does not preallocate writer worktrees by role.
export function writerWorktreesRequired(_input) {
  return 0;
}

// assignWriterWorktrees no longer relocates effectful roles. Isolation is
// opt-in: the model keeps the main workspace unless it named a writer cwd.
export function assignWriterWorktrees(input, _collaboration) {
  return input;
}

// The package tool description names the roles. This is only the host contract
// Pi cannot see: shared checkout, background by default, and status before control.
export function codingSubagentGuidance() {
  return [
    "Subagents run in the background by default and share the main workspace unless the call sets worktree.",
    "Before steer, interrupt, resume, or stop, read that subagent's status and choose the action.",
    "Call milksu_workspace prepare_coding_worktree only when you want an isolated writer, then pass that cwd.",
  ].join(" ");
}

export function codingWorkspaceIdentityGuidance(workspace, collaboration, uiLocale) {
  const mainWorkspace = String(
    workspace || collaboration?.workspace || "",
  ).trim();
  if (!mainWorkspace) return "";
  const chinese = String(uiLocale ?? "").trim() !== "en";
  if (chinese) {
    return [
      `本主会话的权威工作目录是 ${mainWorkspace}。`,
      "相对路径和当前仓库描述都从该目录解析。",
      collaboration?.worktrees?.length > 0
        ? "受管的 writer worktree 是可选的隔离目录，不能取代主会话工作目录。"
        : "对话或协作元数据里提到的路径，不能取代主会话工作目录。",
      "如果结果依赖路径，先用命令工具核实当前目录再报告。",
    ].join(" ");
  }
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
  rejectCutFields(input);
  const action = String(input.action ?? "").trim();
  if (action) {
    if (!allowedActions.has(action)) {
      throw new Error(`MilkSU blocked subagent action "${action}"`);
    }
    return Object.freeze({
      mode: "control",
      action,
      externalCli: false,
      tasks: Object.freeze([]),
    });
  }
  const agent = String(input.agent ?? "").trim();
  const task = String(input.task ?? "").trim();
  if (!builtinAgents.has(agent)) {
    throw new Error(`MilkSU rejected unsupported bundled subagent "${agent}"`);
  }
  if (!task || task.length > maxTaskCharacters) {
    throw new Error(`Subagent task must contain 1-${maxTaskCharacters} characters`);
  }
  const allowedPaths = new Set([
    root,
    ...(collaboration?.worktrees ?? []).map(worktree => worktree.path),
  ]);
  const worktreePaths = new Set(
    (collaboration?.worktrees ?? []).map(worktree => worktree.path),
  );
  const cwd = resolveRequestedCwd(input.cwd, root);
  if (!allowedPaths.has(cwd)) {
    throw new Error(
      `Subagent ${agent} must use the main workspace or a registered writer worktree`,
    );
  }
  return Object.freeze({
    mode: "single",
    externalCli: externalCliAgents.has(agent),
    tasks: Object.freeze([Object.freeze({
      agent,
      task,
      cwd,
      access: worktreePaths.has(cwd)
        ? "worktree"
        : (readOnlyAgents.has(agent) ? "read-only" : "workspace"),
    })]),
  });
}

export function formatSubagentApproval(input, collaboration, workspace) {
  const request = validateSubagentInput(input, collaboration, workspace);
  if (request.mode === "control") return request.action;
  const task = request.tasks[0];
  const worktree = collaboration?.worktrees.find(value => value.path === task.cwd);
  const location = worktree
    ? `${worktree.id} · ${worktree.branch}`
    : "主工作区";
  const preview = task.task.length > 240
    ? `${task.task.slice(0, 240)}…`
    : task.task;
  return [
    "single · 1 个后台 Pi 会话",
    `${task.agent} → ${location}\n${preview}`,
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
