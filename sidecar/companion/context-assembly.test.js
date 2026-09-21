import assert from "node:assert/strict";
import test from "node:test";
import {
  ASSEMBLY_BUDGETS,
  ASSEMBLY_SEGMENTS,
  COMPANION_CUSTOM_TYPES,
  assembleCompanionMessages,
  composeSystemPrompt,
  estimateTokens,
  handleSessionBeforeCompact,
  stripCompanionCustomMessages,
} from "./context-assembly.js";

function userMessage(text) {
  return { role: "user", content: [{ type: "text", text }] };
}

function assistantMessage(text) {
  return { role: "assistant", content: [{ type: "text", text }] };
}

test("assembly order keeps stable segments before volatile ones", () => {
  const assembled = assembleCompanionMessages({
    semanticMemories: [{ title: "Name", markdown: "Call the user MilkSU." }],
    recentMessages: [userMessage("status?"), assistantMessage("checking")],
    boardSnapshot: {
      sessions: [{ id: "c1", title: "milksu", state: "running" }],
      todos: [{ id: "t1", title: "run tests" }],
    },
    episodicRecalls: [{ sessionId: "c1", snippet: "last turn compiled" }],
    currentUserMessage: userMessage("what is running?"),
  });

  assert.deepEqual(assembled.order, [
    COMPANION_CUSTOM_TYPES.semantic,
    "user",
    "assistant",
    COMPANION_CUSTOM_TYPES.board,
    COMPANION_CUSTOM_TYPES.episodic,
    "user",
  ]);
  assert.deepEqual(
    assembled.segments.map(segment => segment.id),
    ["semantic", "recent", "board", "episodic", "user"],
  );
  assert.ok(ASSEMBLY_SEGMENTS.includes("system"));
});

test("reassembly strips previously injected companion custom messages", () => {
  const previous = assembleCompanionMessages({
    semanticMemories: [{ title: "Old", markdown: "stale" }],
    recentMessages: [userMessage("hi")],
    boardSnapshot: { sessions: [], todos: [] },
  });
  const next = assembleCompanionMessages({
    semanticMemories: [{ title: "New", markdown: "fresh" }],
    recentMessages: [...previous.messages, assistantMessage("ok")],
    boardSnapshot: { sessions: [], todos: [] },
  });
  const customTypes = next.messages
    .filter(message => message.role === "custom")
    .map(message => message.customType);
  assert.equal(customTypes.filter(type => type === COMPANION_CUSTOM_TYPES.semantic).length, 1);
  assert.equal(stripCompanionCustomMessages(previous.messages).length, 1);
});

test("empty assistant turns are stripped so later prompts are not poisoned", () => {
  const assembled = assembleCompanionMessages({
    recentMessages: [
      {
        role: "user",
        content: [
          { type: "text", text: "看图" },
          { type: "image", mimeType: "image/jpeg", data: "R0lGODlh" },
        ],
      },
      { role: "assistant", content: [], stopReason: "stop" },
      userMessage("hi"),
    ],
  });
  assert.deepEqual(
    assembled.messages.filter(message => message.role === "assistant"),
    [],
  );
  const users = assembled.messages.filter(message => message.role === "user");
  assert.deepEqual(users[0].content, [{ type: "text", text: "看图" }]);
  assert.equal(users.at(-1).content[0].text, "hi");
});

test("keeps tool-call assistants and drops orphaned tool results", () => {
  const assembled = assembleCompanionMessages({
    recentMessages: [
      {
        role: "user",
        content: [
          { type: "text", text: "看图" },
          { type: "image", mimeType: "image/png", data: "iVBORw0KGgo" },
        ],
      },
      {
        role: "assistant",
        content: [{ type: "toolCall", id: "call-1", name: "read", arguments: { path: "a.png" } }],
        stopReason: "toolUse",
      },
      {
        role: "toolResult",
        toolCallId: "call-1",
        content: [{ type: "text", text: "Read image file [image/png]" }],
      },
      { role: "assistant", content: [], stopReason: "stop" },
      {
        role: "toolResult",
        toolCallId: "orphan",
        content: [{ type: "text", text: "stale" }],
      },
      userMessage("hi"),
    ],
  });
  const roles = assembled.messages
    .filter(message => message.role !== "custom")
    .map(message => message.role);
  assert.deepEqual(roles, ["user", "assistant", "toolResult", "user"]);
  assert.equal(
    assembled.messages.find(message => message.role === "assistant")?.content[0].name,
    "read",
  );
  assert.deepEqual(
    assembled.messages.find(message => message.role === "user")?.content,
    [{ type: "text", text: "看图" }],
  );
});

test("repairs unfinished toolCalls before a following user message", () => {
  const assembled = assembleCompanionMessages({
    recentMessages: [
      userMessage("先读一下"),
      {
        role: "assistant",
        content: [{ type: "toolCall", id: "call-2", name: "bash", arguments: { command: "ls" } }],
        stopReason: "toolUse",
      },
      // Abort left no toolResult; next user must still be sendable.
      userMessage("继续"),
    ],
  });
  const roles = assembled.messages
    .filter(message => message.role !== "custom")
    .map(message => message.role);
  assert.deepEqual(roles, ["user", "assistant", "toolResult", "user"]);
  const repaired = assembled.messages.find(message => message.role === "toolResult");
  assert.equal(repaired?.toolCallId, "call-2");
  assert.equal(repaired?.isError, true);
});

test("board segment is never dropped when over budget", () => {
  const sessions = Array.from({ length: 80 }, (_, index) => ({
    id: `session-${index}`,
    title: `session ${index} ${"x".repeat(200)}`,
    state: "idle",
  }));
  const assembled = assembleCompanionMessages({
    recentMessages: [userMessage("board?")],
    boardSnapshot: { sessions, todos: [] },
  });
  const board = assembled.messages.find(
    message => message.customType === COMPANION_CUSTOM_TYPES.board,
  );
  assert.ok(board, "board custom message must remain");
  const boardSegment = assembled.segments.find(segment => segment.id === "board");
  assert.ok(boardSegment.tokens <= ASSEMBLY_BUDGETS.board);
  assert.equal(boardSegment.truncated, true);
  assert.ok(boardSegment.tokens > 0);
});

test("recent history is trimmed oldest-first", () => {
  const recentMessages = [];
  for (let index = 0; index < 40; index += 1) {
    recentMessages.push(userMessage(`turn ${index} ${"y".repeat(6000)}`));
    recentMessages.push(assistantMessage(`reply ${index} ${"z".repeat(6000)}`));
  }
  const assembled = assembleCompanionMessages({ recentMessages });
  const recent = assembled.segments.find(segment => segment.id === "recent");
  assert.ok(recent.tokens <= ASSEMBLY_BUDGETS.recent);
  assert.equal(recent.truncated, true);
  const users = assembled.messages.filter(message => message.role === "user");
  assert.ok(users.at(-1).content[0].text.startsWith("turn 39"));
});

test("system prompt is budgeted independently of messages", () => {
  const composed = composeSystemPrompt({
    base: "You are the MilkSU companion.",
    persona: "x".repeat(30_000),
  });
  assert.ok(composed.tokens <= ASSEMBLY_BUDGETS.system);
  assert.equal(composed.truncated, true);
  assert.ok(composed.text.startsWith("You are the MilkSU companion."));
});

test("session_before_compact always cancels Pi default compaction", () => {
  assert.deepEqual(handleSessionBeforeCompact(), { cancel: true });
});

test("token estimate uses Pi chars/4 heuristic", () => {
  assert.equal(estimateTokens("abcd"), 1);
  assert.equal(estimateTokens("abcde"), 2);
});
