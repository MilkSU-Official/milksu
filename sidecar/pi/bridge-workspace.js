import { Type } from "typebox";
import { CONTEXT_COMPACTION_RATIO, contextUsageSnapshot } from "./bridge-compaction.js";
import { normalizeCodingCollaboration } from "./bridge-collaboration.js";
import { redactResearchText } from "./bridge-subagent-yield.js";

export const codingWorkspaceToolName = "milksu_workspace";

export const codingWorkspaceReadActions = Object.freeze([
  "list_browser_tabs",
  "list_artifacts",
  "list_reverse_artifacts",
  "preview_reverse_artifact",
  "list_images",
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
  "list_research_runs",
  "get_research_run",
  "read_research_source",
  "read_research_report",
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
  "start_research_run",
  "register_research_task",
  "open_research_browser_tab",
  "seal_research_batch",
  "begin_research_gap_fill",
  "record_research_source",
  "record_research_citation",
  "complete_research_run",
  "cancel_research_run",
  "resume_research_run",
]);

const writerWorktreePrepareTimeoutMs = 5 * 60_000;
const computerUseLockTimeoutMs = 90_000;

const workspaceActions = new Set([
  ...codingWorkspaceReadActions,
  ...codingWorkspaceMutatingActions,
]);
const researchSessionActions = new Set([
  "start_research_run",
  "register_research_task",
  "open_research_browser_tab",
  "resume_research_run",
  "begin_research_gap_fill",
  "complete_research_run",
  "cancel_research_run",
  "open_browser_tab",
  "focus_browser_tab",
]);
const researchManagedBrowserActions = new Set([
  "list_browser_tabs",
  "open_browser_tab",
  "focus_browser_tab",
  "close_browser_tab",
  "close_all_browser_tabs",
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
export function researchReportGuidance(sessionRole = "", uiLocale) {
  const chinese = String(uiLocale ?? "").trim() !== "en";
  const lines = chinese
    ? [
      "用户在看这个工作区里的 report.md；它是这次作业留下的结果，复现失败时也一样。",
      "只停留在用户选定的目标上；不要扫描无关主机或互联网网段。",
    ]
    : [
      "The user is watching report.md in this workspace; it is the lasting result of this job, including when reproduction fails.",
      "Stay on the user-selected target for this job; do not scan unrelated hosts or internet ranges.",
    ];
  if (sessionRole === "cve-research") {
    lines.push(
      chinese ? "档案里还有 related.md。" : "The dossier also shows related.md.",
      chinese
        ? "只记录公开来源里出现的 CVE ID，不要编造。"
        : "Only record CVE IDs found in public sources; do not invent them.",
      chinese
        ? "若有 LEARNING.md，那是用户在这个 CVE 上保存的学习记录，是这次作业的先验，不是复现证明。"
        : "If LEARNING.md is present, it is learning the user saved on this CVE. It is prior for this job, not proof of reproduction.",
    );
  }
  return lines.join(" ");
}

export function codingWorkspaceGuidance() {
  return [
    "Use milksu_workspace for browser tabs, records, artifacts, environment, terminal, worktrees, or Computer Use.",
    "Reverse sessions: list_reverse_artifacts / preview_reverse_artifact expose this conversation's milksu-rea results.",
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

export function researchBrowserWorkspaceActionBlocked(action, researchActive) {
  const normalized = normalizeCodingWorkspaceAction(action);
  if (!researchActive || !researchManagedBrowserActions.has(normalized)) return "";
  return "Deep Research uses only the typed Research Browser source action.";
}

export function formatCodingWorkspaceInput(input, { environment = process.env, secrets = [] } = {}) {
  const action = normalizeCodingWorkspaceAction(input?.action);
  if (!action) return "";
  const safeText = value => String(redactResearchText(value, environment, secrets) ?? "").trim();
  if (
    action.includes("research_")
    || action === "open_browser_tab"
    || action === "focus_browser_tab"
  ) {
    return [
      action,
      input?.runId ? `run ${safeText(input.runId)}` : "",
      input?.sourceId ? `source ${safeText(input.sourceId)}` : "",
    ].filter(Boolean).join(" · ");
  }
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

const REA_TOOL_PREFIX = "milksu-rea_";

/**
 * 从会话消息里收集 milksu-rea 的 MCP 调用产物。右栏「逆向产物」面板
 * （reverseArtifacts.ts 的 collector）从同一份渲染文本收集；这里从
 * bridge 侧的 transcript 收集，供 milksu_workspace 的 list /
 * preview 动作把同一批产物交给模型。
 */
export function collectReverseArtifacts(messages = []) {
  const calls = [];
  const resultsByCallId = new Map();
  for (const message of messages) {
    if (message?.role === "assistant" && Array.isArray(message.content)) {
      for (const block of message.content) {
        if (block?.type !== "toolCall" || block.name !== "mcp") continue;
        const toolName = String(block.arguments?.tool ?? "");
        if (!toolName.startsWith(REA_TOOL_PREFIX)) continue;
        calls.push({ callId: block.id, tool: toolName.slice(REA_TOOL_PREFIX.length), args: block.arguments?.args ?? {} });
      }
    } else if (message?.role === "toolResult" && message.toolName === "mcp") {
      resultsByCallId.set(message.toolCallId, message);
    }
  }
  return calls.map((call, index) => {
    const result = resultsByCallId.get(call.callId);
    const text = (result?.content ?? [])
      .filter(block => block?.type === "text")
      .map(block => block.text)
      .join("\n");
    return {
      id: `rea-${index + 1}`,
      tool: call.tool,
      args: call.args,
      status: result ? (result.isError ? "error" : "done") : "pending",
      truncated: /truncated|Full text saved to/i.test(text),
      savedPath: (text.match(/Full text saved to: (\S+)/) ?? [])[1] ?? null,
      resultHead: text.slice(0, 400),
      fullText: text,
    };
  });
}

/**
 * 事件驱动的逆向产物收集：sidecar 的会话订阅在 message_end 时喂进来。
 * session.messages 在会话恢复路径上不可靠（Pi 1.1.0 的存储分层），
 * 事件流是当前 sidecar 生命周期内的可靠来源。
 */
export function updateReverseArtifactStore(store, message) {
  if (!store || !message || typeof message !== "object") return;
  if (message.role === "assistant" && Array.isArray(message.content)) {
    for (const block of message.content) {
      if (block?.type !== "toolCall" || block.name !== "mcp") continue;
      const toolName = String(block.arguments?.tool ?? "");
      if (!toolName.startsWith(REA_TOOL_PREFIX)) continue;
      const existing = store.find(item => item.callId === block.id);
      if (existing) continue;
      store.push({ id: `rea-${store.length + 1}`, callId: block.id, tool: toolName.slice(REA_TOOL_PREFIX.length), args: block.arguments?.args ?? {}, status: "pending", truncated: false, savedPath: null, fullText: "" });
    }
  } else if (message.role === "toolResult" && message.toolName === "mcp") {
    const artifact = store.find(item => item.callId === message.toolCallId);
    if (!artifact) return;
    const text = (message.content ?? [])
      .filter(block => block?.type === "text")
      .map(block => block.text)
      .join("\n");
    artifact.status = message.isError ? "error" : "done";
    artifact.truncated = /truncated|Full text saved to/i.test(text);
    artifact.savedPath = (text.match(/Full text saved to: (\S+)/) ?? [])[1] ?? null;
    artifact.fullText = text;
  }
}

export function listReverseArtifactsFromStore(store = []) {
  return store.map(({ fullText, callId, ...rest }) => ({ ...rest, resultHead: fullText.slice(0, 400) }));
}

export function previewReverseArtifactFromStore(store = [], id = "") {
  const artifact = store.find(item => item.id === String(id).trim());
  if (!artifact) return null;
  return {
    id: artifact.id,
    tool: artifact.tool,
    args: artifact.args,
    status: artifact.status,
    truncated: artifact.truncated,
    savedPath: artifact.savedPath,
    content: artifact.fullText.slice(0, 16384),
  };
}

export function previewReverseArtifact(artifacts = [], id = "") {
  const artifact = artifacts.find(item => item.id === String(id).trim());
  if (!artifact) return null;
  return {
    id: artifact.id,
    tool: artifact.tool,
    args: artifact.args,
    status: artifact.status,
    truncated: artifact.truncated,
    savedPath: artifact.savedPath,
    content: artifact.fullText.slice(0, 16384),
  };
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
  observeResearchAction,
  getResearchSecrets,
  isResearchActive,
  getReverseArtifacts,
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
          Type.Literal("list_reverse_artifacts"),
          Type.Literal("preview_reverse_artifact"),
          Type.Literal("list_images"),
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
          Type.Literal("start_research_run"),
          Type.Literal("register_research_task"),
          Type.Literal("open_research_browser_tab"),
          Type.Literal("list_research_runs"),
          Type.Literal("get_research_run"),
          Type.Literal("seal_research_batch"),
          Type.Literal("begin_research_gap_fill"),
          Type.Literal("record_research_source"),
          Type.Literal("read_research_source"),
          Type.Literal("read_research_report"),
          Type.Literal("record_research_citation"),
          Type.Literal("complete_research_run"),
          Type.Literal("cancel_research_run"),
          Type.Literal("resume_research_run"),
        ]),
        tabId: Type.Optional(Type.String({ maxLength: 80 })),
        query: Type.Optional(Type.String({ maxLength: 2000 })),
        url: Type.Optional(Type.String({ maxLength: 2000 })),
        runId: Type.Optional(Type.String({ maxLength: 128 })),
        taskPrompt: Type.Optional(Type.String({ maxLength: 16000 })),
        extract: Type.Optional(Type.String({ maxLength: 4096 })),
        claim: Type.Optional(Type.String({ maxLength: 2000 })),
        sourceId: Type.Optional(Type.String({ maxLength: 128 })),
        verdict: Type.Optional(Type.Union([
          Type.Literal("supported"),
          Type.Literal("unsupported"),
        ])),
        reason: Type.Optional(Type.String({ maxLength: 1200 })),
        report: Type.Optional(Type.String({ maxLength: 30000 })),
        path: Type.Optional(Type.String({ maxLength: 500 })),
        panel: Type.Optional(Type.Union([
          Type.Literal("browser"),
          Type.Literal("artifacts"),
          Type.Literal("images"),
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
        const researchBrowserBlocked = researchBrowserWorkspaceActionBlocked(
          action,
          isResearchActive?.() === true,
        );
        if (researchBrowserBlocked) throw new Error(researchBrowserBlocked);
        if (action === "list_reverse_artifacts" || action === "preview_reverse_artifact") {
          // 会话内数据，bridge 本地处理：与右栏「逆向产物」面板同源的
          // milksu-rea 调用收集（事件驱动 store），模型用它列举与预览。
          const artifacts = (typeof getReverseArtifacts === "function" ? getReverseArtifacts() : [])
            ?? [];
          if (action === "list_reverse_artifacts") {
            return {
              content: [{
                type: "text",
                text: JSON.stringify(artifacts.map(({ fullText, ...rest }) => rest)),
              }],
            };
          }
          const preview = previewReverseArtifactFromStore(artifacts, params.id ?? "");
          if (!preview) {
            throw new Error("Reverse artifact not found. Use list_reverse_artifacts to see ids.");
          }
          return {
            content: [{ type: "text", text: JSON.stringify(preview) }],
          };
        }
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
        const actionInput = action.includes("research_")
          ? Object.fromEntries(Object.entries(params).map(([key, value]) => {
            const operationalURL = key === "url"
              && (action === "open_research_browser_tab" || action === "record_research_source");
            return [key, typeof value === "string" && !operationalURL
              ? redactResearchText(value, process.env, getResearchSecrets?.() ?? [])
              : value];
          }))
          : params;
        const result = await requestAction({
          conversationId,
          action,
          input: actionInput,
          timeoutMs,
        });
        if (researchSessionActions.has(action)) {
          try {
            observeResearchAction?.({ conversationId, action, result });
          } catch {
            // A run projection must not turn a completed workspace action into an error.
          }
        }
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
