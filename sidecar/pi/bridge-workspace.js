import { Type } from "typebox";

export const codingWorkspaceToolName = "milksu_workspace";

export const codingWorkspaceReadActions = Object.freeze([
  "list_browser_tabs",
  "list_artifacts",
  "preview_artifact",
  "show_panel",
]);

export const codingWorkspaceMutatingActions = Object.freeze([
  "focus_browser_tab",
  "open_browser_tab",
  "close_browser_tab",
  "close_all_browser_tabs",
  "reveal_artifacts",
]);

const workspaceActions = new Set([
  ...codingWorkspaceReadActions,
  ...codingWorkspaceMutatingActions,
]);

const workspacePanels = new Set(["browser", "artifacts", "changes", "environment"]);

export function codingWorkspaceGuidance() {
  return [
    "Use milksu_workspace to operate the Coding desktop the way the user would.",
    "List browser tabs, then focus one by tabId (or a unique title/url query) before milksu-playwright clicks.",
    "Close one tab or close_all_browser_tabs when the user wants the right-hand pages gone.",
    "List or preview workspace artifacts and show_panel to open 产物 / 浏览器 / 变更.",
    "Do not scan the user message for keywords; choose these typed actions from the request.",
    "Do not change Settings, credentials, approval policy, Computer Use scope, or the user's real Chrome.",
  ].join(" ");
}

export function normalizeCodingWorkspaceAction(value) {
  const action = String(value ?? "").trim();
  return workspaceActions.has(action) ? action : "";
}

export function codingWorkspaceActionBlocked(action, policy = {}) {
  const normalized = normalizeCodingWorkspaceAction(action);
  if (!normalized) return "MilkSU rejected an unknown Coding workspace action.";
  if (codingWorkspaceReadActions.includes(normalized)) return "";
  if (policy.executionMode !== "go" || policy.approvalPolicy === "read-only") {
    return "Plan 或只读策略不能改动 Coding 界面。先列出标签或产物。";
  }
  return "";
}

export function formatCodingWorkspaceInput(input) {
  const action = normalizeCodingWorkspaceAction(input?.action);
  if (!action) return "";
  return [
    action,
    input?.tabId ? `标签 ${String(input.tabId).trim()}` : "",
    input?.query ? `查询 ${String(input.query).trim()}` : "",
    input?.url ? `地址 ${String(input.url).trim()}` : "",
    input?.path ? `产物 ${String(input.path).trim()}` : "",
    input?.panel && workspacePanels.has(input.panel) ? `面板 ${input.panel}` : "",
  ].filter(Boolean).join(" · ");
}

export function createWorkspaceActionBroker(emit, createID = () => crypto.randomUUID()) {
  const pending = new Map();

  return {
    request({ conversationId, action, input }) {
      const requestID = createID();
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          if (!pending.has(requestID)) return;
          pending.delete(requestID);
          reject(new Error("Coding workspace action timed out"));
        }, 25_000);
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

export function createCodingWorkspaceExtension(conversationId, getPolicy, requestAction) {
  return (pi) => {
    pi.registerTool({
      name: codingWorkspaceToolName,
      label: "MilkSU workspace",
      description: "Operate the MilkSU Coding desktop: list/focus/close isolated browser tabs, list/preview artifacts, and open the right-hand 浏览器 / 产物 / 变更 panels. Use this when the user wants the UI itself changed, then use milksu-playwright on the focused tab.",
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
        ])),
      }),
      async execute(_toolCallId, params) {
        const action = normalizeCodingWorkspaceAction(params.action);
        const blocked = codingWorkspaceActionBlocked(action, getPolicy?.());
        if (blocked) throw new Error(blocked);
        const result = await requestAction({
          conversationId,
          action,
          input: params,
        });
        return {
          content: [{ type: "text", text: result || `${action} completed` }],
        };
      },
    });
  };
}
