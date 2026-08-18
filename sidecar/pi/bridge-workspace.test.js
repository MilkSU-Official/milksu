import assert from "node:assert/strict";
import test from "node:test";

import {
  codingWorkspaceActionBlocked,
  codingWorkspaceGuidance,
  codingWorkspaceToolName,
  createCodingWorkspaceExtension,
  createWorkspaceActionBroker,
  formatCodingWorkspaceInput,
  normalizeCodingWorkspaceAction,
  describeWorkspaceCompaction,
  queueWorkspaceCompaction,
  runQueuedWorkspaceCompaction,
} from "./bridge-workspace.js";

test("workspace tool rejects unknown actions and plan mutations", () => {
  assert.equal(codingWorkspaceToolName, "milksu_workspace");
  assert.equal(normalizeCodingWorkspaceAction("focus_browser_tab"), "focus_browser_tab");
  assert.equal(normalizeCodingWorkspaceAction("delete_everything"), "");
  assert.equal(codingWorkspaceActionBlocked("list_browser_tabs", {
    executionMode: "plan",
    approvalPolicy: "workspace-auto",
  }), "");
  assert.match(
    codingWorkspaceActionBlocked("close_all_browser_tabs", {
      executionMode: "plan",
      approvalPolicy: "workspace-auto",
    }),
    /只读|Plan/,
  );
  assert.equal(codingWorkspaceActionBlocked("focus_browser_tab", {
    executionMode: "go",
    approvalPolicy: "workspace-auto",
  }), "");
  assert.equal(codingWorkspaceActionBlocked("list_status", {
    executionMode: "plan",
    approvalPolicy: "workspace-auto",
  }), "");
  assert.equal(codingWorkspaceActionBlocked("compact_context", {
    executionMode: "plan",
    approvalPolicy: "workspace-auto",
  }), "");
});

test("workspace guidance tells the model to use typed UI actions", () => {
  assert.match(codingWorkspaceGuidance(), /milksu_workspace/);
  assert.match(codingWorkspaceGuidance(), /tabId/);
  assert.match(codingWorkspaceGuidance(), /Do not scan the user message/);
  assert.match(codingWorkspaceGuidance(), /85%/);
  assert.match(codingWorkspaceGuidance(), /list_status/);
  assert.equal(
    formatCodingWorkspaceInput({
      action: "focus_browser_tab",
      query: "bilibili",
    }),
    "focus_browser_tab · 查询 bilibili",
  );
});

test("workspace broker returns the desktop result and rejects host failures", async () => {
  const events = [];
  const broker = createWorkspaceActionBroker(
    (id, type, data) => events.push({ id, type, ...data }),
    () => "workspace-1",
  );
  const pending = broker.request({
    conversationId: "conversation-1",
    action: "list_browser_tabs",
    input: { action: "list_browser_tabs" },
  });
  assert.equal(events[0].type, "workspace_action");
  assert.equal(events[0].action, "list_browser_tabs");
  broker.respond({
    requestId: "workspace-1",
    ok: true,
    result: JSON.stringify({ tabs: [{ id: "tab_1", title: "Bilibili", active: true }] }),
  });
  assert.match(await pending, /Bilibili/);

  const failed = broker.request({
    conversationId: "conversation-1",
    action: "close_browser_tab",
    input: { action: "close_browser_tab", tabId: "missing" },
  });
  broker.respond({
    requestId: "workspace-1",
    ok: false,
    error: "browser tab is unavailable",
  });
  await assert.rejects(failed, /unavailable/);
});

test("workspace extension registers one reviewed desktop tool", async () => {
  const tools = [];
  const requested = [];
  const extension = createCodingWorkspaceExtension(
    "conversation-1",
    () => ({ executionMode: "go", approvalPolicy: "workspace-auto" }),
    async request => {
      requested.push(request);
      return JSON.stringify({ tabs: [] });
    },
  );
  extension({
    registerTool(tool) {
      tools.push(tool);
    },
  });
  assert.equal(tools[0]?.name, "milksu_workspace");
  const result = await tools[0].execute("call-1", { action: "list_browser_tabs" });
  assert.equal(requested[0].action, "list_browser_tabs");
  assert.match(result.content[0].text, /tabs/);
});

test("compact_context only schedules Pi compaction at 85 percent usage", async () => {
  assert.equal(describeWorkspaceCompaction({
    inputTokens: 40_000,
  }, 100_000).scheduled, false);
  assert.equal(describeWorkspaceCompaction({
    inputTokens: 90_000,
  }, 100_000).scheduled, true);

  const pending = new Set();
  const tools = [];
  const extension = createCodingWorkspaceExtension(
    "conversation-1",
    () => ({ executionMode: "go", approvalPolicy: "ask" }),
    async () => {
      throw new Error("desktop should not compact mid-turn");
    },
    id => queueWorkspaceCompaction(pending, id),
    () => ({ usage: { inputTokens: 40_000 }, contextWindow: 100_000 }),
  );
  extension({ registerTool(tool) { tools.push(tool); } });
  const low = await tools[0].execute("call-compact-low", { action: "compact_context" });
  assert.match(low.content[0].text, /现在不会整理/);
  assert.equal(pending.has("conversation-1"), false);

  const highTools = [];
  const high = createCodingWorkspaceExtension(
    "conversation-1",
    () => ({ executionMode: "go", approvalPolicy: "ask" }),
    async () => {
      throw new Error("desktop should not compact mid-turn");
    },
    id => queueWorkspaceCompaction(pending, id),
    () => ({ usage: { inputTokens: 90_000 }, contextWindow: 100_000 }),
  );
  high({ registerTool(tool) { highTools.push(tool); } });
  const result = await highTools[0].execute("call-compact-high", { action: "compact_context" });
  assert.match(result.content[0].text, /85/);
  assert.equal(pending.has("conversation-1"), true);
  assert.equal(await runQueuedWorkspaceCompaction(pending, "conversation-1", async () => "ok"), "ok");
});
