// PR-2 批次 C2 测试：门开路径的子代理·异步路面（pi-subagents 包那条 async 派活路
// 的 Harness 迁移）。
//
// 覆盖（对照施工单验收清单）：
//   ① async spawn → run 立即返回（收据不含 child 答案）→ child 在 background
//      会话真跑（bash 落 exec-log）→ 完成通知以 follow-up 输入唤醒父会话（第二个
//      回合 + pi.user 通知条目）→ 状态工具可取完整结果；
//   ② foreground spawn（async:false）→ 等待 → child 答案经工具结果回传，无通知
//      投递；
//   ③ agent 定义解析：milksu-route/X 模型串在 route provider 注册进 harness Models
//      时命中（child agent 的 model= milksu-route/faux-1，faux 走 route 流真实跑）；
//      解析不了的按 C1 parseSubagentModelOverride 语义抛错降级（工具结果 isError +
//      明确报错 + roster 行 failed）；
//   ④ 状态查询（列表/单 run）/steer（live run 投递回执）/停止（abortTask 级联，
//      child 的 bash 被 abort signal 提前唤醒）/超时（deadline 收场 + failed 通知）；
//   ⑥ 审判链对新工具自动生效：ask 档 spawn 弹卡（共享 subagent grantKey）、拒绝即
//      零 spawn、控制三件同判。
//   崩溃场景 ⑤（真 SIGKILL：async run 飞行中杀→重开→所有权索引找回同一 child→
//   requestId 幂等→run 收尾→通知仍达）在 harness-bridge-subagents-async-crash.test.js。
//
// faux 调度：async 路面的父/child 生成并发（spawn 收据后父回合继续、anchor 同时
// 起 child），响应队列的先后不定序——全部用**按消息内容分派**的 faux 工厂
//（pi-ai faux 的 FauxResponseFactory 收 TranscriptContext），测试对时序不敏感。
//
// 红线：faux provider 零网络零密钥；数据全在 mkdtemp 临时目录。

import assert from "node:assert/strict";
import test from "node:test";
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { Type } from "typebox";
import { defineTool } from "@earendil-works/pi-durable";
import {
  buildTestLayer,
  makeFauxModels,
  waitForEvent,
} from "./harness-bridge-test-support.mjs";
import {
  expandHarnessSubagentAsyncToolNames,
  MILKSU_SUBAGENTS_ASYNC_EXTENSION,
  MILKSU_SUBAGENT_ASYNC_TOOL_NAMES,
} from "./harness-bridge-subagents-async.js";
import { buildRouteProvider } from "./harness-model-providers.js";
import { mountedHarnessToolNames } from "./harness-bridge-tools.js";

const originalCwd = process.cwd();

const goCommand = {
  provider: "faux",
  model: "faux-1",
  locale: "zh",
  executionMode: "go",
  approvalPolicy: "full-auto",
};

/** 测试 bash：sleep 可被 abort signal 提前唤醒（stop/timeout/abort 场景不拖满）。 */
function makeAsyncTestBashTool({ workspace, sleepMs }) {
  return defineTool({
    name: "bash",
    description: "test bash",
    parameters: Type.Object({
      command: Type.String(),
      timeout: Type.Optional(Type.Number()),
    }),
    async execute(args, api, context) {
      api.output(`ran ${args.command}\n`);
      if (args.command === "sleep") {
        await appendFile(join(workspace, "exec-log.txt"), `${Date.now()}\n`);
        api.output("sleeping\n");
        await new Promise(resolve => {
          const timer = setTimeout(resolve, sleepMs);
          context?.abortSignal?.addEventListener("abort", () => {
            clearTimeout(timer);
            resolve();
          }, { once: true });
        });
        api.output("slept\n");
      }
      return {};
    },
  });
}

/**
 * 内容分派 faux 工厂：rules 为 [{match(userText, roundAfterTool), respond(...)}]；
 * 找不到匹配回 fallback 文本。对父/child 并发生成不定序（见文件头）。roundAfterTool
 * 只看**最后一条消息**是否为本回合的工具结果（整段历史里有 toolResult 不代表本
 * 回合已过工具——父会话第二轮的首次生成仍应给工具调用）。
 */
