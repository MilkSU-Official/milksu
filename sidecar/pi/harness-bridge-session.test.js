// PR-2 批次 B1：门开路径端到端（faux provider，零网络零真实密钥，数据全在临时目录）。
//
// 覆盖工单验收点：
//   1. createSession → ready（tools/extensions/resumed 形状）
//   2. 一条完整回合：提交 → 工具调用（ask 审批，假桌面回包）→ run 收尾 → 事件投影
//      逐字段断言（含 60ms 合并入口 queueTextDelta、formatToolInput/redact、usage）
//   3. 审批拒绝 → block 语义（isError + 模型可见的 blocked 文案，不执行）
//   4. 切模型 / 切 thinking（configureConversation + 事件 + pi.agent 落盘）
//   5. 手动压缩（conversation.compact → pi.compaction 条目 + compaction_start/end）
//   6. requestId 幂等（同 id 两次提交 = 同一 submission，恰好一条 pi.user）
//   7. turn contract 无工具 → beforeTool 拦截
//   8. 忙时 steer → pi.inbox → queue_update 投影
//   9. hang-guard 改参移植：bash 缺 timeout 注入默认 600（钩子改参过 schema 校验）

import assert from "node:assert/strict";
import test from "node:test";
import { appendFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxText, fauxThinking, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { steerSession } from "./bridge-steering.js";
import {
  buildTestLayer,
  kindCounts,
  makeFauxModels,
  makeTestBashTool,
  waitForEvent,
} from "./harness-bridge-test-support.mjs";

async function withFixture(run, options = {}) {
  const root = await mkdtemp(join(tmpdir(), "milksu-harness-bridge-"));
  const agentDir = join(root, "agent");
  const workspace = join(root, "workspace");
  await mkdir(workspace, { recursive: true });
  const { faux, models } = makeFauxModels();
  const executedCalls = [];
  const tool = makeTestBashTool({
    workspace,
    sleepMs: 700,
    onExecute: args => {
      executedCalls.push(args);
      void appendFile(join(workspace, "exec-log.txt"), `${JSON.stringify(args)}\n`);
    },
  });
  const { layer, events, emit, maps } = buildTestLayer({
    agentDir,
    workspace,
    faux,
    models,
    extraTools: [tool],
    ...options,
  });
  try {
    return await run({ layer, events, emit, maps, faux, workspace, executedCalls });
  } finally {
    await layer.disposeAll();
    await rm(root, { recursive: true, force: true });
  }
}

const baseCommand = {
  provider: "faux",
  model: "faux-1",
  locale: "zh",
  executionMode: "go",
  approvalPolicy: "ask",
};

test("harness session end-to-end: create, approved tool turn, projected events", async () => {
  await withFixture(async ({ layer, events, faux, workspace, executedCalls }) => {
    const conversationId = "conv-e2e";
    await layer.createSession({
      ...baseCommand,
      conversationId,
    });
    const ready = await waitForEvent(events, "ready");
    assert.equal(ready[0].id, conversationId);
    assert.deepEqual(ready[0].tools, ["bash"], "only the registered tool is offered");
    assert.equal(ready[0].executionMode, "go");
    assert.equal(ready[0].approvalPolicy, "ask");
    assert.equal(ready[0].resumed, false, "fresh conversation");
    assert.ok(ready[0].extensions.includes("milksu-core"));
    await waitForEvent(events, "model_selected", event => event.model === "faux-1");
    await waitForEvent(events, "thinking_level_selected");

    faux.setResponses([
      fauxAssistantMessage(
        [
          fauxText("working on it"),
          fauxThinking("thinking about it"),
          fauxToolCall("bash", { command: "echo hi" }),
        ],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("final answer"),
    ]);
    await layer.sendMessage({
      ...baseCommand,
      conversationId,
      prompt: "run the tool",
    });
    await waitForEvent(events, "turn_settled");

    // 审批链：ask 策略对 bash 弹卡，假桌面批准。
    const requested = await waitForEvent(events, "approval_requested",
      event => event.toolName === "bash");
    assert.ok(requested[0].content.includes("echo hi"), "card carries the formatted command");
    const resolved = await waitForEvent(events, "approval_resolved",
      event => event.approved === true);
    assert.equal(resolved[0].requestId, requested[0].requestId);

    // 工具调用投影：start（格式化 content）→ end（内容/时长/错误位/module）。
    const toolStart = (await waitForEvent(events, "tool_call_start"))[0];
    assert.equal(toolStart.toolName, "bash");
    assert.equal(toolStart.content, "$ echo hi");
    assert.equal(toolStart.module, "coding");
    assert.ok(toolStart.toolCallId);
    const toolEnd = (await waitForEvent(events, "tool_call_end"))[0];
    assert.equal(toolEnd.toolName, "bash");
    assert.equal(toolEnd.isError, false);
    assert.equal(toolEnd.module, "coding");
    assert.ok(toolEnd.content.includes("ran echo hi"));
    assert.ok(Number(toolEnd.durationMs) >= 0);

    // 消息投影：工具轮 segment + 最终 message_done + usage。
    const segment = (await waitForEvent(events, "message_segment_done"))[0];
    assert.equal(segment.reason, "toolUse");
    assert.equal(segment.content, "working on it");
    const done = (await waitForEvent(events, "message_done"))[0];
    assert.equal(done.content, "final answer");
    assert.equal(done.reason, "stop");
    const thinkingDone = (await waitForEvent(events, "thinking_done"))[0];
    assert.equal(thinkingDone.content, "thinking about it");
    const usage = (await waitForEvent(events, "usage_recorded"))[0];
    assert.equal(usage.module, "coding");
    assert.equal(usage.usage.provider, "faux");
    assert.equal(usage.usage.source, "personal");
    assert.ok(usage.usage.inputTokens > 0, "faux estimates nonzero input tokens");

    // turn_started 与 turn_settled 成对。
    await waitForEvent(events, "turn_started");

    // hang-guard 改参移植：缺 timeout 的 bash 被注入默认 600 秒（经钩子二次校验）。
    assert.equal(executedCalls.length, 1);
    assert.equal(executedCalls[0].command, "echo hi");
    assert.equal(executedCalls[0].timeout, 600);

    // 转录落盘形状。
    const page = await layer.conversationEntries(conversationId, { limit: 100 });
    const counts = kindCounts(page.items);
    assert.equal(counts["pi.user"], 1, JSON.stringify(counts));
    assert.equal(counts["pi.assistant"], 2, JSON.stringify(counts));
    assert.equal(counts["pi.tool-result"], 1, JSON.stringify(counts));
    const toolResult = page.items
      .find(item => item.kind === "pi.tool-result")
      ?.model?.find(message => message?.role === "toolResult");
    assert.equal(toolResult?.isError, false);
  }, { approvalBehavior: () => "approve" });
});

test("denied approval blocks the call without executing it", async () => {
  await withFixture(async ({ layer, events, faux, executedCalls }) => {
    const conversationId = "conv-deny";
    await layer.createSession({ ...baseCommand, conversationId });
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("bash", { command: "echo nope" })], { stopReason: "toolUse" }),
      fauxAssistantMessage("gave up"),
    ]);
    await layer.sendMessage({ ...baseCommand, conversationId, prompt: "try a delete" });
    await waitForEvent(events, "turn_settled");
    const toolEnd = (await waitForEvent(events, "tool_call_end"))[0];
    assert.equal(toolEnd.isError, true);
    assert.ok(
      String(toolEnd.content).includes("MilkSU user denied bash"),
      `blocked reason is model-visible: ${toolEnd.content}`,
    );
    assert.equal(executedCalls.length, 0, "denied call must not execute");
  }, { approvalBehavior: () => "deny" });
});

