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
  assert.match(codingWorkspaceGuidance(), /compact_context/);
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

test("compact_context queues Pi compaction until the turn is idle", async () => {
  const pending = new Set();
  const queued = queueWorkspaceCompaction(pending, "conversation-1");
  assert.match(queued, /after_current_turn/);
  assert.equal(pending.has("conversation-1"), true);
  let compacted = 0;
  const first = await runQueuedWorkspaceCompaction(pending, "conversation-1", async () => {
    compacted += 1;
    return { tokensBefore: 8000 };
  });
  assert.equal(compacted, 1);
  assert.deepEqual(first, { tokensBefore: 8000 });
  assert.equal(await runQueuedWorkspaceCompaction(pending, "conversation-1", async () => {
    compacted += 1;
  }), undefined);
  assert.equal(compacted, 1);

  const tools = [];
  const extension = createCodingWorkspaceExtension(
    "conversation-1",
    () => ({ executionMode: "go", approvalPolicy: "ask" }),
    async () => {
      throw new Error("desktop should not compact mid-turn");
    },
    id => queueWorkspaceCompaction(pending, id),
  );
  extension({ registerTool(tool) { tools.push(tool); } });
  const result = await tools[0].execute("call-compact", { action: "compact_context" });
  assert.match(result.content[0].text, /queued/);
});
