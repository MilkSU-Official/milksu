import assert from "node:assert/strict";
import test from "node:test";
import { COMPANION_CUSTOM_TYPES } from "./context-assembly.js";
import { createCompanionExtension } from "./extension.js";

function collectHandlers(factory) {
  const handlers = new Map();
  factory({
    on(event, handler) {
      handlers.set(event, handler);
    },
  });
  return handlers;
}

test("companion extension leaves compaction to Pi", async () => {
  const handlers = collectHandlers(createCompanionExtension());
  assert.equal(handlers.has("session_before_compact"), false);
});

test("companion extension replaces context with contracted order", async () => {
  const handlers = collectHandlers(createCompanionExtension({
    getSemanticMemories: () => [{ title: "Pref", markdown: "short answers" }],
    getBoardSnapshot: () => ({
      sessions: [{ id: "a", title: "coding", state: "running" }],
      todos: [],
    }),
    getEpisodicRecalls: () => [{ sessionId: "a", snippet: "compiled" }],
  }));
  const result = await handlers.get("context")({
    type: "context",
    messages: [
      { role: "user", content: [{ type: "text", text: "status" }] },
    ],
  });
  const order = result.messages.map(message => (
    message.role === "custom" ? message.customType : message.role
  ));
  assert.deepEqual(order, [
    COMPANION_CUSTOM_TYPES.semantic,
    COMPANION_CUSTOM_TYPES.episodic,
    "user",
  ]);
});

test("companion extension puts persona into system prompt, not messages", async () => {
  const handlers = collectHandlers(createCompanionExtension({
    getSystemPrompt: () => "You are the MilkSU companion.",
    getPersona: () => "Speak briefly.",
  }));
  const result = await handlers.get("before_agent_start")({ type: "before_agent_start" });
  assert.match(result.systemPrompt, /MilkSU companion/);
  assert.match(result.systemPrompt, /Speak briefly/);
});
