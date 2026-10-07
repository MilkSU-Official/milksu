// PR-2 批次 B2c：门开路径日常 UX 与产品面板面端到端（faux provider，零外网零真实
// 生图——imagegen/web 用假 transport，archify 用仓内真 CLI + 本地夹具，capa 用本地
// 假命令脚本经真 sandbox-exec）。与 harness-bridge-b2.test.js（B2）同构：本文件
// keepProductTools=true，跑**真**的 milksu-daily-tools / milksu-security-tools 挂载。
//
// 覆盖工单验收点：
//   - 8 项逐项执行断言（每工具至少一条真执行）
//   - 审批断言：imagegen 逐次审批弹卡（含卡面逐字段）+ 拒绝 block；画图页免卡
//   - 事件契约逐字段：ask 的 approval_requested/approval_resolved payload 与门关
//     （bridge-approval.js requestChoice/respond）逐字段一致；progress 的
//     tool_call_start（formatToolInput 分支）与 tool_call_end content 同一清单形状
//   - workspace：真 workspaceActionBroker 的 workspace_action 事件字段 + 回传闭环
//   - capa：空壳 → 目录到达 → 按名原位替换的动态挂载 + 真执行（darwin）
//   - 文本契约：bridge.js 的 ask/progress 门关定义串与本批薄壳逐字一致
//
// 进程纪律：coding 工具面按进程 cwd 解析工作区（与真 sidecar 同构），本文件在
// 临时工作区 chdir 后跑，finally 恢复（node --test 每文件独立进程，无跨文件串扰）。

