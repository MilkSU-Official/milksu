const terminalRetentionMs = 30 * 60_000;
const maximumTasks = 24;

function boundedText(value, limit) {
  const text = String(value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

function commandLabel(meta) {
  if (typeof meta.command === "string" && meta.command.trim()) {
    return boundedText(meta.command, 2000);
  }
  if (Array.isArray(meta.argv) && meta.argv.length) {
    return boundedText(meta.argv.join(" "), 2000);
  }
  return "";
}

function visibleMeta(meta, now) {
  if (!meta || typeof meta !== "object" || meta.dismissedAt !== undefined) return false;
  if (meta.status === "running") return true;
  return Number.isFinite(meta.endedAt) && now - meta.endedAt < terminalRetentionMs;
}

function logPreview(meta, readTaskLog) {
  if (typeof readTaskLog !== "function" || !meta.logPath) return {};
  try {
    const log = readTaskLog(meta.logPath, 24);
    return {
      logTail: boundedText(log?.text, 6000),
      logTruncated: log?.truncated === true,
    };
  } catch {
    return {};
  }
}

function processIdentifier(meta) {
  if (Number.isSafeInteger(meta.pid) && meta.pid > 0) return meta.pid;
  if (Number.isSafeInteger(meta.spawnPid) && meta.spawnPid > 0) {
    return meta.spawnPid;
  }
  return undefined;
}

export function backgroundTaskMetasForSession(metas, sessionId) {
  const resolvedSession = String(sessionId ?? "").trim();
  if (!resolvedSession || !Array.isArray(metas)) return [];
  return metas.filter(meta => (
    String(meta?.callbackOrigin?.sessionId ?? "").trim() === resolvedSession
  ));
}

export function projectBackgroundTaskMetas(
  metas,
  now = Date.now(),
  readTaskLog,
) {
  if (!Array.isArray(metas)) return [];
  return metas
    .filter(meta => visibleMeta(meta, now))
    .sort((left, right) => Number(right.startedAt ?? 0) - Number(left.startedAt ?? 0))
    .slice(0, maximumTasks)
    .map(meta => ({
      id: boundedText(meta.id, 160),
      name: boundedText(meta.name, 240),
      kind: meta.kind === "command_watch" ? "watch" : "process",
      status: ["running", "succeeded", "failed", "cancelled", "timed_out"].includes(meta.status)
        ? meta.status
        : "failed",
      startedAt: Number.isFinite(meta.startedAt) ? meta.startedAt : now,
      endedAt: Number.isFinite(meta.endedAt) ? meta.endedAt : undefined,
      command: commandLabel(meta),
      cwd: boundedText(meta.cwd, 1200),
      pid: processIdentifier(meta),
      pgid: Number.isSafeInteger(meta.pgid) && meta.pgid > 0 ? meta.pgid : undefined,
      logPath: boundedText(meta.logPath, 1200),
      ...logPreview(meta, readTaskLog),
      lastExitCode: Number.isInteger(meta.lastExitCode) ? meta.lastExitCode : undefined,
      error: boundedText(meta.error, 1000),
    }));
}
