import { Type } from "typebox";
import { CONTEXT_COMPACTION_RATIO, contextUsageSnapshot } from "./bridge-compaction.js";
import { normalizeCodingCollaboration } from "./bridge-collaboration.js";

export const codingWorkspaceToolName = "milksu_workspace";

export const codingWorkspaceReadActions = Object.freeze([
  "list_browser_tabs",
  "list_artifacts",
  "preview_artifact",
  "show_panel",
  "list_status",
  "list_terminals",
  "list_background_tasks",
  "show_terminal",
  "hide_terminal",
  "list_records",
  "get_record",
  "search_records",
  "focus_record",
  "list_computer_use_windows",
]);

export const codingWorkspaceMutatingActions = Object.freeze([
  "focus_browser_tab",
  "open_browser_tab",
  "close_browser_tab",
  "close_all_browser_tabs",
  "reveal_artifacts",
  "compact_context",
  "create_record",
  "update_record",
  "archive_records",
  "restore_records",
  "prepare_coding_worktree",
  "lock_computer_use_window",
]);

const writerWorktreePrepareTimeoutMs = 5 * 60_000;
const computerUseLockTimeoutMs = 90_000;

const workspaceActions = new Set([
  ...codingWorkspaceReadActions,
  ...codingWorkspaceMutatingActions,
]);

const workspacePanels = new Set([
  "browser",
  "artifacts",
  "changes",
  "environment",
  // Optional product surface. The model lists and locks windows itself;
  // this panel does not have to run first.
  "computer-use",
]);
const workspaceRecordKinds = new Set(["conversation", "lab", "cve", "ctf"]);

export const researchSessionRoles = Object.freeze(["cve-research", "lab-job"]);

export function isResearchSessionRole(sessionRole = "") {
  return researchSessionRoles.includes(String(sessionRole ?? "").trim());
}

// CTF keeps solver/strategist/tool-builder. CVE and lab keep their research
// roles so report.md guidance, workspace compact, and Pi length-followUp still
// attach. Ordinary Coding stays empty.
export function resolveWorkflowSessionRole(sessionRole = "", isCtf = false) {
  const role = String(sessionRole ?? "").trim();
  if (isCtf) return role || "solver";
  if (isResearchSessionRole(role)) return role;
  return "";
}

// MilkSU seeds report.md (and related.md for CVE) with their section headings,
// and the env tools describe their own lease. So this carries only what the
// workspace cannot show by itself: which file the user is watching, the
// authorized-target boundary, and the evidence rule for CVE identifiers.
export function researchReportGuidance(sessionRole = "") {
  const lines = [
    "The user is watching report.md in this workspace; it is the lasting result of this job, including when reproduction fails.",
    "Stay on the user-selected target for this job; do not scan unrelated hosts or internet ranges.",
  ];
  if (sessionRole === "cve-research") {
    lines.push(
      "The dossier also shows related.md.",
      "Only record CVE IDs found in public sources; do not invent them.",
    );
  }
  return lines.join(" ");
}

export function codingWorkspaceGuidance() {
  return [
    "Use milksu_workspace for isolated browser tabs, MilkSU records, artifacts, environment, the bottom terminal, optional writer worktrees, or Computer Use windows.",
    "Open or focus a tab, then operate the page with Playwright.",
    "List Computer Use windows, call milksu_ask if several match, then lock_computer_use_window.",
    "Pick a typed action from the tool schema.",
  ].join(" ");
}

export function normalizeCodingWorkspaceAction(value) {
  const action = String(value ?? "").trim();
  return workspaceActions.has(action) ? action : "";
}

export function codingWorkspaceActionBlocked(action, policy = {}) {
  const normalized = normalizeCodingWorkspaceAction(action);
  if (!normalized) return "MilkSU rejected an unknown Coding workspace action.";
  if (codingWorkspaceReadActions.includes(normalized) || normalized === "compact_context") {
    return "";
  }
  if (policy.executionMode !== "go" || policy.approvalPolicy === "read-only") {
    return "Plan 或只读策略不能改动 Coding 界面。先列出标签或产物。";
  }
  return "";
}