test("switching model and thinking level reconfigures the conversation", async () => {
  await withFixture(async ({ layer, events, faux }) => {
    const conversationId = "conv-switch";
    await layer.createSession({ ...baseCommand, conversationId });
    faux.setResponses([fauxAssistantMessage("first answer")]);
    await layer.sendMessage({ ...baseCommand, conversationId, prompt: "hi" });
    await waitForEvent(events, "turn_settled");

    faux.setResponses([fauxAssistantMessage("second answer")]);
    await layer.sendMessage({
      ...baseCommand,
      conversationId,
      prompt: "switch it",
      model: "faux-2",
      thinking: { enabled: true, levels: ["low", "medium", "high"], level: "high" },
    });
    const selected = await waitForEvent(events, "model_selected",
      event => event.model === "faux-2");
    assert.equal(selected[0].provider, "faux");
    const thinking = await waitForEvent(events, "thinking_level_selected",
      event => event.enabled === true);
    assert.equal(thinking[0].level, "high");
    await waitForEvent(events, "turn_settled", undefined, 20000);

    // pi.agent 落盘：conversationAgent 反映新模型与思考档。
    const agent = await layer.conversationAgent(conversationId);
    assert.deepEqual(agent.model, { provider: "faux", modelId: "faux-2" });
    assert.equal(agent.thinkingLevel, "high");
  });
});

