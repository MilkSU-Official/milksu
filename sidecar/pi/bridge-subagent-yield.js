import { homedir } from "node:os";
import { isAbsolute, relative, resolve } from "node:path";
import { isReadOnlySubagent, isPathWithin } from "./bridge-collaboration.js";

export const subagentYieldSchema = "milksu-subagent-yield/v1";

const yieldStatuses = new Set(["succeeded", "failed", "aborted"]);

const secretAssignment = /\b(api[_ -]?key|key|token|secret|password|relay[_ -]?key)\s*[:=]\s*[^\s,;]+/gi;
const secretQuery = /([?&](?:api[_-]?key|key|token|secret|password)=)[^&#\s]+/gi;
const secretBearer = /(bearer\s+)[a-z0-9._~+/=-]{8,}/gi;
const secretToken = /\b(?:sk[-_]|gsk_|aiza|nss_agent_|tfk_|tokenflux)[a-z0-9._-]{8,}/gi;

function exactObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function boundedText(value, limit) {
  const text = String(value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(secretToken, "[REDACTED]")
    .replace(secretBearer, "$1[REDACTED]")
    .replace(secretAssignment, "$1=[REDACTED]")
    .replace(secretQuery, "$1[REDACTED]");
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

function redactSecretValues(text, secrets) {
  let next = String(text ?? "");
  for (const secret of secrets) {
    if (!secret) continue;
    next = next.split(secret).join("[REDACTED]");
  }
  return next;
}

function collectEnvSecrets(environment = process.env) {
  return [
    environment.MILKSU_RELAY_KEY,
    environment.TOKENFLUX_API_KEY,
    environment.OPENAI_API_KEY,
  ].filter(value => String(value ?? "").trim().length >= 8);
}

function homePrefixes(homeDirectory = homedir()) {
  const home = String(homeDirectory ?? "").trim();
  if (!home) return [];
  return [home, home.replaceAll("\\", "/")];
}

function stripHomePrefix(value, homeDirectory) {
  let text = String(value ?? "");
  for (const home of homePrefixes(homeDirectory)) {
    if (text === home || text.startsWith(`${home}/`) || text.startsWith(`${home}\\`)) {
      text = text.slice(home.length).replace(/^[/\\]+/, "") || ".";
    }
  }
  return text.replace(/^~[/\\]/, "");
}

function relativizePath(value, roots, homeDirectory) {
  const original = boundedText(value, 800);
  if (!original) return "";
  for (const root of roots) {
    const base = String(root ?? "").trim();
    if (!base) continue;
    try {
      const resolved = isAbsolute(original) ? resolve(original) : resolve(base, original);
      if (isPathWithin(base, resolved)) {
        return relative(base, resolved).replaceAll("\\", "/") || ".";
      }
    } catch {
      // Keep looking for another root.
    }
  }
  return stripHomePrefix(original, homeDirectory)
    .replaceAll("\\", "/")
    .replace(/^\.\//, "")
    .replace(/^[/\\]+/, "") || ".";
}

function uniqueRoots(values) {
  return [...new Set(values.map(value => String(value ?? "").trim()).filter(Boolean))];
}

function asInteger(value) {
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric)) return undefined;
  return numeric;
}

function normalizeFinding(value, roots, homeDirectory) {
  if (typeof value === "string") {
    const path = relativizePath(value, roots, homeDirectory);
    return path ? { path, note: "" } : undefined;
  }
  if (!exactObject(value)) return undefined;
  const path = relativizePath(value.path ?? value.file ?? value.filename, roots, homeDirectory);
  if (!path) return undefined;
  return {
    path,
    note: boundedText(value.note ?? value.detail ?? value.message ?? "", 400),
  };
}

function extractRawYield(raw) {
  if (!raw) return undefined;
  if (Array.isArray(raw)) return raw[0];
  if (exactObject(raw.yield)) return { ...raw, ...raw.yield };
  if (exactObject(raw.details?.yield)) return { ...raw, ...raw.details.yield };
  if (Array.isArray(raw.details?.yields) && exactObject(raw.details.yields[0])) {
    return { ...raw, ...raw.details.yields[0] };
  }
  if (Array.isArray(raw.details?.results) && exactObject(raw.details.results[0])) {
    return { ...raw, ...raw.details.results[0] };
  }
  if (Array.isArray(raw.results) && exactObject(raw.results[0])) {
    return { ...raw, ...raw.results[0] };
  }
  return exactObject(raw) ? raw : undefined;
}

function parseEmbeddedYield(text) {
  const source = String(text ?? "").trim();
  if (!source) return undefined;
  const block = source.match(/\{[\s\S]*"files"\s*:\s*\[[\s\S]*\}/);
  if (!block) return undefined;
  try {
    const parsed = JSON.parse(block[0]);
    return exactObject(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function resolveLocation(raw, options) {
  const worktrees = Array.isArray(options.worktrees) ? options.worktrees : [];
  const requestedCwd = String(raw?.cwd ?? options.cwd ?? "").trim();
  const worktreeId = String(raw?.worktreeId ?? raw?.worktree ?? options.worktreeId ?? "").trim();
  const matched = worktrees.find(entry => (
    entry?.id === worktreeId
    || (requestedCwd && entry?.path === requestedCwd)
  ));
  return {
    cwd: requestedCwd || matched?.path || String(options.workspace ?? "").trim(),
    worktreeId: matched?.id || worktreeId,
    worktreePath: matched?.path || "",
  };
}

function writerPaths(options) {
  const worktrees = Array.isArray(options.worktrees) ? options.worktrees : [];
  return uniqueRoots([
    ...(options.writerWorktreePaths ?? []),
    ...worktrees.map(entry => entry?.path),
  ]);
}

function pathLooksWritten(path, options) {
  const value = String(path ?? "").trim();
  if (!value) return false;
  const normalizedValue = value.replaceAll("\\", "/");
  if (/(?:^|\/)writer-\d+(?:\/|$)/.test(normalizedValue)) return true;
  if (!isAbsolute(value) && !isAbsolute(normalizedValue)) return false;
  for (const root of writerPaths(options)) {
    try {
      if (isPathWithin(root, value) || isPathWithin(root, normalizedValue)) return true;
    } catch {
      // Ignore unresolvable candidates.
    }
  }
  return false;
}

export function validateSubagentYield(value, options = {}) {
  if (!exactObject(value)) {
    throw new Error("Subagent yield must be an object");
  }
  if (!yieldStatuses.has(String(value.status ?? "").trim())) {
    throw new Error("Subagent yield is missing status");
  }
  const cwd = String(value.cwd ?? "").trim();
  const worktreeId = String(value.worktreeId ?? "").trim();
  if (!cwd && !worktreeId) {
    throw new Error("Subagent yield requires cwd or worktreeId");
  }
  if (!Array.isArray(value.files)) {
    throw new Error("Subagent yield is missing files");
  }
  if (!Array.isArray(value.findings)) {
    throw new Error("Subagent yield is missing findings");
  }
  if (!Number.isSafeInteger(value.exitCode)) {
    throw new Error("Subagent yield is missing exitCode");
  }
  const role = String(options.role ?? value.role ?? value.agent ?? "").trim();
  if (isReadOnlySubagent(role)) {
    const written = [
      ...value.files.map(path => String(path ?? "")),
      ...value.findings.map(finding => String(finding?.path ?? "")),
    ].filter(path => pathLooksWritten(path, options));
    if (written.length) {
      throw new Error("Read-only subagent yield cannot include writer worktree paths");
    }
  }
  return value;
}

export function normalizeSubagentYield(raw, options = {}) {
  const extracted = extractRawYield(raw) ?? parseEmbeddedYield(
    Array.isArray(raw?.content)
      ? raw.content.filter(block => block?.type === "text").map(block => block.text).join("\n")
      : raw?.content ?? raw?.stdout ?? raw?.text,
  );
  if (!extracted && raw !== undefined && raw !== null && !exactObject(raw)) {
    throw new Error("Subagent yield must be an object");
  }
  const source = extracted ?? {};
  const location = resolveLocation(source, options);
  const roots = uniqueRoots([
    location.worktreePath,
    options.workspace,
    location.cwd,
    ...(options.worktrees ?? []).map(entry => entry?.path),
  ]);
  const homeDirectory = options.homeDirectory ?? homedir();
  const filesSource = Array.isArray(source.files) ? source.files : undefined;
  const findingsSource = Array.isArray(source.findings) ? source.findings : undefined;
  if (options.requireFields) {
    if (filesSource === undefined || findingsSource === undefined) {
      throw new Error("Subagent yield is missing files or findings");
    }
  }
  const exitCode = asInteger(source.exitCode);
  if (exitCode === undefined && options.requireFields) {
    throw new Error("Subagent yield is missing exitCode");
  }
  const status = yieldStatuses.has(String(source.status ?? "").trim())
    ? String(source.status).trim()
    : exitCode === 0
      ? "succeeded"
      : source.aborted
        ? "aborted"
        : "failed";
  const secrets = collectEnvSecrets(options.environment);
  const role = String(options.role ?? source.agent ?? source.role ?? "").trim();
  const originalPaths = [
    ...(filesSource ?? []).map(entry => (typeof entry === "string" ? entry : entry?.path)),
    ...(findingsSource ?? []).map(entry => (typeof entry === "string" ? entry : entry?.path ?? entry?.file)),
  ].map(path => String(path ?? "").trim()).filter(Boolean);
  if (isReadOnlySubagent(role) && originalPaths.some(path => pathLooksWritten(path, options))) {
    throw new Error("Read-only subagent yield cannot include writer worktree paths");
  }
  const files = (filesSource ?? []).flatMap((entry) => {
    const path = relativizePath(
      redactSecretValues(typeof entry === "string" ? entry : entry?.path, secrets),
      roots,
      homeDirectory,
    );
    return path ? [path] : [];
  });
  const findings = (findingsSource ?? []).flatMap((entry) => {
    const finding = normalizeFinding(
      exactObject(entry)
        ? {
            ...entry,
            path: redactSecretValues(entry.path ?? entry.file, secrets),
            note: redactSecretValues(entry.note ?? entry.detail, secrets),
          }
        : redactSecretValues(entry, secrets),
      roots,
      homeDirectory,
    );
    return finding ? [finding] : [];
  });
  const cwd = location.cwd
    ? relativizePath(location.cwd, roots, homeDirectory)
    : "";
  const normalized = {
    status,
    cwd: cwd || undefined,
    worktreeId: location.worktreeId || undefined,
    files,
    findings,
    exitCode: exitCode ?? (status === "succeeded" ? 0 : 1),
  };
  return validateSubagentYield(normalized, {
    ...options,
    role: options.role ?? source.agent ?? source.role,
  });
}

export function formatSubagentYieldLines(value) {
  const lines = [];
  for (const [index, file] of value.files.entries()) {
    lines.push(`files[${index}]=${file}`);
  }
  for (const [index, finding] of value.findings.entries()) {
    lines.push(`findings[${index}].path=${finding.path}`);
    if (finding.note) lines.push(`findings[${index}].note=${finding.note}`);
  }
  lines.push(`exitCode=${value.exitCode}`);
  lines.push(`status=${value.status}`);
  if (value.worktreeId) lines.push(`worktreeId=${value.worktreeId}`);
  else if (value.cwd) lines.push(`cwd=${value.cwd}`);
  return lines.join("\n");
}

function contentText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter(block => block?.type === "text")
    .map(block => String(block.text ?? ""))
    .join("\n");
}

function shortSummary(text) {
  const compact = boundedText(String(text ?? "").replace(/\s+/g, " ").trim(), 240);
  return compact;
}

export function readSubagentYieldField(toolResult, path) {
  const yieldValue = exactObject(toolResult?.details?.yield)
    ? toolResult.details.yield
    : Array.isArray(toolResult?.details?.yields)
      ? toolResult.details.yields[0]
      : undefined;
  if (!yieldValue) return undefined;
  const parts = String(path ?? "")
    .replaceAll("[", ".")
    .replaceAll("]", "")
    .split(".")
    .filter(Boolean);
  let current = yieldValue;
  for (const part of parts) {
    if (current == null) return undefined;
    current = current[part];
  }
  return current;
}

function taskStubs(input) {
  if (!exactObject(input)) return [];
  if (typeof input.agent === "string" || typeof input.task === "string") {
    return [{ agent: input.agent, cwd: input.cwd, task: input.task }];
  }
  if (Array.isArray(input.tasks) && input.tasks.length) return input.tasks;
  if (Array.isArray(input.chain) && input.chain.length) return input.chain;
  return [];
}

export function formatSubagentToolInput(args, context = {}) {
  const stubs = taskStubs(args);
  if (!stubs.length) return "";
  const worktrees = context.worktrees ?? context.collaboration?.worktrees ?? [];
  return stubs.map((entry) => {
    const role = String(entry?.agent ?? "subagent").trim() || "subagent";
    const cwd = String(entry?.cwd ?? args?.cwd ?? "").trim();
    const worktree = worktrees.find(value => value.path === cwd);
    return worktree?.id ? `${role} · ${worktree.id}` : role;
  }).join(" · ");
}

export function projectSubagentRosterStart(input, context = {}) {
  const stubs = taskStubs(input);
  const toolCallId = String(context.toolCallId ?? "").trim() || "subagent";
  const worktrees = context.worktrees ?? context.collaboration?.worktrees ?? [];
  return stubs.map((entry, index) => {
    const role = String(entry?.agent ?? "subagent").trim() || "subagent";
    const cwd = String(entry?.cwd ?? input?.cwd ?? context.workspace ?? "").trim();
    const worktree = worktrees.find(value => value.path === cwd);
    const id = stubs.length === 1 ? toolCallId : `${toolCallId}:${index}`;
    return {
      id,
      toolCallId,
      role,
      status: "start",
      cwd: worktree?.id || undefined,
    };
  });
}

export function projectSubagentRosterEnd(tasks, result, context = {}) {
  const yields = projectSubagentYields(result, context);
  const list = Array.isArray(tasks) ? tasks : [];
  if (!list.length && yields.length) {
    return yields.map((value, index) => ({
      id: `${context.toolCallId || "subagent"}:${index}`,
      toolCallId: context.toolCallId,
      role: String(context.role ?? "subagent"),
      status: value.status === "succeeded" ? "succeeded" : "failed",
      durationMs: context.durationMs,
      exitCode: value.exitCode,
      yield: value,
    }));
  }
  return list.map((task, index) => {
    const value = yields[index] ?? yields[0];
    const failed = context.isError || !value || value.status !== "succeeded";
    return {
      ...task,
      status: failed ? "failed" : "succeeded",
      durationMs: context.durationMs,
      exitCode: value?.exitCode,
      yield: value,
    };
  });
}

export function projectSubagentYields(raw, context = {}) {
  const results = Array.isArray(raw?.details?.results)
    ? raw.details.results
    : Array.isArray(raw?.results)
      ? raw.results
      : exactObject(raw)
        ? [raw]
        : [];
  if (!results.length) {
    return [normalizeSubagentYield(raw, context)];
  }
  return results.map((entry, index) => normalizeSubagentYield(entry, {
    ...context,
    role: context.roles?.[index] ?? entry?.agent ?? context.role,
    cwd: entry?.cwd ?? context.cwd,
  }));
}

export function projectSubagentToolResult(event, context = {}) {
  const raw = {
    content: event?.content,
    details: event?.details,
    results: event?.results,
    yield: event?.yield,
    input: event?.input ?? event?.args,
    stdout: event?.stdout,
    exitCode: event?.exitCode,
    agent: event?.input?.agent ?? event?.args?.agent,
    cwd: event?.input?.cwd ?? event?.args?.cwd ?? context.cwd,
  };
  const worktrees = context.worktrees ?? context.collaboration?.worktrees ?? [];
  const roles = taskStubs(event?.input ?? event?.args).map(entry => entry.agent);
  const yields = projectSubagentYields({
    ...raw,
    details: event?.details ?? raw.details,
  }, {
    ...context,
    worktrees,
    workspace: context.workspace ?? context.collaboration?.workspace,
    role: roles[0] ?? event?.input?.agent ?? event?.args?.agent,
    roles,
  });
  const primary = yields[0];
  const original = contentText(event?.content);
  const summary = shortSummary(original);
  const fieldLines = yields.map((value, index) => (
    yields.length > 1
      ? `#${index}\n${formatSubagentYieldLines(value)}`
      : formatSubagentYieldLines(value)
  )).join("\n");
  const jsonBlock = JSON.stringify(yields.length === 1 ? primary : yields);
  const text = [fieldLines, jsonBlock, summary].filter(Boolean).join("\n\n");
  return {
    content: [{ type: "text", text }],
    details: {
      ...(exactObject(event?.details) ? event.details : {}),
      schema: subagentYieldSchema,
      yield: primary,
      yields,
    },
  };
}

export function createSubagentYieldExtension(getContext) {
  return (pi) => {
    pi.on("tool_result", async (event) => {
      if (String(event?.toolName ?? "").trim() !== "subagent") return undefined;
      const context = typeof getContext === "function" ? getContext() : getContext;
      return projectSubagentToolResult(event, context);
    });
  };
}
