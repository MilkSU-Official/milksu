import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";

export const MILKSU_CONVERSATION_MARKER = "__milksu_conversations_v1__";

function listConversationFiles(rootDir) {
  const files = [];
  if (!rootDir || !existsSync(rootDir)) {
    return files;
  }
  const visit = (directory) => {
    let entries = [];
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory() && entry.name === "archived") {
        visit(path);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      files.push(path);
    }
  };
  visit(rootDir);
  return files;
}

function snapshotCursor(path) {
  const info = statSync(path);
  return `${Math.trunc(info.mtimeMs)}:${info.size}`;
}

function isoTimestamp(value) {
  if (typeof value === "string" && value.trim()) return value;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    return new Date(numeric).toISOString();
  }
  return null;
}

function sessionIdFromPath(path) {
  return basename(path, ".json");
}

export function createMilksuConversationProvider({ rootDir = "" } = {}) {
  const root = String(rootDir ?? "").trim();
  return {
    name: "milksu",
    descriptor: {
      id: "milksu",
      name: "MilkSU",
      vendor: "MilkSU",
      defaultRoot: root,
      color: "#64748b",
    },
    indexVersionMarker: MILKSU_CONVERSATION_MARKER,
    watchTargets(configuredRoot) {
      const path = String(configuredRoot || root || "").trim();
      return path ? [{ kind: "tree", path }] : [];
    },
    discover(ctx) {
      if (!root) return [];
      const units = [];
      for (const path of listConversationFiles(root)) {
        const key = path;
        const cursor = snapshotCursor(path);
        if (ctx?.lastCursor?.(key) === cursor) continue;
        units.push({
          key,
          sessionId: sessionIdFromPath(path),
          project: "milksu",
          meta: { path },
        });
      }
      return units;
    },
    *parse(unit) {
      const path = String(unit?.meta?.path || unit?.key || "").trim();
      if (!path) return `${Date.now()}:0`;
      const stored = JSON.parse(readFileSync(path, "utf8"));
      const sessionId = String(stored?.id || unit.sessionId || sessionIdFromPath(path)).trim();
      const messages = Array.isArray(stored?.messages) ? stored.messages : [];
      const startedAt = isoTimestamp(stored?.createdAt) || isoTimestamp(messages[0]?.timestamp);
      const endedAt = isoTimestamp(messages[messages.length - 1]?.timestamp) || startedAt;
      yield {
        kind: "session",
        id: sessionId,
        title: String(stored?.title || sessionId).trim() || sessionId,
        project: "milksu",
        started_at: startedAt,
        ended_at: endedAt,
        git_branch: null,
        version: null,
        message_count: messages.filter(message => {
          const role = String(message?.role ?? "");
          return role === "user" || role === "assistant";
        }).length,
        countMode: "total",
        jsonl_path: path,
        source: "milksu",
      };
      let parent = null;
      for (const message of messages) {
        const role = String(message?.role ?? "").trim();
        if (role !== "user" && role !== "assistant") continue;
        const text = String(message?.content ?? "").trim();
        if (!text) continue;
        const uuid = `milksu:${sessionId}:${String(message?.id || "").trim() || String(message?.timestamp || "")}`;
        yield {
          kind: "message",
          uuid,
          session_id: sessionId,
          type: "message",
          parent_uuid: parent,
          timestamp: isoTimestamp(message?.timestamp),
          role,
          text,
          content_type: "text",
          is_meta: 0,
          visibility: "visible",
          model: stored?.modelId ?? null,
          is_sidechain: 0,
          agent_id: null,
          input_tokens: null,
          output_tokens: null,
          cwd: stored?.workspacePath ?? null,
          skill: null,
          source: "milksu",
        };
        parent = uuid;
      }
      return snapshotCursor(path);
    },
    raw() {
      return null;
    },
  };
}
