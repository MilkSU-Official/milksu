import assert from "node:assert/strict";
import test from "node:test";
import { createApprovalBroker } from "./bridge-approval.js";

test("choice broker waits for a selected option", async () => {
  const events = [];
  const broker = createApprovalBroker(
    (id, type, data) => events.push({ id, type, ...data }),
    () => "ask-1",
  );
  const decision = broker.requestChoice({
    conversationId: "conversation-1",
    question: "How many flavors should we launch?",
    options: [
      { id: "three", label: "Three (core line)" },
      { id: "five", label: "Five (full case)" },
    ],
  });
  assert.equal(events[0].toolName, "milksu_ask");
  broker.respond({
    conversationId: "conversation-1",
    requestId: "ask-1",
    approved: true,
    choice: "five",
  });
  assert.deepEqual(await decision, { id: "five", label: "Five (full case)" });
  assert.equal(events[1].choice, "five");
});

test("choice broker rejects an unknown option and dismisses to null", async () => {
  const events = [];
  const broker = createApprovalBroker(
    (id, type, data) => events.push({ id, type, ...data }),
    () => "ask-2",
  );
  const decision = broker.requestChoice({
    conversationId: "conversation-1",
    question: "Pick one",
    options: [
      { id: "a", label: "A" },
      { id: "b", label: "B" },
    ],
  });
  assert.throws(
    () => broker.respond({
      conversationId: "conversation-1",
      requestId: "ask-2",
      approved: true,
      choice: "missing",
    }),
    /Unknown MilkSU choice/,
  );
  broker.respond({
    conversationId: "conversation-1",
    requestId: "ask-2",
    approved: false,
  });
  assert.equal(await decision, null);
  assert.equal(events.at(-1).approved, false);
});

test("approval broker pauses a tool until the matching desktop response", async () => {
  const events = [];
  const broker = createApprovalBroker(
    (id, type, data) => events.push({ id, type, ...data }),
    () => "approval-1",
  );
  const decision = broker.request({
    conversationId: "conversation-1",
    toolName: "edit",
    content: "src/app.js",
    input: '{"path":"src/app.js"}',
  });
  assert.equal(broker.pendingCount(), 1);
  assert.deepEqual(events[0], {
    id: "conversation-1",
    type: "approval_requested",
    requestId: "approval-1",
    toolName: "edit",
    content: "src/app.js",
    input: '{"path":"src/app.js"}',
  });

  broker.respond({
    conversationId: "conversation-1",
    requestId: "approval-1",
    approved: true,
  });
  assert.equal(await decision, true);
  assert.equal(broker.pendingCount(), 0);
  assert.equal(events[1].type, "approval_resolved");
  assert.equal(events[1].approved, true);
});

test("approval broker rejects mismatched responses and expires pending requests", async () => {
  const events = [];
  const broker = createApprovalBroker(
    (id, type, data) => events.push({ id, type, ...data }),
    () => "approval-2",
  );
  const decision = broker.request({
    conversationId: "conversation-1",
    toolName: "bash",
    content: "$ npm test",
    input: '{"command":"npm test"}',
  });
  assert.throws(
    () => broker.respond({
      conversationId: "another-conversation",
      requestId: "approval-2",
      approved: true,
    }),
    /Unknown MilkSU approval request/,
  );
  broker.cancelConversation("conversation-1", "turn aborted");
  assert.equal(await decision, false);
  assert.equal(events.at(-1).reason, "turn aborted");
});

test("approval broker expires every pending request when the approval channel closes", async () => {
  const events = [];
  const ids = ["approval-a", "approval-b", "approval-c"];
  const broker = createApprovalBroker(
    (id, type, data) => events.push({ id, type, ...data }),
    () => ids.shift(),
  );

  const decisions = [
    broker.request({
      conversationId: "conversation-a",
      toolName: "bash",
      content: "$ npm test",
      input: '{"command":"npm test"}',
    }),
    broker.request({
      conversationId: "conversation-b",
      toolName: "browser_click",
      content: "Click #submit",
      input: '{"selector":"#submit"}',
    }),
    broker.request({
      conversationId: "conversation-b",
      toolName: "computer_use",
      content: "Click visible app button",
      input: '{"windowId":"win-1"}',
    }),
  ];

  assert.equal(broker.pendingCount(), 3);
  broker.cancelAll("app restarted");

  assert.deepEqual(await Promise.all(decisions), [false, false, false]);
  assert.equal(broker.pendingCount(), 0);
  assert.deepEqual(
    events
      .filter((event) => event.type === "approval_resolved")
      .map((event) => [event.id, event.requestId, event.approved, event.reason]),
    [
      ["conversation-a", "approval-a", false, "app restarted"],
      ["conversation-b", "approval-b", false, "app restarted"],
      ["conversation-b", "approval-c", false, "app restarted"],
    ],
  );
  assert.throws(
    () => broker.respond({
      conversationId: "conversation-a",
      requestId: "approval-a",
      approved: true,
    }),
    /Unknown MilkSU approval request/,
  );
});

test("conversation grant skips later matching approvals and ignores paid or account tools", async () => {
  const events = [];
  const ids = ["approval-browser-1", "approval-image"];
  const broker = createApprovalBroker(
    (id, type, data) => events.push({ id, type, ...data }),
    () => ids.shift(),
  );

  const first = broker.request({
    conversationId: "conversation-1",
    toolName: "mcp:milksu-playwright",
    content: "隔离 Coding Browser · 工具 browser_click",
    input: '{"tool":"browser_click"}',
    grantKey: "mcp:milksu-playwright",
  });
  assert.equal(events[0].grantable, true);
  broker.respond({
    conversationId: "conversation-1",
    requestId: "approval-browser-1",
    approved: true,
    scope: "conversation",
  });
  assert.equal(await first, true);
  assert.equal(events[1].reason, "approved for this conversation");

  const second = await broker.request({
    conversationId: "conversation-1",
    toolName: "mcp:milksu-playwright",
    content: "隔离 Coding Browser · 工具 browser_navigate",
    input: '{"tool":"browser_navigate"}',
    grantKey: "mcp:milksu-playwright",
  });
  assert.equal(second, true);
  assert.equal(events.filter(event => event.type === "approval_requested").length, 1);

  const imageGen = broker.request({
    conversationId: "conversation-1",
    toolName: "imagegen",
    content: "生成图片",
    input: '{"prompt":"icon"}',
  });
  assert.equal(events.at(-1).grantable, undefined);
  broker.respond({
    conversationId: "conversation-1",
    requestId: "approval-image",
    approved: true,
    scope: "conversation",
  });
  assert.equal(await imageGen, true);
  assert.equal(events.at(-1).reason, "approved by user");
});
