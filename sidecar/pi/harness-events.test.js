import assert from "node:assert/strict";
import test from "node:test";
import { createHarnessEventProjector } from "./harness-events.js";

function assistantMessage(content, extra = {}) {
  return {
    role: "assistant",
    content: Array.isArray(content) ? content : [{ type: "text", text: content }],
    api: "openai-completions",
    provider: "faux",
    model: "faux-1",
    usage: {
      input: 11,
      output: 7,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 18,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: 1790000000000,
    ...extra,
  };
}

function assistantEntry(message) {
  return { id: 42, kind: "pi.assistant", model: [message] };
}

function toolResultEntry({ toolCallId, toolName, text, isError }) {
  return {
    id: 43,
    kind: "pi.tool-result",
    model: [{
      role: "toolResult",
      toolCallId,
      toolName,
      content: [{ type: "text", text }],
      isError: Boolean(isError),
      timestamp: 1790000000000,
    }],
  };
}

test("run boundaries project to turn events", () => {
  const projector = createHarnessEventProjector();
  assert.deepEqual(projector.project({ type: "run_start", inputs: [3] }), [
    { type: "turn_started", data: {} },
  ]);
  assert.deepEqual(projector.project({ type: "run_end", inputs: [3] }), [
    { type: "turn_settled", data: {} },
  ]);
  assert.deepEqual(projector.project({ type: "turn_start" }), []);
  assert.deepEqual(projector.project({ type: "turn_end" }), []);
});

test("streamed text and thinking project to delta events and a single thinking_done", () => {
  const projector = createHarnessEventProjector();
  const events = [
    ...projector.project({ type: "message_start", message: assistantMessage([]) }),
    ...projector.project({
      type: "message_update",
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2 },
      changes: [
        { type: "thinking_start", contentIndex: 0, block: { type: "thinking", thinking: "" } },
        { type: "thinking_delta", contentIndex: 0, delta: "hmm " },
        { type: "thinking_delta", contentIndex: 0, delta: "hmm" },
        { type: "text_start", contentIndex: 1, block: { type: "text", text: "" } },
        { type: "text_delta", contentIndex: 1, delta: "answer" },
      ],
    }),
    ...projector.project({
      type: "message_end",
      entry: assistantEntry(assistantMessage([
        { type: "thinking", thinking: "hmm hmm" },
        { type: "text", text: "answer" },
      ])),
    }),
  ];
  const types = events.map(event => event.type);
  assert.deepEqual(types, [
    "thinking_start",
    "thinking_delta",
    "thinking_delta",
    "text_delta",
    // pi-durable 无 thinking_end：由投影器在 message_end 合成一次（不与
    // projectAssistantMessageEnd 的补发重复）。
    "thinking_done",
    "message_done",
    "usage_recorded",
  ]);
  const thinkingDone = events.find(event => event.type === "thinking_done");
  assert.equal(thinkingDone.data.content, "hmm hmm");
  const messageDone = events.find(event => event.type === "message_done");
  assert.equal(messageDone.data.content, "answer");
  assert.equal(messageDone.data.reason, "stop");
});

test("unstreamed thinking is still surfaced once at message end", () => {
  const projector = createHarnessEventProjector();
  const events = [
    ...projector.project({ type: "message_start", message: assistantMessage([]) }),
    ...projector.project({
      type: "message_end",
      entry: assistantEntry(assistantMessage([
        { type: "thinking", thinking: "considered" },
        { type: "text", text: "final" },
      ])),
    }),
  ];
  const thinkingDone = events.filter(event => event.type === "thinking_done");
  assert.equal(thinkingDone.length, 1);
  assert.equal(thinkingDone[0].data.content, "considered");
});

test("tool call families project to tool_call_start/progress/end", async () => {
  const projector = createHarnessEventProjector();
  const start = projector.project({
    type: "tool_execution_start",
    toolCallId: "call-1",
    toolName: "bash",
    args: { command: "ls" },
  });
  assert.deepEqual(start, [{
    type: "tool_call_start",
    data: {
      toolCallId: "call-1",
      toolName: "bash",
      content: "{\"command\":\"ls\"}",
      module: "coding",
    },
  }]);

  const progress = projector.project({
    type: "tool_execution_update",
    toolCallId: "call-1",
    toolName: "bash",
    output: { append: "running\n" },
  });
  assert.deepEqual(progress, [{
    type: "tool_call_progress",
    data: { toolCallId: "call-1", toolName: "bash", module: "coding" },
  }]);

  await new Promise(resolve => setTimeout(resolve, 5));
  const end = projector.project({
    type: "tool_execution_end",
    toolCallId: "call-1",
    toolName: "bash",
    entry: toolResultEntry({
      toolCallId: "call-1",
      toolName: "bash",
      text: "file-a\nfile-b",
      isError: false,
    }),
  });
  assert.equal(end[0].type, "tool_call_end");
  assert.equal(end[0].data.content, "file-a\nfile-b");
  assert.equal(end[0].data.isError, false);
  assert.ok(end[0].data.durationMs >= 0, "durationMs comes from the tracked start time");
  assert.deepEqual(projector.pendingTools(), []);

  // entry 缺席（任务 fault/orphaned）也必须收尾，content 为空串。
  const orphan = projector.project({
    type: "tool_execution_start",
    toolCallId: "call-2",
    toolName: "bash",
    args: {},
  });
  assert.equal(orphan[0].type, "tool_call_start");
  const orphanEnd = projector.project({
    type: "tool_execution_end",
    toolCallId: "call-2",
    toolName: "bash",
  });
  assert.equal(orphanEnd[0].type, "tool_call_end");
  assert.equal(orphanEnd[0].data.content, "");
  assert.equal(orphanEnd[0].data.isError, false);
});