import assert from "node:assert/strict";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { fauxAssistantMessage, fauxText, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { formatAskToolInput } from "./bridge-ask.js";
import { createWorkspaceActionBroker } from "./bridge-workspace.js";
import {
  buildTestLayer,
  makeFauxModels,
  waitForEvent,
} from "./harness-bridge-test-support.mjs";
import { MILKSU_DAILY_TOOLS_EXTENSION } from "./harness-bridge-daily-tools.js";

const originalCwd = process.cwd();
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const bridgePath = join(dirname(fileURLToPath(import.meta.url)), "bridge.js");
const dailyToolsPath = join(dirname(fileURLToPath(import.meta.url)), "harness-bridge-daily-tools.js");

const goCommand = {
  provider: "faux",
  model: "faux-1",
  locale: "zh",
  executionMode: "go",
  approvalPolicy: "ask",
};

/** bridge.js formatToolInput 的 ask/progress 分支（bridge.js:1423-1453 的镜像，
 * 供 tool_call_start 事件契约断言——渲染器不改，桥侧形状必须逐字段一致）。 */
function b2cFormatToolInput(toolName, args) {
  if (toolName === "milksu_ask") {
    const question = String(args.question ?? "").trim();
    const options = (Array.isArray(args.options) ? args.options : [])
      .map(option => ({
        id: String(option?.id ?? ""),
        label: String(option?.label ?? ""),
        detail: String(option?.detail ?? ""),
      }));
    return formatAskToolInput(question, options.map(option => (
      option.detail ? { label: option.label, detail: option.detail } : { label: option.label }
    )));
  }
  if (toolName === "milksu_progress") {
    const summary = String(args.summary ?? "").trim();
    const steps = Array.isArray(args.steps) ? args.steps : [];
    const lines = steps.map((step) => {
      const status = step?.status === "completed"
        ? "x"
        : step?.status === "in_progress"
          ? ">"
          : " ";
      const text = String(step?.text ?? "").trim();
      return text ? `[${status}] ${text}` : "";
    }).filter(Boolean);
    return [summary, ...lines].filter(Boolean).join("\n");
  }
  return JSON.stringify(args ?? {});
}

async function withDailyFixture(run, options = {}) {
  const root = await mkdtemp(join(tmpdir(), "milksu-harness-b2c-"));
  const agentDir = join(root, "agent");
  const workspace = join(root, "workspace");
  await mkdir(workspace, { recursive: true });
  process.chdir(workspace);
  const { faux, models } = makeFauxModels();
  const { layer, events, emit, maps, approvalBroker } = buildTestLayer({
    agentDir,
    workspace,
    faux,
    models,
    keepProductTools: true,
    formatToolInput: b2cFormatToolInput,
    ...options,
  });
  try {
    return await run({
      layer, events, emit, maps, faux, models, workspace, root, approvalBroker,
    });
  } finally {
    await layer.disposeAll();
    process.chdir(originalCwd);
    await rm(root, { recursive: true, force: true });
  }
}

/** 1×1 PNG（imageInfo 需要 IHDR 尺寸）。 */
const oneByOnePngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ"
  + "AAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

// ---------- milksu_ask：执行 + 事件契约逐字段 ----------

test("milksu_ask round-trips the choice card with field-exact approval events", async () => {
  await withDailyFixture(async ({ layer, events, faux }) => {
    await layer.createSession({ ...goCommand, conversationId: "conv-ask" });
    faux.setResponses([
      fauxAssistantMessage(
        [fauxToolCall("milksu_ask", {
          question: "用哪个方案？",
          options: [
            { id: "plan-a", label: "方案 A", detail: "最快" },
            { label: "方案 B" },
          ],
        })],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("picked"),
    ]);
    await layer.sendMessage({ ...goCommand, conversationId: "conv-ask", prompt: "ask" });
    await waitForEvent(events, "turn_settled");

    // 事件契约：approval_requested 的 payload 与门关 requestChoice（bridge-approval
    // .js:55-60）逐字段一致——requestId/toolName/content/input 四个字段，input 是
    // 规整后 options 的 JSON（含缺省 id 的补齐 option-2）。
    const requested = (await waitForEvent(events, "approval_requested",
      event => event.toolName === "milksu_ask"))[0];
    assert.equal(requested.id, "conv-ask");
    assert.equal(typeof requested.requestId, "string");
    assert.ok(requested.requestId.length > 0);
    assert.equal(requested.toolName, "milksu_ask");
    assert.equal(requested.content, "用哪个方案？");
    assert.deepEqual(
      Object.keys(requested).sort(),
      ["content", "id", "input", "requestId", "toolName", "type"],
      "the ask card payload carries exactly the gate-closed fields",
    );
    assert.equal(
      requested.input,
      JSON.stringify({
        options: [
          { id: "plan-a", label: "方案 A", detail: "最快" },
          { id: "option-2", label: "方案 B" },
        ],
      }),
    );

    // 回传：approval_resolved 带 choice（门关 respond 的 choice 分支）。
    const resolved = (await waitForEvent(events, "approval_resolved",
      event => event.toolName === "milksu_ask"))[0];
    assert.equal(resolved.requestId, requested.requestId);
    assert.equal(resolved.approved, true);
    assert.equal(resolved.reason, "choice selected");
    assert.equal(resolved.choice, "plan-a");

    // 工具结果：formatAskSelection 的回传文案。
    const toolEnd = (await waitForEvent(events, "tool_call_end",
      event => event.toolName === "milksu_ask"))[0];
    assert.equal(toolEnd.isError, false);
    assert.equal(toolEnd.content, 'The user selected "方案 A" (plan-a).');

    // details 契约：durable 条目里的 {question, selected}（门关 execute 的 details）。
    const page = await layer.conversationEntries("conv-ask", { limit: 100 });
    const toolResult = page.items
      .find(item => item.kind === "pi.tool-result")
      ?.model?.find(message => message?.role === "toolResult");
    assert.deepEqual(toolResult?.details, {
      question: "用哪个方案？",
      selected: { id: "plan-a", label: "方案 A", detail: "最快" },
    });
  });
});

test("milksu_ask dismissal and free-form other input follow the gate-closed paths", async () => {
  await withDailyFixture(async ({ layer, events, faux }) => {
    await layer.createSession({ ...goCommand, conversationId: "conv-ask-deny" });
    faux.setResponses([
      fauxAssistantMessage(
        [fauxToolCall("milksu_ask", {
          question: "继续吗？",
          options: [{ label: "继续" }, { label: "停" }],
        })],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("dismissed"),
    ]);
    await layer.sendMessage({ ...goCommand, conversationId: "conv-ask-deny", prompt: "ask" });
    await waitForEvent(events, "turn_settled");
    const toolEnd = (await waitForEvent(events, "tool_call_end",
      event => event.toolName === "milksu_ask"))[0];
    assert.equal(toolEnd.isError, false);
    assert.equal(toolEnd.content, "The user dismissed the question.");
    const resolved = (await waitForEvent(events, "approval_resolved",
      event => event.toolName === "milksu_ask"))[0];
    assert.equal(resolved.approved, false);
    assert.equal(resolved.reason, "dismissed by user");
  }, { approvalBehavior: () => "deny" });

  // other: 前缀走 encodeAskOtherChoice 的自由输入路径。
  await withDailyFixture(async ({ layer, events, faux }) => {
    await layer.createSession({ ...goCommand, conversationId: "conv-ask-other" });
    faux.setResponses([
      fauxAssistantMessage(
        [fauxToolCall("milksu_ask", {
          question: "选哪个？",
          options: [{ label: "甲" }, { label: "乙" }],
        })],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("typed"),
    ]);
    await layer.sendMessage({ ...goCommand, conversationId: "conv-ask-other", prompt: "ask" });
    await waitForEvent(events, "turn_settled");
    const resolved = (await waitForEvent(events, "approval_resolved",
      event => event.toolName === "milksu_ask"))[0];
    assert.equal(resolved.choice, "other:自己写");
    const toolEnd = (await waitForEvent(events, "tool_call_end",
      event => event.toolName === "milksu_ask"))[0];
    assert.equal(toolEnd.content, 'The user entered: "自己写"');
  }, { approvalChoice: () => "other:自己写" });
});

// ---------- milksu_progress：执行 + 渲染器投影契约 ----------

test("milksu_progress projects the same checklist on tool_call_start and end", async () => {
  await withDailyFixture(async ({ layer, events, faux }) => {
    await layer.createSession({ ...goCommand, conversationId: "conv-progress" });
    faux.setResponses([
      fauxAssistantMessage(
        [fauxToolCall("milksu_progress", {
          summary: "移植日常工具面",
          steps: [
            { text: "读门关实现", status: "completed" },
            { text: "挂载扩展", status: "in_progress" },
            { text: "补测试", status: "pending" },
          ],
        })],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("plan published"),
    ]);
    await layer.sendMessage({ ...goCommand, conversationId: "conv-progress", prompt: "plan" });
    await waitForEvent(events, "turn_settled");

    const checklist = "移植日常工具面\n[ x ] 读门关实现\n[ > ] 挂载扩展\n[   ] 补测试"
      .replaceAll("[ x ]", "[x]").replaceAll("[ > ]", "[>]").replaceAll("[   ]", "[ ]");
    // tool_call_start：formatToolInput 的 progress 分支（bridge.js:1435-1453）——
    // 与结果同一清单形状，渲染器据此在调用落定前投影活计划。
    const toolStart = (await waitForEvent(events, "tool_call_start",
      event => event.toolName === "milksu_progress"))[0];
    assert.equal(toolStart.toolName, "milksu_progress");
    assert.equal(toolStart.content, checklist);
    const toolEnd = (await waitForEvent(events, "tool_call_end",
      event => event.toolName === "milksu_progress"))[0];
    assert.equal(toolEnd.isError, false);
    assert.equal(toolEnd.content, checklist);
    assert.equal(typeof toolEnd.toolCallId, "string");

    // details 契约：{summary, steps}（门关 execute 的 details 形状）。
    const page = await layer.conversationEntries("conv-progress", { limit: 100 });
    const toolResult = page.items
      .find(item => item.kind === "pi.tool-result")
      ?.model?.find(message => message?.role === "toolResult");
    assert.deepEqual(toolResult?.details, {
      summary: "移植日常工具面",
      steps: [
        { text: "读门关实现", status: "completed" },
        { text: "挂载扩展", status: "in_progress" },
        { text: "补测试", status: "pending" },
      ],
    });
  });
});

test("milksu_progress rejects more than one in-progress step", async () => {
  await withDailyFixture(async ({ layer, events, faux }) => {
    await layer.createSession({ ...goCommand, conversationId: "conv-progress-x" });
    faux.setResponses([
      fauxAssistantMessage(
        [fauxToolCall("milksu_progress", {
          summary: "两步同时进行",
          steps: [
            { text: "甲", status: "in_progress" },
            { text: "乙", status: "in_progress" },
          ],
        })],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("rejected"),
    ]);
    await layer.sendMessage({ ...goCommand, conversationId: "conv-progress-x", prompt: "plan" });
    await waitForEvent(events, "turn_settled");
    const toolEnd = (await waitForEvent(events, "tool_call_end",
      event => event.toolName === "milksu_progress"))[0];
    assert.equal(toolEnd.isError, true);
    assert.match(toolEnd.content, /MilkSU progress accepts at most one in-progress step/);
  });
});

// ---------- web_search / web_fetch：假 transport 的执行语义 ----------

test("web_search parses Jina markdown results through the ported execute path", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    assert.equal(String(url), "https://r.jina.ai/https://lite.duckduckgo.com/lite/?q=milksu%20harness");
    return new Response(
      "# Results\n\n[First Hit](https://example.com/one)\nexample.com\nA snippet about one.\n\n"
      + "[Second Hit](//example.com/two)\nexample.com\nAnother snippet.\n",
      { status: 200, headers: { "content-type": "text/markdown" } },
    );
  };
  try {
    await withDailyFixture(async ({ layer, events, faux }) => {
      await layer.createSession({ ...goCommand, conversationId: "conv-search" });
      faux.setResponses([
        fauxAssistantMessage(
          [fauxToolCall("web_search", { query: "milksu harness", max_results: 5 })],
          { stopReason: "toolUse" },
        ),
        fauxAssistantMessage("searched"),
      ]);
      await layer.sendMessage({ ...goCommand, conversationId: "conv-search", prompt: "search" });
      await waitForEvent(events, "turn_settled");
      const toolEnd = (await waitForEvent(events, "tool_call_end",
        event => event.toolName === "web_search"))[0];
      assert.equal(toolEnd.isError, false);
      const parsed = JSON.parse(toolEnd.content);
      assert.deepEqual(parsed.results, [
        {
          title: "First Hit",
          url: "https://example.com/one",
          snippet: "A snippet about one.",
        },
        {
          title: "Second Hit",
          url: "https://example.com/two",
          snippet: "Another snippet.",
        },
      ]);
      const page = await layer.conversationEntries("conv-search", { limit: 100 });
      const toolResult = page.items
        .find(item => item.kind === "pi.tool-result")
        ?.model?.find(message => message?.role === "toolResult");
      assert.equal(toolResult?.details?.results?.length, 2);
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("web_fetch extracts markdown and keeps the blocked-network negative", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("# Page Title\n\nBody text here.\n", { status: 200 });
  try {
    await withDailyFixture(async ({ layer, events, faux }) => {
      await layer.createSession({ ...goCommand, conversationId: "conv-fetch" });
      faux.setResponses([
        fauxAssistantMessage(
          [fauxToolCall("web_fetch", { url: "https://example.com/page" })],
          { stopReason: "toolUse" },
        ),
        fauxAssistantMessage("fetched"),
      ]);
      await layer.sendMessage({ ...goCommand, conversationId: "conv-fetch", prompt: "fetch" });
      await waitForEvent(events, "turn_settled");
      const toolEnd = (await waitForEvent(events, "tool_call_end",
        event => event.toolName === "web_fetch"))[0];
      assert.equal(toolEnd.isError, false);
      assert.match(toolEnd.content, /^# Page Title/);
      assert.match(toolEnd.content, /Body text here/);
      const page = await layer.conversationEntries("conv-fetch", { limit: 100 });
      const toolResult = page.items
        .find(item => item.kind === "pi.tool-result")
        ?.model?.find(message => message?.role === "toolResult");
      assert.equal(toolResult?.details?.title, "Page Title");
      assert.equal(toolResult?.details?.truncated, false);
    });

    // 门关负向：内网/回环地址在 execute 里直接拒绝（bridge-web-research isUrlBlocked）。
    await withDailyFixture(async ({ layer, events, faux }) => {
      await layer.createSession({ ...goCommand, conversationId: "conv-fetch-block" });
      faux.setResponses([
        fauxAssistantMessage(
          [fauxToolCall("web_fetch", { url: "http://127.0.0.1/admin" })],
          { stopReason: "toolUse" },
        ),
        fauxAssistantMessage("blocked"),
      ]);
      await layer.sendMessage({ ...goCommand, conversationId: "conv-fetch-block", prompt: "fetch" });
      await waitForEvent(events, "turn_settled");
      const toolEnd = (await waitForEvent(events, "tool_call_end",
        event => event.toolName === "web_fetch"))[0];
      assert.equal(toolEnd.isError, false);
      assert.equal(toolEnd.content, "Error: URL not allowed");
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ---------- milksu_workspace：真 broker 的面板动作闭环 ----------

test("milksu_workspace round-trips a panel action through the real workspace broker", async () => {
  const requests = [];
  const broker = createWorkspaceActionBroker((conversationId, type, data) => {
    if (type === "workspace_action") requests.push({ conversationId, ...data });
  });
  await withDailyFixture(async ({ layer, events, faux, maps }) => {
    await layer.createSession({ ...goCommand, conversationId: "conv-ws" });
    faux.setResponses([
      fauxAssistantMessage(
        [fauxToolCall("milksu_workspace", { action: "list_artifacts" })],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("listed"),
    ]);
    const sending = layer.sendMessage({
      ...goCommand, conversationId: "conv-ws", prompt: "list",
    });
    // workspace_action 事件：{requestId, action, input}（门关 broker 的字段）。
    await new Promise(resolve => {
      const timer = setInterval(() => {
        if (requests.length > 0) {
          clearInterval(timer);
          resolve();
        }
      }, 20);
    });
    const request = requests[0];
    assert.equal(request.conversationId, "conv-ws");
    assert.equal(request.action, "list_artifacts");
    assert.equal(request.input, JSON.stringify({ action: "list_artifacts" }));
    assert.equal(typeof request.requestId, "string");
    assert.ok(request.requestId.length > 0);
    broker.respond({
      requestId: request.requestId,
      ok: true,
      result: JSON.stringify({ artifacts: ["a.png"] }),
    });
    await sending;
    await waitForEvent(events, "turn_settled");
    const toolEnd = (await waitForEvent(events, "tool_call_end",
      event => event.toolName === "milksu_workspace"))[0];
    assert.equal(toolEnd.isError, false);
    assert.equal(toolEnd.content, JSON.stringify({ artifacts: ["a.png"] }));
    void maps;
  }, { workspaceActionBroker: broker });
});

test("milksu_workspace compact_context reports and queues the pending compaction", async () => {
  await withDailyFixture(async ({ layer, events, faux, maps }) => {
    await layer.createSession({ ...goCommand, conversationId: "conv-compact" });
    faux.setResponses([
      fauxAssistantMessage(
        [fauxToolCall("milksu_workspace", { action: "compact_context" })],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("queued"),
    ]);
    await layer.sendMessage({ ...goCommand, conversationId: "conv-compact", prompt: "compact" });
    await waitForEvent(events, "turn_settled");
    const toolEnd = (await waitForEvent(events, "tool_call_end",
      event => event.toolName === "milksu_workspace"))[0];
    assert.equal(toolEnd.isError, false);
    const report = JSON.parse(toolEnd.content);
    assert.equal(report.scheduled, true);
    assert.equal(report.compacted, false);
    // 门关接线：queueWorkspaceCompaction 把会话塞进 pendingWorkspaceCompaction，
    // 下一条 sendMessage 的 runQueuedWorkspaceCompaction 消费（harness 路径同款）。
    assert.equal(maps.pendingWorkspaceCompaction.has("conv-compact"), true);
    maps.pendingWorkspaceCompaction.delete("conv-compact");
  });
});

test("milksu_workspace mutating actions stay blocked in plan mode and research runs", async () => {
  await withDailyFixture(async ({ layer, events, faux }) => {
    await layer.createSession({
      ...goCommand,
      executionMode: "plan",
      conversationId: "conv-ws-plan",
    });
    faux.setResponses([
      fauxAssistantMessage(
        [fauxToolCall("milksu_workspace", { action: "open_browser_tab", url: "https://example.com" })],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("blocked"),
    ]);
    await layer.sendMessage({
      ...goCommand, executionMode: "plan", conversationId: "conv-ws-plan", prompt: "open",
    });
    await waitForEvent(events, "turn_settled");
    const toolEnd = (await waitForEvent(events, "tool_call_end",
      event => event.toolName === "milksu_workspace"))[0];
    assert.equal(toolEnd.isError, true);
    assert.match(toolEnd.content, /Plan 或只读策略不能改动 Coding 界面/);
  });

  await withDailyFixture(async ({ layer, events, faux }) => {
    await layer.createSession({ ...goCommand, conversationId: "conv-ws-research" });
    faux.setResponses([
      fauxAssistantMessage(
        [fauxToolCall("milksu_workspace", { action: "focus_browser_tab", tabId: "t1" })],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("blocked"),
    ]);
    await layer.sendMessage({
      ...goCommand, conversationId: "conv-ws-research", prompt: "focus",
    });
    await waitForEvent(events, "turn_settled");
    const toolEnd = (await waitForEvent(events, "tool_call_end",
      event => event.toolName === "milksu_workspace"))[0];
    assert.equal(toolEnd.isError, true);
    assert.match(toolEnd.content, /Deep Research uses only the typed Research Browser source action/);
  }, { researchActive: true });
});

// ---------- milksu_imagegen：假 transport + 逐次审批 ----------

test("milksu_imagegen approves per call, generates through the fake transport, and writes the png", async () => {
  const originalFetch = globalThis.fetch;
  const previousKey = process.env.MILKSU_IMAGEGEN_API_KEY;
  const previousConfigured = process.env.MILKSU_IMAGEGEN_CONFIGURED;
  process.env.MILKSU_IMAGEGEN_API_KEY = "test-imagegen-key";
  process.env.MILKSU_IMAGEGEN_CONFIGURED = "1";
  let transportCalls = 0;
  globalThis.fetch = async (endpoint, init) => {
    transportCalls += 1;
    assert.equal(endpoint.toString(), "https://tokenflux.dev/v1/images/generations");
    assert.equal(init.method, "POST");
    assert.equal(init.headers.Authorization, "Bearer test-imagegen-key");
    assert.equal(JSON.parse(init.body).prompt, "a tiny red square");
    return new Response(
      JSON.stringify({ data: [{ b64_json: oneByOnePngBase64 }] }),
      { status: 200, headers: { "x-request-id": "img-req-1" } },
    );
  };
  try {
    await withDailyFixture(async ({ layer, events, faux, workspace }) => {
      await layer.createSession({ ...goCommand, conversationId: "conv-imagegen" });
      const ready = (await waitForEvent(events, "ready"))[0];
      assert.ok(ready.tools.includes("milksu_imagegen"));
      faux.setResponses([
        fauxAssistantMessage(
          [fauxToolCall("milksu_imagegen", {
            mode: "generate",
            prompt: "a tiny red square",
            outputPath: "generated/red.png",
          })],
          { stopReason: "toolUse" },
        ),
        fauxAssistantMessage("drawn"),
      ]);
      await layer.sendMessage({ ...goCommand, conversationId: "conv-imagegen", prompt: "draw" });
      await waitForEvent(events, "turn_settled");

      // 审批断言：审判链 imagegen 分支逐次弹卡（harness-bridge-approval.js:229），
      // 卡面 formatImageGenApprovalInput 的逐行内容。
      const requested = (await waitForEvent(events, "approval_requested",
        event => event.toolName === "milksu_imagegen"))[0];
      assert.match(requested.content, /^ImageGen 文本生成$/m);
      assert.match(requested.content, /^Provider tokenflux\/openai-image\/gpt-image-2$/m);
      assert.match(requested.content, /^Endpoint https:\/\/tokenflux\.dev\/v1\/images\/generations$/m);
      assert.match(requested.content, /^输出 generated\/red\.png$/m);
      assert.match(requested.content, /^尺寸 1024x1024$/m);
      assert.match(requested.content, /^质量 low$/m);
      assert.match(requested.content, /预计输出费 USD 0\.006/);
      assert.deepEqual(JSON.parse(requested.input), {
        mode: "generate",
        prompt: "a tiny red square",
        outputPath: "generated/red.png",
      });

      const toolEnd = (await waitForEvent(events, "tool_call_end",
        event => event.toolName === "milksu_imagegen"))[0];
      assert.equal(toolEnd.isError, false);
      const receipt = JSON.parse(toolEnd.content);
      assert.equal(receipt.schema, "milksu-imagegen-receipt/v1");
      assert.equal(receipt.status, "completed");
      assert.equal(receipt.output.path, "generated/red.png");
      assert.equal(receipt.output.width, 1);
      assert.equal(receipt.output.height, 1);
      assert.match(receipt.output.sha256, /^[0-9a-f]{64}$/);
      assert.equal(transportCalls, 1, "exactly one provider call after approval");
      const written = await readFile(join(workspace, "generated/red.png"));
      assert.ok(written.length > 0);

      const page = await layer.conversationEntries("conv-imagegen", { limit: 100 });
      const toolResult = page.items
        .find(item => item.kind === "pi.tool-result")
        ?.model?.find(message => message?.role === "toolResult");
      assert.equal(toolResult?.details?.output?.path, "generated/red.png");
    }, { imageGenConfigured: true });
  } finally {
    globalThis.fetch = originalFetch;
    if (previousKey === undefined) delete process.env.MILKSU_IMAGEGEN_API_KEY;
    else process.env.MILKSU_IMAGEGEN_API_KEY = previousKey;
    if (previousConfigured === undefined) delete process.env.MILKSU_IMAGEGEN_CONFIGURED;
    else process.env.MILKSU_IMAGEGEN_CONFIGURED = previousConfigured;
  }
});

test("denying milksu_imagegen blocks the paid call before any transport or disk change", async () => {
  const originalFetch = globalThis.fetch;
  const previousKey = process.env.MILKSU_IMAGEGEN_API_KEY;
  const previousConfigured = process.env.MILKSU_IMAGEGEN_CONFIGURED;
  process.env.MILKSU_IMAGEGEN_API_KEY = "test-imagegen-key";
  process.env.MILKSU_IMAGEGEN_CONFIGURED = "1";
  let transportCalls = 0;
  globalThis.fetch = async () => {
    transportCalls += 1;
    return new Response("{}", { status: 200 });
  };
  try {
    await withDailyFixture(async ({ layer, events, faux, workspace }) => {
      await layer.createSession({ ...goCommand, conversationId: "conv-imagegen-deny" });
      faux.setResponses([
        fauxAssistantMessage(
          [fauxToolCall("milksu_imagegen", {
            mode: "generate",
            prompt: "nope",
            outputPath: "denied.png",
          })],
          { stopReason: "toolUse" },
        ),
        fauxAssistantMessage("denied"),
      ]);
      await layer.sendMessage({ ...goCommand, conversationId: "conv-imagegen-deny", prompt: "draw" });
      await waitForEvent(events, "turn_settled");
      const requested = (await waitForEvent(events, "approval_requested",
        event => event.toolName === "milksu_imagegen"))[0];
      assert.ok(requested, "the imagegen call asks first");
      const toolEnd = (await waitForEvent(events, "tool_call_end",
        event => event.toolName === "milksu_imagegen"))[0];
      assert.equal(toolEnd.isError, true);
      assert.match(toolEnd.content, /MilkSU user denied this ImageGen request/);
      assert.equal(transportCalls, 0, "no provider call after denial");
      await assert.rejects(readFile(join(workspace, "denied.png"), "utf8"), /ENOENT/);
    }, { imageGenConfigured: true, approvalBehavior: () => "deny" });
  } finally {
    globalThis.fetch = originalFetch;
    if (previousKey === undefined) delete process.env.MILKSU_IMAGEGEN_API_KEY;
    else process.env.MILKSU_IMAGEGEN_API_KEY = previousKey;
    if (previousConfigured === undefined) delete process.env.MILKSU_IMAGEGEN_CONFIGURED;
    else process.env.MILKSU_IMAGEGEN_CONFIGURED = previousConfigured;
  }
});

test("the Draw page send pre-authorizes milksu_imagegen (imageDraw skips the card)", async () => {
  const originalFetch = globalThis.fetch;
  const previousKey = process.env.MILKSU_IMAGEGEN_API_KEY;
  const previousConfigured = process.env.MILKSU_IMAGEGEN_CONFIGURED;
  process.env.MILKSU_IMAGEGEN_API_KEY = "test-imagegen-key";
  process.env.MILKSU_IMAGEGEN_CONFIGURED = "1";
  globalThis.fetch = async () => new Response(
    JSON.stringify({ data: [{ b64_json: oneByOnePngBase64 }] }),
    { status: 200 },
  );
  try {
    await withDailyFixture(async ({ layer, events, faux, workspace }) => {
      await layer.createSession({
        ...goCommand,
        conversationId: "conv-imagegen-draw",
        imageDraw: true,
      });
      faux.setResponses([
        fauxAssistantMessage(
          [fauxText("画图页直接生成"),
            fauxToolCall("milksu_imagegen", {
              mode: "generate",
              prompt: "draw page art",
              outputPath: "draw.png",
            })],
          { stopReason: "toolUse" },
        ),
        fauxAssistantMessage("done"),
      ]);
      await layer.sendMessage({
        ...goCommand, conversationId: "conv-imagegen-draw", prompt: "draw", imageDraw: true,
      });
      await waitForEvent(events, "turn_settled");
      assert.equal(
        events.some(event => event.type === "approval_requested"
          && event.toolName === "milksu_imagegen"),
        false,
        "the Draw page send is the authorization; no second card",
      );
      const toolEnd = (await waitForEvent(events, "tool_call_end",
        event => event.toolName === "milksu_imagegen"))[0];
      assert.equal(toolEnd.isError, false);
      assert.equal(JSON.parse(toolEnd.content).output.path, "draw.png");
      const written = await readFile(join(workspace, "draw.png"));
      assert.ok(written.length > 0);
    }, { imageGenConfigured: true });
  } finally {
    globalThis.fetch = originalFetch;
    if (previousKey === undefined) delete process.env.MILKSU_IMAGEGEN_API_KEY;
    else process.env.MILKSU_IMAGEGEN_API_KEY = previousKey;
    if (previousConfigured === undefined) delete process.env.MILKSU_IMAGEGEN_CONFIGURED;
    else process.env.MILKSU_IMAGEGEN_CONFIGURED = previousConfigured;
  }
});

// ---------- milksu_archify：真 CLI + 真沙箱（本地夹具） ----------

test("milksu_archify validates and delivers through the sandboxed packaged CLI", async () => {
  const archifyRoot = join(repositoryRoot, "third_party", "archify", "archify");
  await withDailyFixture(async ({ layer, events, faux, workspace }) => {
    await copyFile(
      join(archifyRoot, "examples", "checkout-platform.base.architecture.json"),
      join(workspace, "spec.json"),
    );
    await layer.createSession({ ...goCommand, conversationId: "conv-archify" });
    const ready = (await waitForEvent(events, "ready"))[0];
    assert.ok(ready.tools.includes("milksu_archify"));
    faux.setResponses([
      fauxAssistantMessage(
        [fauxToolCall("milksu_archify", {
          action: "validate",
          diagramType: "architecture",
          inputPath: "spec.json",
        })],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(
        [fauxToolCall("milksu_archify", {
          action: "deliver",
          diagramType: "architecture",
          inputPath: "spec.json",
          outputPath: "out.html",
        })],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("delivered"),
    ]);
    await layer.sendMessage({ ...goCommand, conversationId: "conv-archify", prompt: "diagram" });
    await waitForEvent(events, "turn_settled");

    const validateEnd = (await waitForEvent(events, "tool_call_end",
      event => event.toolName === "milksu_archify"))[0];
    assert.equal(validateEnd.isError, false);
    assert.equal(JSON.parse(validateEnd.content).ok, true);

    const deliverEnd = (await waitForEvent(events, "tool_call_end",
      event => event.toolName === "milksu_archify"
        && event.content.includes('"command": "deliver"')))[0];
    assert.equal(deliverEnd.isError, false);
    const receipt = JSON.parse(deliverEnd.content);
    assert.equal(receipt.ok, true);
    // 交付物路径按沙箱内绝对路径回执（门关 execute 直传 CLI 的 --json 输出）。
    assert.ok(
      String(receipt.output).endsWith("/out.html"),
      `deliverable receipt points at out.html: ${receipt.output}`,
    );
    const delivered = await readFile(join(workspace, "out.html"), "utf8");
    assert.ok(delivered.length > 0, "the sandboxed CLI wrote the deliverable");
  }, { readOnlyResourceRoots: [archifyRoot] });
});

// ---------- capa_analyze：动态挂载 + 真执行（darwin 沙箱） ----------

async function makeCapaFixture(version) {
  const root = await mkdtemp(join(tmpdir(), "milksu-capa-fixture-"));
  const script = join(root, `capa-${version}`);
  await writeFile(script, `#!/bin/sh\necho "MATCH: fake-capa-${version} capability"\necho "CAPA ${version}"\n`, "utf8");
  await chmod(script, 0o755);
  return {
    descriptor: {
      id: "capa",
      command: script,
      args: [],
      version,
      capabilities: ["static-analysis"],
    },
  };
}

test("capa_analyze mounts on catalog arrival and runs through the real sandbox", {
  skip: process.platform !== "darwin",
}, async () => {
  const fixture = await makeCapaFixture("7.0.0-fixture");
  try {
    await withDailyFixture(async ({ layer, events, faux, workspace }) => {
      // 第一个会话无 capa 目录：milksu-security-tools 是空壳，工具面无 capa_analyze。
      await layer.createSession({ ...goCommand, conversationId: "conv-capa-none" });
      const readyNone = (await waitForEvent(events, "ready"))[0];
      assert.ok(readyNone.extensions.includes("milksu-security-tools"));
      assert.equal(readyNone.tools.includes("capa_analyze"), false);

      // 第二个会话带目录：按名原位替换后 capa_analyze 上桌。
      await writeFile(join(workspace, "sample.bin"), "MZfake-binary", "utf8");
      await layer.createSession({
        ...goCommand,
        conversationId: "conv-capa",
        securityTools: [fixture.descriptor],
      });
      const ready = (await waitForEvent(events, "ready",
        event => event.id === "conv-capa"))[0];
      assert.ok(ready.tools.includes("capa_analyze"));
      assert.ok(ready.extensions.includes("milksu-security-tools"));

      faux.setResponses([
        fauxAssistantMessage(
          [fauxToolCall("capa_analyze", { relativePath: "sample.bin" })],
          { stopReason: "toolUse" },
        ),
        fauxAssistantMessage("analyzed"),
      ]);
      await layer.sendMessage({
        ...goCommand, conversationId: "conv-capa", prompt: "analyze",
        securityTools: [fixture.descriptor],
      });
      await waitForEvent(events, "turn_settled");
      const toolEnd = (await waitForEvent(events, "tool_call_end",
        event => event.toolName === "capa_analyze"))[0];
      assert.equal(toolEnd.isError, false);
      assert.match(toolEnd.content, /MATCH: fake-capa-7\.0\.0-fixture capability/);
      assert.match(toolEnd.content, /CAPA 7\.0\.0-fixture/);
      const page = await layer.conversationEntries("conv-capa", { limit: 100 });
      const toolResult = page.items
        .find(item => item.kind === "pi.tool-result")
        ?.model?.find(message => message?.role === "toolResult");
      assert.deepEqual(toolResult?.details, {
        tool: "capa",
        version: "7.0.0-fixture",
        relativePath: "sample.bin",
        format: "summary",
        exitCode: 0,
      });
    });
  } finally {
    await rm(dirname(fixture.descriptor.command), { recursive: true, force: true });
  }
});

// ---------- 文本契约：门关定义串与本批薄壳逐字一致 ----------

test("the ask/progress thin shells keep the gate-closed definition strings verbatim", async () => {
  const bridgeSource = await readFile(bridgePath, "utf8");
  const dailySource = await readFile(dailyToolsPath, "utf8");
  for (const marker of [
    "Show a tappable choice card with 2-6 options",
    "milksu_ask needs at least two options",
    "Publish or update a short execution plan (summary + up to 8 steps)",
    "MilkSU progress accepts at most one in-progress step",
  ]) {
    assert.ok(bridgeSource.includes(marker), `bridge.js must keep ${marker}`);
    assert.ok(dailySource.includes(marker), `the B2c shell must mirror ${marker}`);
  }
  // 薄壳不带 label 字段（pi-durable 面无 label），但扩展名必须挂在 registry。
  assert.ok(dailySource.includes(`"${MILKSU_DAILY_TOOLS_EXTENSION}"`));
});
