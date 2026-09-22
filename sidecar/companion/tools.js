import { Type } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { formatBoardForModel } from "./context-assembly.js";
import {
  codingWorkspaceGuidance,
  codingWorkspaceNeedsConversation,
  codingWorkspaceToolName,
  codingWorkspaceToolParameters,
  normalizeCodingWorkspaceAction,
} from "../pi/bridge-workspace.js";

export const COMPANION_TOOL_NAMES = Object.freeze([
  "companion_board",
  "companion_dispatch",
  "companion_memory",
  "companion_app",
  codingWorkspaceToolName,
]);

// Upstream Pi built-ins. createAgentSession only activates listed names.
export const PI_COMPANION_TOOL_NAMES = Object.freeze([
  "read",
  "bash",
  "edit",
  "write",
  "grep",
  "find",
  "ls",
]);

export const FORBIDDEN_COMPANION_TOOL_NAMES = Object.freeze([
  "mark_complete",
  "set_session_state",
  "companion_set_runtime",
]);

export function companionToolNames() {
  return [...COMPANION_TOOL_NAMES];
}

export function companionSessionToolNames() {
  return [...new Set([...PI_COMPANION_TOOL_NAMES, ...COMPANION_TOOL_NAMES])];
}

export function assertNoRuntimeWriteTools(names) {
  const forbidden = new Set(FORBIDDEN_COMPANION_TOOL_NAMES);
  for (const name of names) {
    if (forbidden.has(name)) {
      throw new Error(`companion tool set must not include ${name}`);
    }
  }
}

const APP_CONFIRM_ACTIONS = new Set(["patch_settings", "quit", "relaunch"]);

/** Build a host failure message. Prefer throwing this so Pi marks isError. */
export function companionHostToolErrorMessage(error) {
  return error instanceof Error
    ? error.message
    : String(error || "companion host request failed");
}

async function runHostTool(requestHost, action, input, options) {
  try {
    const result = await requestHost(action, input, options);
    return {
      content: [{ type: "text", text: JSON.stringify(result) }],
      details: result,
    };
  } catch (error) {
    // Throw: Pi's agent-loop catches execute errors, writes an isError toolResult,
    // and continues thinking/tools. Do not cancelAll or abort the session here.
    throw new Error(companionHostToolErrorMessage(error));
  }
}

function dispatchNeedsConfirmPark(params) {
  const action = String(params?.action ?? "").trim();
  if (action === "stop") return true;
  if (action !== "speak" && action !== "speak_many") return false;
  return String(params?.mode ?? "").trim().toLowerCase() === "steer";
}