function makeDispatcher(rules, fallback = "unhandled dispatch") {
  return context => {
    const messages = Array.isArray(context?.messages) ? context.messages : [];
    const lastUser = [...messages].reverse().find(message => message?.role === "user");
    const userText = typeof lastUser?.content === "string"
      ? lastUser.content
      : Array.isArray(lastUser?.content)
        ? lastUser.content.filter(block => block?.type === "text").map(block => String(block?.text ?? "")).join("")
        : "";
    const roundAfterTool = messages[messages.length - 1]?.role === "toolResult";
    for (const rule of rules) {
      if (rule.match(userText, roundAfterTool)) return rule.respond(userText, roundAfterTool);
    }
    return fauxAssistantMessage(fallback);
  };
}

/** 装满队列（并发回合数有界；分派器无状态可复用）。 */
function installDispatcher(faux, dispatcher, copies = 16) {
  faux.setResponses(Array.from({ length: copies }, () => dispatcher));
}

async function readToolResults(layer, conversationId, limit = 100) {
  const page = await layer.conversationEntries(conversationId, { limit });
  return [...page.items]
    .reverse()
    .map(item => (item.model ?? []).find(message => message?.role === "toolResult"))
    .filter(Boolean);
}

function entryUserText(entry) {
  const message = (entry?.model ?? []).find(candidate => candidate?.role === "user");
  if (typeof message?.content === "string") return message.content;
  if (Array.isArray(message?.content)) {
    return message.content.filter(block => block?.type === "text").map(block => String(block?.text ?? "")).join("");
  }
  return "";
}

async function readUserEntries(layer, conversationId, limit = 100) {
  const page = await layer.conversationEntries(conversationId, { limit });
  return [...page.items].reverse().filter(item => item.kind === "pi.user");
}

async function readChildAgent(layer, conversationId) {
  const handle = await layer.harnessHandle();
  const conversation = await handle.harness.conversation(conversationId, BACKGROUND_CONTEXT);
  return conversation.agent(BACKGROUND_CONTEXT);
}

async function waitFor(predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await predicate()) return;
    if (Date.now() > deadline) throw new Error(`timeout waiting for ${label}`);
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}

