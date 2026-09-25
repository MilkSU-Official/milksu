import test from "node:test";
import assert from "node:assert/strict";

import { answerDecisionQuery } from "./query.js";

test("answers with the model's visible text", async () => {
  const events = [];
  await answerDecisionQuery(
    { id: "dq-1", systemPrompt: "只回数。", prompt: "0 到 1 的概率？" },
    {
      emitEvent: (type, data) => events.push([type, data]),
      complete: async context => {
        assert.equal(context.systemPrompt, "只回数。");
        assert.equal(context.messages[0].content[0].text, "0 到 1 的概率？");
        return { content: [{ type: "text", text: "0.4" }] };
      },
      readText: message => message.content.map(block => block.text).join(""),
    },
  );
  assert.deepEqual(events, [["decision_answer", { id: "dq-1", text: "0.4" }]]);
});

test("failure answers with error so the layer keeps its fail-open", async () => {
  const events = [];
  await answerDecisionQuery(
    { id: "dq-2", prompt: "问题" },
    {
      emitEvent: (type, data) => events.push([type, data]),
      complete: async () => {
        throw new Error("model down");
      },
    },
  );
  assert.deepEqual(events, [["decision_answer", { id: "dq-2", error: "model down" }]]);
});

test("missing id or completer answers nothing usable", async () => {
  const events = [];
  await answerDecisionQuery(
    { prompt: "问题" },
    { emitEvent: (type, data) => events.push([type, data]), complete: async () => ({}) },
  );
  assert.deepEqual(events, []);

  await answerDecisionQuery(
    { id: "dq-3", prompt: "问题" },
    { emitEvent: (type, data) => events.push([type, data]) },
  );
  assert.deepEqual(events, [["decision_answer", { id: "dq-3", error: "model completer is not wired" }]]);
});
