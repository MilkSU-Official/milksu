import assert from "node:assert/strict";
import test from "node:test";

import {
  codingWorkspaceActionBlocked,
  codingWorkspaceGuidance,
  isResearchSessionRole,
  researchReportGuidance,
  resolveWorkflowSessionRole,
  codingWorkspaceToolName,
  createCodingWorkspaceExtension,
  createWorkspaceActionBroker,
  defaultWorkspaceActionTimeoutMs,
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

test("CVE and lab keep research session roles so the Coding Pi loop still applies", () => {
  assert.equal(resolveWorkflowSessionRole("", false), "");
  assert.equal(resolveWorkflowSessionRole("solver", true), "solver");
  assert.equal(resolveWorkflowSessionRole("", true), "solver");
  assert.equal(resolveWorkflowSessionRole("cve-research", false), "cve-research");
  assert.equal(resolveWorkflowSessionRole("lab-job", false), "lab-job");
  assert.equal(resolveWorkflowSessionRole("cve-research", true), "cve-research");
  assert.equal(isResearchSessionRole("cve-research"), true);
  assert.equal(isResearchSessionRole("lab-job"), true);
  assert.equal(isResearchSessionRole("solver"), false);
  assert.equal(isResearchSessionRole(""), false);
});

test("research report guidance tells the model to edit report.md", () => {
  assert.match(researchReportGuidance(), /report\.md/);
  assert.match(researchReportGuidance(), /Stay on the user-selected target/);
  // Section headings come from the seeded report.md, and the lease facts come
  // from the env tool descriptions, so neither is restated here.
  assert.doesNotMatch(researchReportGuidance(), /env_status/);
  assert.doesNotMatch(researchReportGuidance("cve-research"), /上游/);
  assert.doesNotMatch(researchReportGuidance("lab-job"), /related\.md/);
  assert.match(researchReportGuidance("cve-research"), /related\.md/);
  assert.match(researchReportGuidance("cve-research"), /do not invent them/);
});

test("the model lists and locks Computer Use windows without a forced picker", () => {
  assert.equal(
    codingWorkspaceActionBlocked("show_panel", {
      executionMode: "plan",
      approvalPolicy: "read-only",
    }),
    "",
  );
  assert.equal(
    codingWorkspaceActionBlocked("list_computer_use_windows", {
      executionMode: "plan",
      approvalPolicy: "read-only",
    }),
    "",
  );
  assert.match(
    codingWorkspaceActionBlocked("lock_computer_use_window", {
      executionMode: "plan",
      approvalPolicy: "workspace-auto",
    }),
    /只读|Plan/,
  );
  assert.equal(
    codingWorkspaceActionBlocked("lock_computer_use_window", {
      executionMode: "go",
      approvalPolicy: "workspace-auto",
    }),
    "",
  );
  assert.equal(normalizeCodingWorkspaceAction("list_computer_use_windows"), "list_computer_use_windows");
  assert.equal(normalizeCodingWorkspaceAction("lock_computer_use_window"), "lock_computer_use_window");
  assert.equal(normalizeCodingWorkspaceAction("prepare_coding_worktree"), "prepare_coding_worktree");
  assert.match(
    formatCodingWorkspaceInput({
      action: "lock_computer_use_window",
      targetPid: 4242,
      targetWindowId: 9001,
    }),
    /PID 4242/,
  );
});

test("workspace guidance is a short when-to-use routing rule", () => {
  const text = codingWorkspaceGuidance();
  assert.match(text, /milksu_workspace/);
  assert.match(text, /lock_computer_use_window/);
  assert.doesNotMatch(text, /list_records/);
  assert.doesNotMatch(text, /85%/);
  assert.ok(text.length < 420);
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

// Preparing a writer worktree checks out a linked tree and copies ignored
// includes, so it needs a longer bound than an ordinary desktop action.
test("workspace broker honours a caller-supplied deadline", async () => {
  const broker = createWorkspaceActionBroker(() => {}, () => "workspace-slow");
  const pending = broker.request({
    conversationId: "conversation-1",
    action: "prepare_coding_worktree",
    input: { writers: 1 },
    timeoutMs: 20,
  });
  await assert.rejects(pending, /timed out/);

  const bounded = broker.request({
    conversationId: "conversation-1",
    action: "prepare_coding_worktree",
    input: { writers: 1 },
    timeoutMs: defaultWorkspaceActionTimeoutMs,
  });
  broker.respond({
    requestId: "workspace-slow",
    ok: true,
    result: JSON.stringify({ schemaVersion: 2 }),
  });
  assert.match(await bounded, /schemaVersion/);
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
  assert.equal(tools[0]?.description, codingWorkspaceGuidance());
  const result = await tools[0].execute("call-1", { action: "list_browser_tabs" });
  assert.equal(requested[0].action, "list_browser_tabs");
  assert.match(result.content[0].text, /tabs/);
});

test("compact_context queues Pi compaction below the 80 percent auto threshold", async () => {
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
  assert.match(result.content[0].text, /"threshold":80/);
  assert.equal(highPending.has("conversation-1"), true);
  assert.equal(await runQueuedWorkspaceCompaction(highPending, "conversation-1", async () => "ok"), "ok");
});