export function createCompanionTools(requestHost, options = {}) {
  if (typeof requestHost !== "function") {
    throw new Error("companion tools require a host request function");
  }
  const queryMemory = options.queryMemory;

  const board = defineTool({
    name: "companion_board",
    label: "Companion board",
    description: "Read the live task board, or maintain user-intent todos. "
      + "Session run state is owned by MilkSU and cannot be written here. "
      + "Call list when the user asks what is running, what is next, or which conversation to continue. "
      + "A greeting does not need a board read. "
      + "Use upsert_todo / close_todo only for the user's own intended work items.",
    parameters: Type.Object({
      action: Type.Union([
        Type.Literal("list"),
        Type.Literal("upsert_todo"),
        Type.Literal("close_todo"),
      ]),
      id: Type.Optional(Type.String()),
      title: Type.Optional(Type.String()),
      targetConversationId: Type.Optional(Type.String()),
      dependsOn: Type.Optional(Type.Array(Type.String())),
      note: Type.Optional(Type.String()),
      reason: Type.Optional(Type.String()),
    }),
    execute: async (_toolCallId, params) => {
      const result = await runHostTool(requestHost, "board", params);
      const text = formatBoardForModel(result.details);
      if (!text) return result;
      return {
        content: [{ type: "text", text }],
        details: result.details,
      };
    },
  });

  const dispatch = defineTool({
    name: "companion_dispatch",
    label: "Companion dispatch",
    description: "Relay a user instruction into another MilkSU conversation. "
      + "Prefer this for research and long execution instead of running that work in the companion itself. "
      + "For investigation, tell the target conversation to use its subagent into Working, then discuss results after Working returns. "
      + "For landing or packaging work, create_conversation or steer an existing conversation. "
      + "Call this tool immediately. Do not ask the user to confirm in chat first. "
      + "speak requires conversationId and a unique idempotencyKey. "
      + "mode queue is the default. "
      + "speak_many sends the same text to at most 8 conversationIds. "
      + "For stop, steer, or speak_many in steer mode, call the tool now; the host shows a confirm button and reports what actually happened. "
      + "Idle targets still need the tool call. Never invent a completion state.",
    parameters: Type.Object({
      action: Type.Union([
        Type.Literal("speak"),
        Type.Literal("speak_many"),
        Type.Literal("create_conversation"),
        Type.Literal("stop"),
      ]),
      conversationId: Type.Optional(Type.String()),
      conversationIds: Type.Optional(Type.Array(Type.String())),
      text: Type.Optional(Type.String()),
      idempotencyKey: Type.Optional(Type.String()),
      mode: Type.Optional(Type.Union([
        Type.Literal("queue"),
        Type.Literal("steer"),
      ])),
      kind: Type.Optional(Type.String()),
      workspacePath: Type.Optional(Type.String()),
      title: Type.Optional(Type.String()),
      firstMessage: Type.Optional(Type.String()),
    }),
    execute: async (_toolCallId, params) => {
      // Confirm-parked actions wait like main-chat approvalBroker (no timeout).
      // Everything else uses the host broker default, same as workspace_action.
      const hostOptions = dispatchNeedsConfirmPark(params) ? { timeoutMs: 0 } : undefined;
      return runHostTool(requestHost, "dispatch", params, hostOptions);
    },
  });

  const memory = defineTool({
    name: "companion_memory",
    label: "Companion memory",
    description: "Search or recall session evidence, or propose a durable memory. "
      + "search and recall are read-only. propose_memory only creates a pending "
      + "proposal; it does not write a durable memory. forget archives an approved memory.",
    parameters: Type.Object({
      action: Type.Union([
        Type.Literal("search"),
        Type.Literal("recall"),
        Type.Literal("propose_memory"),
        Type.Literal("forget"),
      ]),
      query: Type.Optional(Type.String()),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
      scope: Type.Optional(Type.String()),
      sessionId: Type.Optional(Type.String()),
      cursor: Type.Optional(Type.String()),
      title: Type.Optional(Type.String()),
      markdown: Type.Optional(Type.String()),
      sourceSessionIds: Type.Optional(Type.Array(Type.String())),
      memoryId: Type.Optional(Type.String()),
    }),
    execute: async (_toolCallId, params) => {
      const action = String(params?.action ?? "").trim();
      if ((action === "search" || action === "recall") && typeof queryMemory === "function") {
        try {
          const result = await Promise.race([
            queryMemory(params),
            new Promise((_, reject) => {
              setTimeout(() => {
                reject(new Error("companion host request timed out (memory)"));
              }, 8_000);
            }),
          ]);
          return {
            content: [{ type: "text", text: JSON.stringify(result) }],
            details: result,
          };
        } catch (error) {
          throw new Error(companionHostToolErrorMessage(error));
        }
      }
      return runHostTool(requestHost, "memory", params);
    },
  });

  const app = defineTool({
    name: "companion_app",
    label: "Companion app",
    description: "Operate MilkSU itself when the user asks you to, or when no conversation should own the job. "
      + "Prefer companion_dispatch for work that belongs in a conversation. "
      + "open_main_window and focus_conversation show the main window. "
      + "read_conversation returns a short user/assistant excerpt, not the full transcript. "
      + "get_settings returns non-credential settings only. "
      + "patch_settings, quit, and relaunch call the tool immediately; the host shows a confirm button. "
      + "Never read or write API keys, tokens, or relay secrets. Never write session run state.",
    parameters: Type.Object({
      action: Type.Union([
        Type.Literal("open_main_window"),
        Type.Literal("focus_conversation"),
        Type.Literal("read_conversation"),
        Type.Literal("get_settings"),
        Type.Literal("patch_settings"),
        Type.Literal("quit"),
        Type.Literal("relaunch"),
      ]),
      conversationId: Type.Optional(Type.String()),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 8 })),
      patch: Type.Optional(Type.Record(
        Type.String(),
        Type.Union([Type.String(), Type.Boolean(), Type.Number()]),
      )),
    }),
    execute: async (_toolCallId, params) => {
      const action = String(params?.action ?? "").trim();
      const hostOptions = APP_CONFIRM_ACTIONS.has(action) ? { timeoutMs: 0 } : undefined;
      return runHostTool(requestHost, "app", params, hostOptions);
    },
  });

  const workspace = defineTool({
    name: codingWorkspaceToolName,
    label: "MilkSU workspace",
    description: `${codingWorkspaceGuidance()} `
      + "From the Companion, file conversation, lab, CVE, and CTF records with list_records or search_records, then archive_records, restore_records, pin_records, fork_record, update_record, or focus_record using those ids. "
      + "list_records can filter by workspacePath, unpinned, or olderThanDays. "
      + "fork_record clones the product row without the transcript. "
      + "delete_records waits for the user to confirm the titles. "
      + "Record actions do not need conversationId. "
      + "Browser, terminal, artifact, panel, background task, worktree, and Computer Use lock actions require the target conversationId. "
      + "compact_context stays on that conversation. "
      + "Do not change settings, credentials, or approval policy.",
    parameters: codingWorkspaceToolParameters({ conversationId: true }),
    execute: async (_toolCallId, params) => {
      const action = normalizeCodingWorkspaceAction(params?.action);
      if (!action) throw new Error("unknown milksu_workspace action");
      if (action === "compact_context") {
        throw new Error("compact_context stays on that conversation's milksu_workspace");
      }
      const conversationId = String(params?.conversationId ?? "").trim();
      if (codingWorkspaceNeedsConversation(action) && !conversationId) {
        throw new Error(`milksu_workspace ${action} requires conversationId`);
      }
      const hostOptions = action === "delete_records"
        ? { timeoutMs: 0 }
        : action === "prepare_coding_worktree"
          ? { timeoutMs: 300_000 }
          : action === "lock_computer_use_window"
            ? { timeoutMs: 90_000 }
            : undefined;
      return runHostTool(requestHost, "workspace", params, hostOptions);
    },
  });

  const tools = [board, dispatch, memory, app, workspace];
  assertNoRuntimeWriteTools(tools.map(tool => tool.name));
  return tools;
}
