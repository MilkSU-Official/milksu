import { Type } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";

export const COMPANION_TOOL_NAMES = Object.freeze([
  "companion_board",
  "companion_dispatch",
  "companion_memory",
]);

export const FORBIDDEN_COMPANION_TOOL_NAMES = Object.freeze([
  "bash",
  "edit",
  "write",
  "read",
  "grep",
  "find",
  "ls",
  "mark_complete",
  "set_session_state",
  "companion_set_runtime",
]);

export function companionToolNames() {
  return [...COMPANION_TOOL_NAMES];
}

export function assertNoRuntimeWriteTools(names) {
  const forbidden = new Set(FORBIDDEN_COMPANION_TOOL_NAMES);
  for (const name of names) {
    if (forbidden.has(name)) {
      throw new Error(`companion tool set must not include ${name}`);
    }
  }
}

function hostResult(requestHost, action, input) {
  return requestHost(action, input);
}

export function createCompanionTools(requestHost) {
  if (typeof requestHost !== "function") {
    throw new Error("companion tools require a host request function");
  }

  const board = defineTool({
    name: "companion_board",
    label: "Companion board",
    description: "Read the live task board, or maintain user-intent todos. "
      + "Session run state is owned by MilkSU and cannot be written here. "
      + "Use list to see every conversation and todo. Use upsert_todo / close_todo "
      + "only for the user's own intended work items.",
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
      const result = await hostResult(requestHost, "board", params);
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        details: result,
      };
    },
  });

  const dispatch = defineTool({
    name: "companion_dispatch",
    label: "Companion dispatch",
    description: "Relay a user instruction into another MilkSU conversation. "
      + "speak requires conversationId and a unique idempotencyKey. "
      + "mode queue is the default. mode steer and stop require user confirmation. "
      + "Never invent a completion state; the host reports what actually happened.",
    parameters: Type.Object({
      action: Type.Union([
        Type.Literal("speak"),
        Type.Literal("create_conversation"),
        Type.Literal("stop"),
      ]),
      conversationId: Type.Optional(Type.String()),
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
      const result = await hostResult(requestHost, "dispatch", params);
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        details: result,
      };
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
      const result = await hostResult(requestHost, "memory", params);
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        details: result,
      };
    },
  });

  const tools = [board, dispatch, memory];
  assertNoRuntimeWriteTools(tools.map(tool => tool.name));
  return tools;
}