export function formatCodingWorkspaceInput(input) {
  const action = normalizeCodingWorkspaceAction(input?.action);
  if (!action) return "";
  const kind = workspaceRecordKinds.has(String(input?.kind ?? "").trim())
    ? String(input.kind).trim()
    : "";
  const ids = Array.isArray(input?.ids)
    ? input.ids.map(value => String(value ?? "").trim()).filter(Boolean)
    : [];
  return [
    action,
    kind ? `类型 ${kind}` : "",
    input?.id ? `记录 ${String(input.id).trim()}` : "",
    ids.length ? `批量 ${ids.length}` : "",
    input?.title ? `标题 ${String(input.title).trim()}` : "",
    input?.tabId ? `标签 ${String(input.tabId).trim()}` : "",
    input?.query ? `查询 ${String(input.query).trim()}` : "",
    input?.url ? `地址 ${String(input.url).trim()}` : "",
    input?.path ? `路径 ${String(input.path).trim()}` : "",
    input?.panel && workspacePanels.has(input.panel) ? `面板 ${input.panel}` : "",
    Number.isFinite(Number(input?.targetPid)) ? `PID ${Number(input.targetPid)}` : "",
    Number.isFinite(Number(input?.targetWindowId))
      ? `窗口 ${Number(input.targetWindowId)}`
      : "",
    Number.isFinite(Number(input?.writers)) ? `writers ${Number(input.writers)}` : "",
  ].filter(Boolean).join(" · ");
}

export function describeWorkspaceCompaction(usage, contextWindow) {
  const snapshot = contextUsageSnapshot(usage, contextWindow);
  return {
    compacted: false,
    scheduled: true,
    percent: snapshot.percent,
    threshold: Math.round(CONTEXT_COMPACTION_RATIO * 100),
    autoCompact: snapshot.shouldCompact,
    detail: `已排队整理上下文。当前占用约 ${snapshot.percent}%。`,
  };
}

export function queueWorkspaceCompaction(pending, conversationId) {
  const id = String(conversationId ?? "").trim();
  if (!id) throw new Error("conversationId is required");
  pending.add(id);
  return id;
}

export async function runQueuedWorkspaceCompaction(pending, conversationId, compact) {
  const id = String(conversationId ?? "").trim();
  if (!id || !pending.delete(id)) return undefined;
  return compact();
}

export const defaultWorkspaceActionTimeoutMs = 25_000;

export function createWorkspaceActionBroker(emit, createID = () => crypto.randomUUID()) {
  const pending = new Map();

  return {
    request({ conversationId, action, input, timeoutMs }) {
      const requestID = createID();
      const deadline = Number.isFinite(timeoutMs) && timeoutMs > 0
        ? timeoutMs
        : defaultWorkspaceActionTimeoutMs;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          if (!pending.has(requestID)) return;
          pending.delete(requestID);
          reject(new Error("Coding workspace action timed out"));
        }, deadline);
        pending.set(requestID, {
          resolve: value => {
            clearTimeout(timer);
            resolve(value);
          },
          reject: error => {
            clearTimeout(timer);
            reject(error);
          },
        });
        emit(conversationId, "workspace_action", {
          requestId: requestID,
          action,
          input: typeof input === "string" ? input : JSON.stringify(input ?? {}),
        });
      });
    },

    respond({ requestId, ok, result, error }) {
      const request = pending.get(requestId);
      if (!request) {
        throw new Error(`Unknown MilkSU workspace action: ${requestId}`);
      }
      pending.delete(requestId);
      if (ok === false) {
        request.reject(new Error(String(error || "Coding workspace action failed")));
        return;
      }
      request.resolve(String(result ?? ""));
    },

    cancelConversation(_conversationId, reason = "workspace action cancelled") {
      for (const [requestID, request] of pending) {
        pending.delete(requestID);
        request.reject(new Error(reason));
      }
    },
  };
}