async function withAsyncFixture(run, optionsOrFactory = {}) {
  const root = await mkdtemp(join(tmpdir(), "milksu-harness-c2-"));
  const agentDir = join(root, "agent");
  const workspace = join(root, "workspace");
  await mkdir(workspace, { recursive: true });
  process.chdir(workspace);
  const options = typeof optionsOrFactory === "function"
    ? await optionsOrFactory(workspace)
    : optionsOrFactory;
  const { faux, models } = makeFauxModels();
  const { layer, events, emit, maps, approvalBroker } = buildTestLayer({
    agentDir,
    workspace,
    faux,
    models,
    keepProductTools: true,
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

/** 等到第 n 个 turn_settled（通知触发的额外回合用）。 */
async function waitForTurnSettled(events, count, timeoutMs = 30000) {
  await waitFor(
    () => events.filter(event => event.type === "turn_settled").length >= count,
    timeoutMs,
    `${count} turn_settled events`,
  );
}

// ---------- 单元面：挂载名扩展与清单 ----------

test("tool-name expansion adds the async surface only alongside subagent", () => {
  assert.deepEqual(expandHarnessSubagentAsyncToolNames([]), []);
  assert.deepEqual(expandHarnessSubagentAsyncToolNames(["bash", "read"]), ["bash", "read"]);
  assert.deepEqual(expandHarnessSubagentAsyncToolNames(["bash", "subagent"]), [
    "bash", "subagent", ...MILKSU_SUBAGENT_ASYNC_TOOL_NAMES,
  ]);
  // 重复名不重复挂。
  assert.deepEqual(
    expandHarnessSubagentAsyncToolNames(["subagent", "subagent_async"]),
    ["subagent", "subagent_async", "subagent_async_status", "subagent_async_steer", "subagent_async_stop"],
  );
  for (const name of MILKSU_SUBAGENT_ASYNC_TOOL_NAMES) {
    assert.ok(mountedHarnessToolNames.includes(name), `${name} is in the mounted list`);
  }
  assert.equal(MILKSU_SUBAGENTS_ASYNC_EXTENSION, "milksu-subagents-async");
});

// ---------- ① async spawn → 收据 → background 真跑 → 完成通知 → 结果可取 ----------

test("async spawn returns a receipt immediately, the child runs in background, and completion wakes the parent", async () => {
  await withAsyncFixture(async ({ layer, events, faux, workspace }) => {
    const alias = "conv-async-1";
    let spawnedRunId = "";
    installDispatcher(faux, makeDispatcher([
      {
        match: text => text.includes("delegate async"),
        respond: (_text, hasToolResult) => (
          hasToolResult
            ? fauxAssistantMessage("spawned, waiting for the native wake")
            : fauxAssistantMessage(
              [fauxToolCall("subagent_async", { agent: "worker", task: "write the async report" })],
              { stopReason: "toolUse" },
            )
        ),
      },
      {
        match: text => text.startsWith("Background task"),
        respond: () => fauxAssistantMessage("notification acknowledged"),
      },
      {
        match: text => text.includes("check the status"),
        respond: (_text, hasToolResult) => (
          hasToolResult
            ? fauxAssistantMessage("status reviewed")
            : fauxAssistantMessage(
              [fauxToolCall("subagent_async_status", { id: spawnedRunId })],
              { stopReason: "toolUse" },
            )
        ),
      },
      // child 会话：首轮派 bash，bash 结果回来后给终答。
      {
        match: text => text.includes("write the async report"),
        respond: (_text, hasToolResult) => (
          hasToolResult
            ? fauxAssistantMessage("async child final answer")
            : fauxAssistantMessage([fauxToolCall("bash", { command: "sleep" })], { stopReason: "toolUse" })
        ),
      },
    ]));

    await layer.createSession({ ...goCommand, conversationId: alias });
    await layer.sendMessage({
      ...goCommand, conversationId: alias, prompt: "delegate async", requestId: "async-1",
    });
    await waitForTurnSettled(events, 1);

    // 收据立即返回：工具结果是 Async 收据（不含 child 答案），runId 可提取。
    const [receipt] = await readToolResults(layer, alias);
    assert.match(JSON.stringify(receipt.content), /Async: worker \[/);
    assert.equal(receipt.isError, false);
    spawnedRunId = /Async: worker \[([^\]]+)\]/.exec(JSON.stringify(receipt.content))?.[1] ?? "";
    assert.ok(spawnedRunId, "receipt carries a run id");

    // child 在 background 真跑：注册表 running 行 + exec-log 落行。
    await waitFor(() => (
      layer.subagentAsyncChildren(alias).some(child => child.runId === spawnedRunId)
    ), 15000, "async child registration");
    await waitFor(async () => (
      (await readFile(join(workspace, "exec-log.txt"), "utf8").catch(() => "")).split("\n").filter(Boolean).length >= 1
    ), 15000, "child bash execution");

    // 完成通知：第二个回合（follow-up 输入触发）+ pi.user 通知条目。
    await waitForTurnSettled(events, 2);
    const userEntries = await readUserEntries(layer, alias);
    const notice = userEntries.find(entry => entryUserText(entry).startsWith("Background task completed"));
    assert.ok(notice, "parent transcript carries the completion notification input");
    const noticeText = entryUserText(notice);
    assert.match(noticeText, /Background task completed: \*\*worker\*\*/);
    assert.match(noticeText, /async child final answer/);
    assert.match(noticeText, new RegExp(`Run: ${spawnedRunId}`));

    // roster 行收尾为 succeeded（渲染器投影无 runId 字段——按角色+摘要判）。
    await waitFor(() => {
      const rows = events.filter(event => event.type === "subagent_tasks").at(-1)?.subagentTasks ?? [];
      return rows.some(row => (
        row.role === "worker" && row.status === "succeeded" && /async child final answer/.test(row.summary ?? "")
      ));
    }, 15000, "roster succeeded row");
    const finalRows = events.filter(event => event.type === "subagent_tasks").at(-1)?.subagentTasks ?? [];
    const row = finalRows.find(entry => entry.role === "worker" && entry.status === "succeeded");
    assert.match(row.summary, /async child final answer/);
    assert.equal(row.exitCode, 0);

    // 结果可取：状态工具按 runId 给出完整答案。
    await layer.sendMessage({
      ...goCommand, conversationId: alias, prompt: "check the status", requestId: "async-1-status",
    });
    await waitForTurnSettled(events, 3);
    const results = await readToolResults(layer, alias);
    const statusResult = results.find(result => /run: /.test(JSON.stringify(result.content)));
    assert.ok(statusResult, "status tool result present");
    const statusText = JSON.stringify(statusResult.content);
    assert.match(statusText, new RegExp(`run: ${spawnedRunId}`));
    assert.match(statusText, /status: succeeded/);
    assert.match(statusText, /async child final answer/);
  }, workspace => ({
    extraTools: [makeAsyncTestBashTool({ workspace, sleepMs: 800 })],
  }));
});

// ---------- ② foreground spawn → 等待 → 结果回传 ----------

test("foreground spawn (async:false) waits and returns the child answer without a notification", async () => {
  await withAsyncFixture(async ({ layer, events, faux }) => {
    const alias = "conv-fg-1";
    installDispatcher(faux, makeDispatcher([
      {
        match: text => text.includes("delegate sync"),
        respond: (_text, hasToolResult) => (
          hasToolResult
            ? fauxAssistantMessage("parent received the answer")
            : fauxAssistantMessage(
              [fauxToolCall("subagent_async", { agent: "worker", task: "quick sync job", async: false })],
              { stopReason: "toolUse" },
            )
        ),
      },
      {
        match: text => text.includes("quick sync job"),
        respond: () => fauxAssistantMessage("foreground child answer"),
      },
    ]));

    await layer.createSession({ ...goCommand, conversationId: alias });
    await layer.sendMessage({
      ...goCommand, conversationId: alias, prompt: "delegate sync", requestId: "fg-1",
    });
    await waitForTurnSettled(events, 1);

    // 前台等待：工具结果直接携带 child 终答。
    const [result] = await readToolResults(layer, alias);
    assert.equal(result.isError, false);
    assert.match(JSON.stringify(result.content), /foreground child answer/);

    // 无通知投递：转录里没有 Background task 输入。
    const userEntries = await readUserEntries(layer, alias);
    assert.equal(
      userEntries.filter(entry => entryUserText(entry).startsWith("Background task")).length,
      0,
      "foreground runs post no completion notification",
    );

    // roster 行 succeeded。
    await waitFor(() => {
      const rows = events.filter(event => event.type === "subagent_tasks").at(-1)?.subagentTasks ?? [];
      return rows.some(row => row.status === "succeeded" && /foreground child answer/.test(row.summary ?? ""));
    }, 15000, "foreground roster row");
  }, workspace => ({
    extraTools: [makeAsyncTestBashTool({ workspace, sleepMs: 10 })],
  }));
});

// ---------- ③ agent 定义解析：milksu-route 命中 / 不可解析降级 ----------

/** 临时钉包根（<root>/agents 下重定义两个 builtin 角色名并带 model 串——
 * maiRecord 形态的自定义定义；MilkSU 的校验契约（validateSubagentInput 的
 * builtinAgents）只认 13 个钉包角色名，自定义名会被审判链拒绝，故用
 * worker/reviewer 两个契约内名字承载 model 串）。
 * MILKSU_PI_SUBAGENTS_ROOT 指到 root，readBundledAgentDefinitions 读 root/agents。 */
async function writeRouteAgentFixture(root) {
  const agentsDir = join(root, "agents");
  await mkdir(agentsDir, { recursive: true });
  await writeFile(join(agentsDir, "worker.md"), [
    "---",
    "name: worker",
    "description: General-purpose worker on the routed model",
    "tools: read",
    "thinking: low",
    "systemPromptMode: replace",
    "model: milksu-route/faux-1",
    "---",
    "",
    "You are a routed worker subagent.",
    "",
  ].join("\n"));
  await writeFile(join(agentsDir, "reviewer.md"), [
    "---",
    "name: reviewer",
    "description: Reviewer on an unresolvable model",
    "tools: read",
    "systemPromptMode: replace",
    "model: milksu-route/does-not-exist",
    "---",
    "",
    "You are a broken reviewer subagent.",
    "",
  ].join("\n"));
  return root;
}

test("agent definitions parse milksu-route model strings; unresolvable ones degrade with the C1 error", async () => {
  await withAsyncFixture(async ({ layer, events, faux, models }) => {
    // route provider 注册进 harness Models（B1 的 route 面：sources 指到本层 faux，
    // child 的生成经 route 流真实跑回 faux 队列——分派器所见）。
    const route = buildRouteProvider({
      sources: [{ provider: "faux", model: faux.getModel("faux-1") }],
      models,
    });
    models.setProvider(route);

    const alias = "conv-route-1";
    installDispatcher(faux, makeDispatcher([
      {
        match: text => text.includes("delegate routed"),
        respond: (_text, hasToolResult) => (
          hasToolResult
            ? fauxAssistantMessage("routed run handled")
            : fauxAssistantMessage(
              [fauxToolCall("subagent_async", { agent: "worker", task: "routed job" })],
              { stopReason: "toolUse" },
            )
        ),
      },
      {
        match: text => text.startsWith("Background task"),
        respond: () => fauxAssistantMessage("routed notification acknowledged"),
      },
      {
        match: text => text.includes("delegate broken"),
        respond: (_text, hasToolResult) => (
          hasToolResult
            ? fauxAssistantMessage("broken run reported")
            : fauxAssistantMessage(
              [fauxToolCall("subagent_async", { agent: "reviewer", task: "broken job" })],
              { stopReason: "toolUse" },
            )
        ),
      },
      {
        match: text => text.includes("routed job"),
        respond: () => fauxAssistantMessage("routed child answer"),
      },
    ]));

    await layer.createSession({ ...goCommand, conversationId: alias });
    // 命中分支：milksu-route/faux-1 解析成功，child 真的经 route provider 跑。
    await layer.sendMessage({
      ...goCommand, conversationId: alias, prompt: "delegate routed", requestId: "route-1",
    });
    await waitFor(() => (
      layer.subagentAsyncChildren(alias).some(child => child.role === "worker")
    ), 15000, "worker child registration");
    const child = layer.subagentAsyncChildren(alias).find(entry => entry.role === "worker");
    const childAgent = await readChildAgent(layer, child.conversationId);
    assert.deepEqual(childAgent.model, { provider: "milksu-route", modelId: "faux-1" });
    await waitForTurnSettled(events, 2);
    const routedResults = await readToolResults(layer, alias);
    assert.match(JSON.stringify(routedResults[0].content), /Async: worker \[/);
    await waitFor(async () => {
      const entries = await readUserEntries(layer, alias);
      return entries.some(entry => (
        entryUserText(entry).startsWith("Background task completed")
        && entryUserText(entry).includes("routed child answer")
      ));
    }, 30000, "routed completion notification");

    // 降级分支：解析不了的模型串按 C1 语义抛错——工具结果 isError + 明确报错。
    await layer.sendMessage({
      ...goCommand, conversationId: alias, prompt: "delegate broken", requestId: "route-2",
    });
    await waitForTurnSettled(events, 3);
    const results = await readToolResults(layer, alias);
    const broken = results.find(result => /does-not-exist/.test(JSON.stringify(result.content)));
    assert.ok(broken, "broken model error surfaces in the tool result");
    assert.equal(broken.isError, true);
    assert.match(
      JSON.stringify(broken.content),
      /MilkSU subagent model override has no model milksu-route\/does-not-exist/,
    );
    // 零 anchor 任务创建（降级在 spawn 期拦截）。
    const children = layer.subagentAsyncChildren(alias).filter(entry => entry.role === "reviewer");
    assert.equal(children.length, 0, "no anchor or child for the broken definition");
    // roster 行按失败收尾（start 行兜底）。
    await waitFor(() => {
      const rows = events.filter(event => event.type === "subagent_tasks").at(-1)?.subagentTasks ?? [];
      return rows.some(row => row.role === "reviewer" && row.status === "failed");
    }, 15000, "broken roster row");
  }, async workspace => ({
    // 临时钉包根（maiRecord 形态的自定义 agent 定义）：经 MILKSU_PI_SUBAGENTS_ROOT
    // 覆盖 readBundledAgentDefinitions 的解析源。
    environment: { MILKSU_PI_SUBAGENTS_ROOT: await writeRouteAgentFixture(dirname(workspace)) },
    extraTools: [makeAsyncTestBashTool({ workspace, sleepMs: 10 })],
  }));
});

// ---------- ④ 控制面：列表 / steer / stop / 超时 ----------

test("status lists runs and steer delivers to a live run", async () => {
  await withAsyncFixture(async ({ layer, events, faux }) => {
    const alias = "conv-control-1";
    let spawnedRunId = "";
    installDispatcher(faux, makeDispatcher([
      {
        match: text => text.includes("delegate slow"),
        respond: (_text, hasToolResult) => (
          hasToolResult
            ? fauxAssistantMessage("slow run spawned")
            : fauxAssistantMessage(
              [fauxToolCall("subagent_async", { agent: "worker", task: "slow background job" })],
              { stopReason: "toolUse" },
            )
        ),
      },
      {
        match: text => text.includes("steer it"),
        respond: (_text, hasToolResult) => (
          hasToolResult
            ? fauxAssistantMessage("steer receipt received")
            : fauxAssistantMessage(
              [fauxToolCall("subagent_async_steer", { id: spawnedRunId, message: "focus on the budget" })],
              { stopReason: "toolUse" },
            )
        ),
      },
      {
        match: text => text.includes("list the runs"),
        respond: (_text, hasToolResult) => (
          hasToolResult
            ? fauxAssistantMessage("run list reviewed")
            : fauxAssistantMessage(
              [fauxToolCall("subagent_async_status", {})],
              { stopReason: "toolUse" },
            )
        ),
      },
      {
        match: text => text.startsWith("Background task"),
        respond: () => fauxAssistantMessage("slow notification acknowledged"),
      },
      {
        match: text => text.includes("slow background job"),
        respond: (_text, roundAfterTool) => (
          roundAfterTool
            ? fauxAssistantMessage("steered final answer")
            : fauxAssistantMessage([fauxToolCall("bash", { command: "sleep" })], { stopReason: "toolUse" })
        ),
      },
      // steer 投递的消息成为 child 的下一条 user 输入（in-run steering）。
      {
        match: text => text.includes("focus on the budget"),
        respond: () => fauxAssistantMessage("steered final answer"),
      },
    ]));

    await layer.createSession({ ...goCommand, conversationId: alias });
    await layer.sendMessage({
      ...goCommand, conversationId: alias, prompt: "delegate slow", requestId: "slow-1",
    });
    await waitForTurnSettled(events, 1);
    const [receipt] = await readToolResults(layer, alias);
    spawnedRunId = /Async: worker \[([^\]]+)\]/.exec(JSON.stringify(receipt.content))?.[1] ?? "";
    assert.ok(spawnedRunId);

    // steer：live run 投递回执（不阻塞），答案随完成通知回来。
    await layer.sendMessage({
      ...goCommand, conversationId: alias, prompt: "steer it", requestId: "slow-2",
    });
    await waitForTurnSettled(events, 2);
    const steerResult = (await readToolResults(layer, alias))
      .find(result => /Steered async subagent/.test(JSON.stringify(result.content)));
    assert.ok(steerResult, "steer receipt present");
    assert.match(JSON.stringify(steerResult.content), /steering/);

    // 完成通知带 steered 答案；列表面列出该 run。
    await waitFor(async () => {
      const entries = await readUserEntries(layer, alias);
      return entries.some(entry => {
        const text = entryUserText(entry);
        return text.startsWith("Background task completed") && text.includes("steered final answer");
      });
    }, 30000, "steered completion notification");

    await layer.sendMessage({
      ...goCommand, conversationId: alias, prompt: "list the runs", requestId: "slow-3",
    });
    await waitFor(async () => (
      (await readToolResults(layer, alias)).some(result => (
        /Async subagent runs:/.test(JSON.stringify(result.content))
        && new RegExp(spawnedRunId).test(JSON.stringify(result.content))
        && /succeeded/.test(JSON.stringify(result.content))
      ))
    ), 30000, "status list result");
  }, workspace => ({
    extraTools: [makeAsyncTestBashTool({ workspace, sleepMs: 3000 })],
  }));
});

test("stop aborts a live run (child bash wakes on abort) and the roster closes it failed", async () => {
  await withAsyncFixture(async ({ layer, events, faux }) => {
    const alias = "conv-stop-1";
    let spawnedRunId = "";
    installDispatcher(faux, makeDispatcher([
      {
        match: text => text.includes("delegate long"),
        respond: (_text, hasToolResult) => (
          hasToolResult
            ? fauxAssistantMessage("long run spawned")
            : fauxAssistantMessage(
              [fauxToolCall("subagent_async", { agent: "worker", task: "very long job" })],
              { stopReason: "toolUse" },
            )
        ),
      },
      {
        match: text => text.includes("stop it"),
        respond: (_text, hasToolResult) => (
          hasToolResult
            ? fauxAssistantMessage("stopped")
            : fauxAssistantMessage(
              [fauxToolCall("subagent_async_stop", { id: spawnedRunId })],
              { stopReason: "toolUse" },
            )
        ),
      },
      {
        match: text => text.includes("very long job"),
        respond: (_text, hasToolResult) => (
          hasToolResult
            ? fauxAssistantMessage("long child answer")
            : fauxAssistantMessage([fauxToolCall("bash", { command: "sleep" })], { stopReason: "toolUse" })
        ),
      },
    ]));

    await layer.createSession({ ...goCommand, conversationId: alias });
    await layer.sendMessage({
      ...goCommand, conversationId: alias, prompt: "delegate long", requestId: "stop-1",
    });
    await waitForTurnSettled(events, 1);
    const [receipt] = await readToolResults(layer, alias);
    spawnedRunId = /Async: worker \[([^\]]+)\]/.exec(JSON.stringify(receipt.content))?.[1] ?? "";
    assert.ok(spawnedRunId);

    await layer.sendMessage({
      ...goCommand, conversationId: alias, prompt: "stop it", requestId: "stop-2",
    });
    await waitForTurnSettled(events, 2);
    const stopResult = (await readToolResults(layer, alias))
      .find(result => /Stopped async subagent/.test(JSON.stringify(result.content)));
    assert.ok(stopResult, "stop receipt present");

    // abortTask 级联：anchor 终态 + roster 行 failed + 注册表收场（渲染器投影无
    // runId 字段——按角色+摘要判；全量套件并发负载下级联可能超过 15s，放宽到 30s）。
    await waitFor(() => {
      const rows = events.filter(event => event.type === "subagent_tasks").at(-1)?.subagentTasks ?? [];
      return rows.some(row => (
        row.role === "worker" && row.status === "failed" && /stopped by user/.test(row.summary ?? "")
      ));
    }, 30000, "stopped roster row");
    const registry = layer.subagentAsyncChildren(alias).filter(child => child.runId === spawnedRunId);
    assert.ok(registry.every(child => child.status === "failed"));
  }, workspace => ({
    extraTools: [makeAsyncTestBashTool({ workspace, sleepMs: 20000 })],
  }));
});

test("a deadline timeout fails the run, aborts the child, and posts the failure notification", async () => {
  await withAsyncFixture(async ({ layer, events, faux }) => {
    const alias = "conv-timeout-1";
    installDispatcher(faux, makeDispatcher([
      {
        match: text => text.includes("delegate tight"),
        respond: (_text, hasToolResult) => (
          hasToolResult
            ? fauxAssistantMessage("tight run spawned")
            : fauxAssistantMessage(
              [fauxToolCall("subagent_async", { agent: "worker", task: "tight deadline job", timeoutMs: 700 })],
              { stopReason: "toolUse" },
            )
        ),
      },
      {
        match: text => text.startsWith("Background task"),
        respond: () => fauxAssistantMessage("timeout notification acknowledged"),
      },
      {
        match: text => text.includes("tight deadline job"),
        respond: (_text, hasToolResult) => (
          hasToolResult
            ? fauxAssistantMessage("late child answer")
            : fauxAssistantMessage([fauxToolCall("bash", { command: "sleep" })], { stopReason: "toolUse" })
        ),
      },
    ]));

    await layer.createSession({ ...goCommand, conversationId: alias });
    await layer.sendMessage({
      ...goCommand, conversationId: alias, prompt: "delegate tight", requestId: "timeout-1",
    });
    // 完成通知（failed）在 deadline 后到达。
    await waitFor(async () => {
      const entries = await readUserEntries(layer, alias);
      return entries.some(entry => {
        const text = entryUserText(entry);
        return text.startsWith("Background task failed") && text.includes("Subagent timed out.");
      });
    }, 30000, "timeout failure notification");
    await waitFor(() => {
      const rows = events.filter(event => event.type === "subagent_tasks").at(-1)?.subagentTasks ?? [];
      return rows.some(row => row.status === "failed" && /Subagent timed out/.test(row.summary ?? ""));
    }, 15000, "timeout roster row");
  }, workspace => ({
    extraTools: [makeAsyncTestBashTool({ workspace, sleepMs: 30000 })],
  }));
});

// ---------- ⑥ 审判链：ask 档逐次审批（共享 subagent grantKey），拒绝零 spawn ----------

test("the judge chain gates the async surface: ask policy pops the shared subagent card and denial blocks the spawn", async () => {
  const requested = [];
  await withAsyncFixture(async ({ layer, events, faux }) => {
    const alias = "conv-async-approval";
    installDispatcher(faux, makeDispatcher([
      {
        match: text => text.includes("delegate gated"),
        respond: (_text, hasToolResult) => (
          hasToolResult
            ? fauxAssistantMessage("gated spawn handled")
            : fauxAssistantMessage(
              [fauxToolCall("subagent_async", { agent: "scout", task: "scan the tree" })],
              { stopReason: "toolUse" },
            )
        ),
      },
      {
        match: text => text.includes("list gated runs"),
        respond: (_text, hasToolResult) => (
          hasToolResult
            ? fauxAssistantMessage("gated list handled")
            : fauxAssistantMessage(
              [fauxToolCall("subagent_async_status", {})],
              { stopReason: "toolUse" },
            )
        ),
      },
    ]));

    await layer.createSession({ ...goCommand, conversationId: alias, approvalPolicy: "ask" });
    await layer.sendMessage({
      ...goCommand, conversationId: alias, prompt: "delegate gated", requestId: "gated-1",
      approvalPolicy: "ask",
    });
    await waitForTurnSettled(events, 1);
    assert.equal(requested.length, 1, "spawn pops one approval card");
    assert.equal(requested[0].toolName, "subagent_async");
    assert.match(requested[0].content, /single · 1 个后台 Pi 会话/);
    assert.match(requested[0].content, /scout/);
    const [denied] = await readToolResults(layer, alias);
    assert.match(JSON.stringify(denied.content), /MilkSU user denied subagent delegation/);
    assert.equal(layer.subagentAsyncChildren(alias).length, 0, "denial spawns nothing");

    // 控制三件同判（ask 档逐次审批，grantKey 与 subagent 共享）。
    await layer.sendMessage({
      ...goCommand, conversationId: alias, prompt: "list gated runs", requestId: "gated-2",
      approvalPolicy: "ask",
    });
    await waitForTurnSettled(events, 2);
    assert.equal(requested.length, 2, "the status control tool asks under ask policy too");
    assert.equal(requested[1].toolName, "subagent_async_status");
    const blocked = (await readToolResults(layer, alias)).at(-1);
    assert.match(JSON.stringify(blocked.content), /MilkSU user denied subagent delegation/);
  }, workspace => ({
    approvalBehavior: () => "deny",
    onEvent: record => {
      if (record.type === "approval_requested") requested.push(record);
    },
    extraTools: [makeAsyncTestBashTool({ workspace, sleepMs: 10 })],
  }));
});

// ---------- destroySession 收尾：background anchor 的显式 abortTask ----------

test("destroySession halts live async runs: anchors abort, the registry clears, children settle aborted", async () => {
  await withAsyncFixture(async ({ layer, events, faux }) => {
    const alias = "conv-destroy-1";
    let anchorTaskId = 0;
    installDispatcher(faux, makeDispatcher([
      {
        match: text => text.includes("delegate doomed"),
        respond: (_text, roundAfterTool) => (
          roundAfterTool
            ? fauxAssistantMessage("doomed run spawned")
            : fauxAssistantMessage(
              [fauxToolCall("subagent_async", { agent: "worker", task: "doomed long job" })],
              { stopReason: "toolUse" },
            )
        ),
      },
      {
        match: text => text.includes("doomed long job"),
        respond: (_text, roundAfterTool) => (
          roundAfterTool
            ? fauxAssistantMessage("never reached")
            : fauxAssistantMessage([fauxToolCall("bash", { command: "sleep" })], { stopReason: "toolUse" })
        ),
      },
    ]));

    await layer.createSession({ ...goCommand, conversationId: alias });
    await layer.sendMessage({
      ...goCommand, conversationId: alias, prompt: "delegate doomed", requestId: "destroy-1",
    });
    await waitForTurnSettled(events, 1);
    await waitFor(() => (
      layer.subagentAsyncChildren(alias).some(child => child.conversationId !== undefined)
    ), 15000, "doomed child registration");
    anchorTaskId = layer.subagentAsyncChildren(alias)[0].anchorTaskId;
    assert.ok(anchorTaskId, "anchor task id recorded");

    // destroySession：async halt 对在飞 anchor 显式收场（child abort + abortTask；
    // background 边界不随父会话级联）+ registry 清场。
    await layer.destroySession({ conversationId: alias });
    await waitForEvent(events, "session_destroyed", () => true, 15000);
    assert.equal(layer.subagentAsyncChildren(alias).length, 0, "registry cleared by the halt");

    // anchor 终态为 aborted（engine 自底向上收场 child 子树后 abort handler 提交）。
    const handle = await layer.harnessHandle();
    await waitFor(async () => {
      const record = await handle.harness.getTask(anchorTaskId, undefined);
      return record?.state?.status === "terminal" && record?.state?.outcome?.status === "aborted";
    }, 30000, "anchor aborted terminal state");
  }, workspace => ({
    extraTools: [makeAsyncTestBashTool({ workspace, sleepMs: 30000 })],
  }));
});
