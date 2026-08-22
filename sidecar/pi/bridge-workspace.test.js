import assert from "node:assert/strict";
import test from "node:test";

import {
  codingWorkspaceActionBlocked,
  codingWorkspaceGuidance,
  researchReportGuidance,
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
  assert.equal(codingWorkspaceActionBlocked("list_records", {
    executionMode: "plan",
    approvalPolicy: "workspace-auto",
  }), "");
  assert.match(
    codingWorkspaceActionBlocked("update_record", {
      executionMode: "plan",
      approvalPolicy: "workspace-auto",
    }),
    /只读|Plan/,
  );
  assert.equal(codingWorkspaceActionBlocked("update_record", {
    executionMode: "go",
    approvalPolicy: "workspace-auto",
  }), "");
});

test("research report guidance tells the model to edit report.md", () => {
  assert.match(researchReportGuidance(), /report\.md/);
  assert.match(researchReportGuidance(), /Status labels are not a report/);
  assert.match(researchReportGuidance(), /Stay on the user-selected target/);
  assert.doesNotMatch(researchReportGuidance("lab-job"), /related\.md/);
  assert.match(researchReportGuidance("cve-research"), /related\.md/);
  assert.match(researchReportGuidance("cve-research"), /上游/);
});

test("workspace guidance tells the model to use typed UI actions", () => {
  assert.match(codingWorkspaceGuidance(), /milksu_workspace/);
  assert.match(codingWorkspaceGuidance(), /tabId/);
  assert.match(codingWorkspaceGuidance(), /Do not scan the user message/);
  assert.match(codingWorkspaceGuidance(), /85%/);
  assert.match(codingWorkspaceGuidance(), /list_status/);
  assert.match(codingWorkspaceGuidance(), /list_records/);
  assert.match(codingWorkspaceGuidance(), /kind conversation/);
  assert.equal(
    formatCodingWorkspaceInput({
      action: "focus_browser_tab",
      query: "bilibili",
    }),
    "focus_browser_tab · 查询 bilibili",
  );
  assert.equal(
    formatCodingWorkspaceInput({
      action: "update_record",
      kind: "lab",
      id: "job-one",
      title: "本地进程反病毒测试",
    }),
    "update_record · 类型 lab · 记录 job-one · 标题 本地进程反病毒测试",
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

test("compact_context queues Pi compaction below the 85 percent auto threshold", async () => {
  const lowReport = describeWorkspaceCompaction({
    inputTokens: 40_000,
  }, 100_000);
  assert.equal(lowReport.scheduled, true);
  assert.equal(lowReport.autoCompact, false);
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
  assert.match(low.content[0].text, /已排队整理上下文/);
  assert.equal(pending.has("conversation-1"), true);

  const highTools = [];
  const highPending = new Set();
  const high = createCodingWorkspaceExtension(
    "conversation-1",
    () => ({ executionMode: "go", approvalPolicy: "ask" }),
    async () => {
      throw new Error("desktop should not compact mid-turn");
    },
    id => queueWorkspaceCompaction(highPending, id),
    () => ({ usage: { inputTokens: 90_000 }, contextWindow: 100_000 }),
  );
  high({ registerTool(tool) { highTools.push(tool); } });
  const result = await highTools[0].execute("call-compact-high", { action: "compact_context" });
  assert.match(result.content[0].text, /85/);
  assert.equal(highPending.has("conversation-1"), true);
  assert.equal(await runQueuedWorkspaceCompaction(highPending, "conversation-1", async () => "ok"), "ok");
});