export function createCodingWorkspaceExtension(
  conversationId,
  getPolicy,
  requestAction,
  queueCompact,
  inspectUsage,
) {
  return (pi) => {
    pi.registerTool({
      name: codingWorkspaceToolName,
      label: "MilkSU workspace",
      description: codingWorkspaceGuidance(),
      parameters: Type.Object({
        action: Type.Union([
          Type.Literal("list_browser_tabs"),
          Type.Literal("focus_browser_tab"),
          Type.Literal("open_browser_tab"),
          Type.Literal("close_browser_tab"),
          Type.Literal("close_all_browser_tabs"),
          Type.Literal("list_artifacts"),
          Type.Literal("preview_artifact"),
          Type.Literal("reveal_artifacts"),
          Type.Literal("show_panel"),
          Type.Literal("list_status"),
          Type.Literal("compact_context"),
          Type.Literal("show_terminal"),
          Type.Literal("hide_terminal"),
          Type.Literal("list_terminals"),
          Type.Literal("list_background_tasks"),
          Type.Literal("list_records"),
          Type.Literal("get_record"),
          Type.Literal("create_record"),
          Type.Literal("update_record"),
          Type.Literal("archive_records"),
          Type.Literal("restore_records"),
          Type.Literal("focus_record"),
          Type.Literal("search_records"),
          Type.Literal("list_computer_use_windows"),
          Type.Literal("lock_computer_use_window"),
          Type.Literal("prepare_coding_worktree"),
        ]),
        tabId: Type.Optional(Type.String({ maxLength: 80 })),
        query: Type.Optional(Type.String({ maxLength: 200 })),
        url: Type.Optional(Type.String({ maxLength: 2000 })),
        path: Type.Optional(Type.String({ maxLength: 500 })),
        panel: Type.Optional(Type.Union([
          Type.Literal("browser"),
          Type.Literal("artifacts"),
          Type.Literal("changes"),
          Type.Literal("environment"),
          Type.Literal("computer-use"),
        ], {
          description: "Which product surface to bring forward. computer-use is optional chrome; list and lock windows with the typed Computer Use actions instead of asking the user to pick first.",
        })),
        writers: Type.Optional(Type.Integer({ minimum: 1, maximum: 2 })),
        targetPid: Type.Optional(Type.Integer({ minimum: 1 })),
        targetWindowId: Type.Optional(Type.Integer({ minimum: 1 })),
        kind: Type.Optional(Type.Union([
          Type.Literal("conversation"),
          Type.Literal("lab"),
          Type.Literal("cve"),
          Type.Literal("ctf"),
        ])),
        id: Type.Optional(Type.String({ maxLength: 128 })),
        ids: Type.Optional(Type.Array(Type.String({ maxLength: 128 }), { maxItems: 50 })),
        title: Type.Optional(Type.String({ maxLength: 120 })),
        archived: Type.Optional(Type.Boolean()),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
        scope: Type.Optional(Type.Union([
          Type.Literal("local"),
          Type.Literal("remote"),
        ])),
        request: Type.Optional(Type.String({ maxLength: 4000 })),
        statement: Type.Optional(Type.String({ maxLength: 12000 })),
        category: Type.Optional(Type.String({ maxLength: 80 })),
        summary: Type.Optional(Type.String({ maxLength: 1200 })),
        cveId: Type.Optional(Type.String({ maxLength: 32 })),
        vendor: Type.Optional(Type.String({ maxLength: 120 })),
        product: Type.Optional(Type.String({ maxLength: 120 })),
        affected: Type.Optional(Type.String({ maxLength: 240 })),
        sourceKind: Type.Optional(Type.Union([
          Type.Literal("text"),
          Type.Literal("url"),
          Type.Literal("socket"),
          Type.Literal("ssh"),
        ])),
      }),
      async execute(_toolCallId, params) {
        const action = normalizeCodingWorkspaceAction(params.action);
        const blocked = codingWorkspaceActionBlocked(action, getPolicy?.());
        if (blocked) throw new Error(blocked);
        if (action === "compact_context") {
          const usage = inspectUsage?.(conversationId) ?? {};
          const report = describeWorkspaceCompaction(usage.usage, usage.contextWindow);
          if (report.scheduled && queueCompact) {
            queueCompact(conversationId);
          }
          return {
            content: [{ type: "text", text: JSON.stringify(report) }],
          };
        }
        const timeoutMs = action === "prepare_coding_worktree"
          ? writerWorktreePrepareTimeoutMs
          : action === "lock_computer_use_window"
            ? computerUseLockTimeoutMs
            : undefined;
        const result = await requestAction({
          conversationId,
          action,
          input: params,
          timeoutMs,
        });
        const policy = getPolicy?.();
        if (policy && action === "prepare_coding_worktree") {
          try {
            const descriptor = normalizeCodingCollaboration(
              JSON.parse(result),
              conversationId,
              policy.workspace,
            );
            if (descriptor) {
              policy.codingCollaboration = descriptor;
              policy.codingCollaborationToolScopeStale = true;
            }
          } catch {
            // The tool result still reaches the model; validation owns a bad payload.
          }
        }
        if (policy && action === "lock_computer_use_window") {
          try {
            const parsed = JSON.parse(result);
            if (parsed?.descriptor?.sessionId) {
              policy.computerUse = parsed.descriptor;
            }
          } catch {
            // The tool result still reaches the model.
          }
        }
        return {
          content: [{ type: "text", text: result || `${action} completed` }],
        };
      },
    });
  };
}