test("manual compaction emits start/end with requestId and appends a pi.compaction entry", async () => {
  await withFixture(async ({ layer, events, faux }) => {
    const conversationId = "conv-compact";
    await layer.createSession({ ...baseCommand, conversationId });
    faux.setResponses([fauxAssistantMessage(`first answer ${"A".repeat(600)}`)]);
    await layer.sendMessage({ ...baseCommand, conversationId, prompt: "build context" });
    await waitForEvent(events, "turn_settled");

    faux.setResponses([fauxAssistantMessage("SUMMARY-TEXT")]);
    await layer.compactSessionCommand({
      conversationId,
      requestId: "compact-1",
    });
    const started = await waitForEvent(events, "compaction_start",
      event => event.requestId === "compact-1");
    assert.equal(started[0].reason, "manual");
    const ended = await waitForEvent(events, "compaction_end",
      event => event.requestId === "compact-1");
    assert.equal(ended[0].aborted, false);
    assert.equal(ended[0].reason, "manual");
    assert.ok(!ended[0].error, `no compaction error: ${ended[0].error}`);

    // pi.compaction 条目真的落盘（工单验收：直接 compact 断言 pi.compaction 条目）。
    const page = await layer.conversationEntries(conversationId, { limit: 100 });
    const counts = kindCounts(page.items);
    assert.equal(counts["pi.compaction"], 1, JSON.stringify(counts));
  }, { compactionPolicyOverrides: () => ({ keepRecentTokens: 40, backgroundTokens: 0 }) });
});

test("requestId idempotency: the same requestId never places a second user entry", async () => {
  await withFixture(async ({ layer, events, faux }) => {
    const conversationId = "conv-dup";
    await layer.createSession({ ...baseCommand, conversationId });
    faux.setResponses([fauxAssistantMessage("answer once")]);
    await layer.sendMessage({
      ...baseCommand,
      conversationId,
      prompt: "same message",
      requestId: "dup-1",
    });
    await waitForEvent(events, "turn_settled");
    const before = await layer.conversationEntries(conversationId, { limit: 100 });
    const usersBefore = kindCounts(before.items)["pi.user"] ?? 0;

    faux.setResponses([fauxAssistantMessage("answer twice")]);
    await layer.sendMessage({
      ...baseCommand,
      conversationId,
      prompt: "same message",
      requestId: "dup-1",
    });
    // 同 requestId：重投拿回同一 submission（已 done），不再放置新的 pi.user。
    await new Promise(resolve => setTimeout(resolve, 400));
    const after = await layer.conversationEntries(conversationId, { limit: 100 });
    const usersAfter = kindCounts(after.items)["pi.user"] ?? 0;
    assert.equal(usersBefore, 1);
    assert.equal(usersAfter, 1, "the same message is never placed twice");
    const doneEvents = events.filter(event => event.type === "message_done");
    assert.equal(doneEvents.length, 1, "exactly one final answer for the duplicated requestId");
  });
});

test("turn contract blocks tools through beforeTool", async () => {
  await withFixture(async ({ layer, events, faux, executedCalls }) => {
    const conversationId = "conv-contract";
    await layer.createSession({ ...baseCommand, conversationId });
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("bash", { command: "echo blocked" })], { stopReason: "toolUse" }),
      fauxAssistantMessage("answered without tools"),
    ]);
    await layer.sendMessage({
      ...baseCommand,
      conversationId,
      prompt: "projection only",
      turnPolicy: { toolAccess: "none", reason: "text_projection" },
    });
    await waitForEvent(events, "turn_settled");
    const policy = await waitForEvent(events, "turn_policy");
    assert.deepEqual(policy[0].tools, []);
    await waitForEvent(events, "turn_policy_cleared");
    const toolEnd = (await waitForEvent(events, "tool_call_end"))[0];
    assert.equal(toolEnd.isError, true);
    // 无工具回合的双重拦截：configure(tools:[]) 让调用不可达（tool_unavailable），
    // 回合中途（configure 从下一请求生效）由 beforeTool 的 contract 分支拦截。
    assert.match(
      String(toolEnd.content),
      /no-tools turn|not available/,
      `blocked without execution: ${toolEnd.content}`,
    );
    assert.equal(executedCalls.length, 0);
  });
});

test("steering a busy conversation queues in pi.inbox and projects queue_update", async () => {
  await withFixture(async ({ layer, events, faux, maps }) => {
    const conversationId = "conv-steer";
    await layer.createSession({ ...baseCommand, conversationId });
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("bash", { command: "sleep" })], { stopReason: "toolUse" }),
      fauxAssistantMessage("steered answer"),
    ]);
    await layer.sendMessage({ ...baseCommand, conversationId, prompt: "start slow" });
    await waitForEvent(events, "tool_call_start");
    await steerSession(maps.sessions, { conversationId, prompt: "STEER-TEXT" });
    const queue = await waitForEvent(events, "queue_update",
      event => (event.steering ?? []).includes("STEER-TEXT"));
    assert.deepEqual(queue[0].steering, ["STEER-TEXT"]);
    await waitForEvent(events, "turn_settled", undefined, 20000);
  });
});