test("task_failed projects to an error event", () => {
  const projector = createHarnessEventProjector();
  const events = projector.project({
    type: "task_failed",
    taskId: 7,
    kind: "pi.tool",
    message: "executor crashed",
  });
  assert.deepEqual(events, [{
    type: "error",
    data: { error: "Task pi.tool 7 failed: executor crashed" },
  }]);
});

test("deferred families project to nothing in the minimal glue", () => {
  const projector = createHarnessEventProjector();
  for (const event of [
    { type: "snapshot", entries: [], tools: [], compactions: [], inbox: [], agent: {}, usage: {} },
    { type: "inbox_update", items: [{ id: 5, mode: "followUp" }] },
    { type: "submission", record: { id: 5, status: "queued" } },
    { type: "auto_retry_start", attempt: 1, at: 1, errorMessage: "x" },
    { type: "auto_retry_end", attempt: 1 },
    { type: "entry_appended", entry: { id: 1 } },
    { type: "agent_changed", agent: {} },
    { type: "usage_changed", usage: {} },
    { type: "compaction_start", taskId: 2, reason: "auto", blocking: true },
    { type: "compaction_end", taskId: 2, reason: "auto" },
    { type: "deferred_poll", pollAt: 1 },
    { type: "unknown_future_event" },
  ]) {
    assert.deepEqual(projector.project(event), [], `no projection for ${event.type}`);
  }
});

test("projectBatch keeps intra-batch order across families", () => {
  const projector = createHarnessEventProjector();
  const batch = [
    { type: "message_start", message: assistantMessage([]) },
    { type: "message_update", usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2 }, changes: [
      { type: "text_delta", contentIndex: 0, delta: "part " },
    ] },
    { type: "message_update", usage: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 3 }, changes: [
      { type: "text_delta", contentIndex: 0, delta: "two" },
    ] },
    { type: "tool_execution_start", toolCallId: "c", toolName: "read", args: { path: "x" } },
    { type: "tool_execution_update", toolCallId: "c", toolName: "read" },
    { type: "tool_execution_end", toolCallId: "c", toolName: "read", entry: toolResultEntry({
      toolCallId: "c", toolName: "read", text: "ok", isError: false,
    }) },
    { type: "message_end", entry: assistantEntry(assistantMessage([
      { type: "text", text: "let me read it" },
      { type: "toolCall", name: "read", arguments: { path: "x" }, id: "c" },
    ], { stopReason: "toolUse" })) },
  ];
  const types = projector.projectBatch(batch).map(event => event.type);
  assert.deepEqual(types, [
    "text_delta",
    "text_delta",
    "tool_call_start",
    "tool_call_progress",
    "tool_call_end",
    // 有工具调用的 assistant 收尾 → message_segment_done（与 bridge 现状同形）。
    "message_segment_done",
    "usage_recorded",
  ]);
});

test("module and usage attribution flow through the options", () => {
  const ctf = createHarnessEventProjector({ module: "ctf", conversationId: "conv-1", provider: "milksu-account" });
  const events = ctf.project({
    type: "message_end",
    entry: assistantEntry(assistantMessage("done", { model: "deepseek/deepseek-v4-flash" })),
  });
  const usage = events.find(event => event.type === "usage_recorded");
  assert.equal(usage.data.module, "ctf");
  assert.equal(usage.data.usage.module, "ctf");
  assert.equal(usage.data.usage.provider, "milksu-account");
  assert.equal(usage.data.usage.inputTokens, 11);
  const toolStart = ctf.project({
    type: "tool_execution_start",
    toolCallId: "c",
    toolName: "bash",
    args: {},
  });
  assert.equal(toolStart[0].data.module, "ctf");
});
