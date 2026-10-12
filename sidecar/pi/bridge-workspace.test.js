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
  researchBrowserWorkspaceActionBlocked,
  describeWorkspaceCompaction,
  queueWorkspaceCompaction,
  runQueuedWorkspaceCompaction,
  collectReverseArtifacts,
  previewReverseArtifact,
  updateReverseArtifactStore,
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
  assert.match(researchReportGuidance(), /只停留在用户选定的目标上/);
  // Section headings come from the seeded report.md, and the lease facts come
  // from the env tool descriptions, so neither is restated here.
  assert.doesNotMatch(researchReportGuidance(), /env_status/);
  assert.doesNotMatch(researchReportGuidance("cve-research"), /上游/);
  assert.doesNotMatch(researchReportGuidance("lab-job"), /related\.md/);
  assert.match(researchReportGuidance("cve-research"), /related\.md/);
  assert.match(researchReportGuidance("cve-research"), /不要编造/);
  assert.match(researchReportGuidance("cve-research"), /LEARNING\.md/);
  assert.match(researchReportGuidance("cve-research", "en"), /prior for this job/);
  assert.doesNotMatch(researchReportGuidance("lab-job"), /TASK\.md/);
  assert.doesNotMatch(researchReportGuidance("lab-job"), /LEARNING\.md/);
  assert.doesNotMatch(researchReportGuidance(), /LEARNING\.md/);
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
    "focus_browser_tab",
  );
  assert.equal(
    formatCodingWorkspaceInput({
      action: "open_browser_tab",
      url: "https://example.org/?token=synthetic-secret",
    }),
    "open_browser_tab",
  );
  assert.doesNotMatch(
    formatCodingWorkspaceInput({
      action: "get_research_run",
      runId: "synthetic-provider-secret",
    }, { secrets: ["synthetic-provider-secret"] }),
    /synthetic-provider-secret/,
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

test("Research blocks generic Browser tab operations while worker context remains active", () => {
  for (const action of [
    "list_browser_tabs",
    "open_browser_tab",
    "focus_browser_tab",
    "close_browser_tab",
    "close_all_browser_tabs",
  ]) {
    assert.match(researchBrowserWorkspaceActionBlocked(action, true), /typed Research Browser/u);
    assert.equal(researchBrowserWorkspaceActionBlocked(action, false), "");
  }
  assert.equal(researchBrowserWorkspaceActionBlocked("open_research_browser_tab", true), "");
});

test("research workspace actions are typed, Pi-side, and omit extract text from activity", async () => {
  const requested = [];
  const observed = [];
  const tools = [];
  const extension = createCodingWorkspaceExtension(
    "conversation-1",
    () => ({ executionMode: "go", approvalPolicy: "workspace-auto" }),
    async request => {
      requested.push(request);
      if (request.action === "register_research_task") {
        return JSON.stringify({ task: {
          id: "research_task_1",
          runId: "research_run_1",
          prompt: request.input.taskPrompt,
        } });
      }
      return JSON.stringify({ run: { id: "research_run_1" } });
    },
    undefined,
    undefined,
    event => observed.push(event),
    () => ["synthetic-provider-secret"],
  );
  extension({ registerTool(tool) { tools.push(tool); } });

  assert.equal(normalizeCodingWorkspaceAction("start_research_run"), "start_research_run");
  assert.equal(normalizeCodingWorkspaceAction("register_research_task"), "register_research_task");
  assert.equal(normalizeCodingWorkspaceAction("record_research_citation"), "record_research_citation");
  assert.match(codingWorkspaceActionBlocked("start_research_run", {
    executionMode: "plan",
    approvalPolicy: "workspace-auto",
  }), /Plan|只读/);
  assert.equal(codingWorkspaceActionBlocked("start_research_run", {
    executionMode: "go",
    approvalPolicy: "workspace-auto",
  }), "");

  await tools[0].execute("call-research", {
    action: "start_research_run",
    query: "Compare official release dates without copying synthetic-provider-secret",
  });
  assert.equal(requested[0].action, "start_research_run");
  assert.doesNotMatch(requested[0].input.query, /synthetic-provider-secret/);
  assert.deepEqual(observed, [{
    conversationId: "conversation-1",
    action: "start_research_run",
    result: JSON.stringify({ run: { id: "research_run_1" } }),
  }]);
  await tools[0].execute("call-register-task", {
    action: "register_research_task",
    runId: "research_run_1",
    taskPrompt: "Collect official-source evidence for standard A",
  });
  assert.equal(requested[1].action, "register_research_task");
  assert.equal(observed[1].action, "register_research_task");
  const signedURL = "https://example.test/file?X-Amz-Credential=synthetic-credential&X-Amz-Signature=synthetic-signature&keep=1";
  await tools[0].execute("call-open-source", {
    action: "open_research_browser_tab",
    runId: "research_run_1",
    url: signedURL,
  });
  assert.equal(requested[2].input.url, signedURL);
  await tools[0].execute("call-record-source", {
    action: "record_research_source",
    runId: "research_run_1",
    url: signedURL,
    title: "Official source",
    extract: `Evidence URL ${signedURL}`,
  });
  assert.equal(requested[3].input.url, signedURL);
  assert.doesNotMatch(requested[3].input.extract, /synthetic-(?:credential|signature)/);
  const activity = formatCodingWorkspaceInput({
    action: "record_research_source",
    runId: "research_run_1",
    url: "https://example.test/?X-Amz-Signature=synthetic-secret",
    extract: "synthetic-secret source body",
  });
  assert.match(activity, /record_research_source/);
  assert.doesNotMatch(activity, /synthetic-secret|example\.test/);
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

test("collectReverseArtifacts pairs milksu-rea mcp calls with their results", () => {
  const messages = [
    { role: "user", content: [{ type: "text", text: "analyze" }] },
    {
      role: "assistant",
      content: [{ type: "toolCall", id: "call-1", name: "mcp", arguments: { tool: "milksu-rea_analyze_javascript_application", args: { input_path: "/tmp/demo" } } }],
    },
    {
      role: "toolResult",
      toolCallId: "call-1",
      toolName: "mcp",
      isError: false,
      content: [{ type: "text", text: 'MCP text output truncated: original 74 lines.\nFull text saved to: /var/tmp/pi-mcp-output-1/output.txt\n{"result":{"input_path":"/tmp/demo"}}' }],
    },
    {
      role: "assistant",
      content: [{ type: "toolCall", id: "call-2", name: "mcp", arguments: { tool: "milksu-playwright_navigate", args: {} } }],
    },
    {
      role: "toolResult",
      toolCallId: "call-2",
      toolName: "mcp",
      isError: false,
      content: [{ type: "text", text: "navigated" }],
    },
    {
      role: "assistant",
      content: [{ type: "toolCall", id: "call-3", name: "mcp", arguments: { tool: "milksu-rea_list_procedures", args: {} } }],
    },
  ];
  const artifacts = collectReverseArtifacts(messages);
  assert.equal(artifacts.length, 2);

  assert.equal(artifacts[0].id, "rea-1");
  assert.equal(artifacts[0].tool, "analyze_javascript_application");
  assert.deepEqual(artifacts[0].args, { input_path: "/tmp/demo" });
  assert.equal(artifacts[0].status, "done");
  assert.equal(artifacts[0].truncated, true);
  assert.equal(artifacts[0].savedPath, "/var/tmp/pi-mcp-output-1/output.txt");
  assert.ok(artifacts[0].resultHead.includes("input_path"));

  assert.equal(artifacts[1].id, "rea-2");
  assert.equal(artifacts[1].tool, "list_procedures");
  assert.equal(artifacts[1].status, "pending");

  const preview = previewReverseArtifact(artifacts, "rea-1");
  assert.equal(preview.tool, "analyze_javascript_application");
  assert.ok(preview.content.includes("Full text saved to"));
  assert.equal(previewReverseArtifact(artifacts, "rea-9"), null);
});

test("workspace extension serves reverse artifact actions locally from the event-fed store", async () => {
  const store = [];
  updateReverseArtifactStore(store, { role: "assistant", content: [{ type: "toolCall", id: "c1", name: "mcp", arguments: { tool: "milksu-rea_binary_overview", args: { session: "s" } } }] });
  updateReverseArtifactStore(store, { role: "toolResult", toolCallId: "c1", toolName: "mcp", isError: false, content: [{ type: "text", text: '{"result":{"format":"elf"}}' }] });
  const requests = [];
  const extension = createCodingWorkspaceExtension(
    "conversation-1",
    () => ({ executionMode: "go", approvalPolicy: "workspace-auto" }),
    request => { requests.push(request.action); return Promise.resolve("{}"); },
    () => undefined,
    () => ({}),
    () => undefined,
    () => [],
    () => false,
    () => store,
  );
  const registrations = [];
  extension({ registerTool: tool => registrations.push(tool) });
  const workspaceTool = registrations.find(tool => tool.name === "milksu_workspace");

  const listResult = await workspaceTool.execute("t1", { action: "list_reverse_artifacts" });
  const listed = JSON.parse(listResult.content[0].text);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].tool, "binary_overview");
  assert.equal(listed[0].status, "done");

  const previewResult = await workspaceTool.execute("t2", { action: "preview_reverse_artifact", id: "rea-1" });
  const preview = JSON.parse(previewResult.content[0].text);
  assert.ok(preview.content.includes("elf"));
  // 本地动作不应转发 broker
  assert.equal(requests.length, 0);
});
