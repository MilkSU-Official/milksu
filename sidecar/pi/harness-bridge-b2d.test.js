// PR-2 批次 B2d：暂缓清单收尾票（上半夜场）。
//
// 本文件按批次拆分（与 harness-bridge-b2/b2c.test.js 同构）：faux provider、零网络、
// 数据全在临时目录、进程内 chdir 工作区。逐项对照工单：
//
//   T1 workflow 系统提示段 —— 门关 before_agent_start 的
//     composeMilkSUWorkflowSystemPrompt（bridge.js:977）拼「角色指引/运行时上下文/
//     工作区身份/引号引用」到完整系统提示末尾；门开以 milksu-workflow section
//     （milksu-core 末位、cwd 段之后）渲染同一份后缀。断言：后缀构造器与门关拼装
//     的关系、e2e 的 pi.system 条目带段、段序（cwd 之后）、角色/无角色两形态。
//
// 进程纪律：与 harness-bridge-b2.test.js 相同——产品工具面按进程 cwd 解析工作区，
// 在临时工作区 chdir 后跑，finally 恢复（node --test 每文件独立进程）。

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  composeMilkSUWorkflowSystemPrompt,
  milkSUWorkflowSystemPromptSuffix,
} from "./bridge-workflow-prompt.js";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import {
  buildTestLayer,
  makeFauxModels,
  waitForEvent,
} from "./harness-bridge-test-support.mjs";

const originalCwd = process.cwd();

async function withB2dFixture(run, options = {}) {
  const root = await mkdtemp(join(tmpdir(), "milksu-harness-b2d-"));
  const agentDir = join(root, "agent");
  const workspace = join(root, "workspace");
  const bgTasksDir = join(root, "bg-tasks");
  await mkdir(workspace, { recursive: true });
  process.chdir(workspace);
  // B2d：后台任务的磁盘面（meta/log）按 MILKSU_BACKGROUND_TASKS_DIR 隔离——本模块
  // 经层注入的 environment 读，reviewed bundle（listPiBackgroundTaskLog 等）读
  // process.env，两侧必须指向同一临时目录。MILKSU_WORKSPACE_RUNTIME 是受审 spawn 面
  //（bridge-policy reviewedBackgroundOutputPath）的私运行时根：bg 目录必须在它里面
  //（internal/engine/sidecar.go:313-330 的生产同款接线）。
  const previousBgDir = process.env.MILKSU_BACKGROUND_TASKS_DIR;
  const previousRuntime = process.env.MILKSU_WORKSPACE_RUNTIME;
  process.env.MILKSU_BACKGROUND_TASKS_DIR = bgTasksDir;
  process.env.MILKSU_WORKSPACE_RUNTIME = root;
  const { faux, models } = makeFauxModels();
  const { layer, events, emit, maps } = buildTestLayer({
    agentDir,
    workspace,
    faux,
    models,
    keepProductTools: true,
    ...options,
    environment: {
      ...(options.environment ?? {}),
      MILKSU_BACKGROUND_TASKS_DIR: bgTasksDir,
    },
  });
  try {
    return await run({ layer, events, emit, maps, faux, models, workspace, root, bgTasksDir });
  } finally {
    await layer.disposeAll();
    if (previousBgDir === undefined) delete process.env.MILKSU_BACKGROUND_TASKS_DIR;
    else process.env.MILKSU_BACKGROUND_TASKS_DIR = previousBgDir;
    if (previousRuntime === undefined) delete process.env.MILKSU_WORKSPACE_RUNTIME;
    else process.env.MILKSU_WORKSPACE_RUNTIME = previousRuntime;
    process.chdir(originalCwd);
    await rm(root, { recursive: true, force: true });
  }
}

const goCommand = {
  provider: "faux",
  model: "faux-1",
  locale: "zh",
  executionMode: "go",
  approvalPolicy: "ask",
};

// 收集 pi.system 条目里的 sections 记录（e2e 断言公用）。
async function systemSectionRecords(layer, alias) {
  const page = await layer.conversationEntries(alias, { limit: 100 });
  const records = [];
  for (const entry of page.items) {
    const message = entry.model?.[0];
    if (message?.role === "system" && message.sections) {
      records.push({ entry, sections: message.sections });
    }
  }
  return records;
}

// ---------- T1：workflow 系统提示段 ----------

test("the workflow suffix helper is exactly what gate-closed composes after the base prompt", () => {
  const policy = {
    uiLocale: "zh",
    workspace: "/tmp/milksu-ws",
    codingCollaboration: { workspace: "/tmp/milksu-ws" },
  };
  const suffix = milkSUWorkflowSystemPromptSuffix({ sessionRole: "strategist", policy });
  const composed = composeMilkSUWorkflowSystemPrompt("BASE", { sessionRole: "strategist", policy });
  // 门关拼装 = 基础提示 + 空行 + 后缀：同一构造器保证门开门开同一份文本。
  assert.equal(composed, `BASE\n\n${suffix}`);
  assert.match(suffix, /作为独立审阅者/, "role guidance leads the suffix");
  assert.match(suffix, /运行时上下文:/, "runtime context section is labeled");
  assert.match(suffix, /工作区身份:/, "workspace identity section is labeled");
  assert.match(suffix, /\[MilkSU quoted reference/, "quoted-reference guidance closes the suffix");
  // 段内次序：角色指引 → 运行时上下文 → 工作区身份 → 引号引用（与门关一致）。
  assert.ok(suffix.indexOf("作为独立审阅者") < suffix.indexOf("运行时上下文:"));
  assert.ok(suffix.indexOf("运行时上下文:") < suffix.indexOf("工作区身份:"));
  assert.ok(suffix.indexOf("工作区身份:") < suffix.indexOf("[MilkSU quoted reference"));
});

test("a gate-open turn renders the milksu-workflow section after cwd with the same suffix", async () => {
  await withB2dFixture(async ({ layer, events, faux, maps }) => {
    await layer.createSession({
      ...goCommand,
      conversationId: "conv-workflow",
      sessionRole: "strategist",
    });
    faux.setResponses([fauxAssistantMessage("ack")]);
    await layer.sendMessage({
      ...goCommand,
      conversationId: "conv-workflow",
      prompt: "hi",
      sessionRole: "strategist",
    });
    await waitForEvent(events, "turn_settled");

    const records = await systemSectionRecords(layer, "conv-workflow");
    const withWorkflow = records.filter(record => record.sections["milksu-workflow"] !== undefined);
    assert.ok(withWorkflow.length > 0, "a pi.system entry carries the milksu-workflow section");
    const latest = withWorkflow.at(-1);

    // 内容 = 同一后缀构造器按本会话角色/策略渲染（门关 before_agent_start 的等价物）。
    const policy = maps.sessionPolicies.get("conv-workflow");
    const expected = milkSUWorkflowSystemPromptSuffix({ sessionRole: "strategist", policy });
    assert.equal(latest.sections["milksu-workflow"], expected);
    assert.match(latest.sections["milksu-workflow"], /作为独立审阅者/);
    assert.match(latest.sections["milksu-workflow"], /运行时上下文:/);

    // 段序：baseline 条目里 cwd 在 milksu-workflow 之前（门关后缀也拼在 cwd 段之后）。
    const baseline = records.find(record => record.sections.cwd !== undefined);
    assert.ok(baseline, "a baseline pi.system entry carries the cwd section");
    const keys = Object.keys(baseline.sections);
    assert.ok(
      keys.indexOf("cwd") < keys.indexOf("milksu-workflow"),
      `cwd renders before milksu-workflow (keys: ${keys.join(",")})`,
    );
  }, { sessionRole: "strategist" });
});

test("role-less sessions still get runtime context and quoted reference (negative path)", async () => {
  await withB2dFixture(async ({ layer, events, faux }) => {
    await layer.createSession({ ...goCommand, conversationId: "conv-norole" });
    faux.setResponses([fauxAssistantMessage("ack")]);
    await layer.sendMessage({ ...goCommand, conversationId: "conv-norole", prompt: "hi" });
    await waitForEvent(events, "turn_settled");
    const records = await systemSectionRecords(layer, "conv-norole");
    const workflow = records
      .map(record => record.sections["milksu-workflow"])
      .filter(value => value !== undefined)
      .at(-1);
    assert.ok(workflow, "the workflow section renders without a role too");
    assert.ok(!workflow.includes("审阅者"), "no role guidance without a role");
    assert.match(workflow, /运行时上下文:/);
    assert.match(workflow, /\[MilkSU quoted reference/);
  });
});

// ---------- T2：bg_task / bg_status（C2 anchor 模式重建） ----------

/** 等一条用户输入条目（follow-up 通知回投断言用：轮询 conversationEntries）。 */
async function waitForUserEntry(layer, alias, matcher, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const page = await layer.conversationEntries(alias, { limit: 100 });
    for (const entry of page.items) {
      const message = entry.model?.[0];
      if (entry.kind !== "pi.user" || message?.role !== "user") continue;
      const content = typeof message.content === "string"
        ? message.content
        : Array.isArray(message.content)
          ? message.content.map(block => String(block?.text ?? "")).join("")
          : "";
      if (matcher(content)) return { entry, content };
    }
    if (Date.now() > deadline) throw new Error("timed out waiting for the user entry");
    await new Promise(resolve => setTimeout(resolve, 200));
  }
}

test("bg_task spawn runs for real behind the approval chain and notifies on completion", async () => {
  await withB2dFixture(async ({ layer, events, faux, maps }) => {
    await layer.createSession({ ...goCommand, conversationId: "conv-bg" });
    faux.setResponses([
      fauxAssistantMessage(
        [fauxToolCall("bg_task", {
          action: "spawn",
          command: "echo b2d-bg-real",
          name: "b2d-echo",
        })],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("started"),
      fauxAssistantMessage(
        [fauxToolCall("bg_status", { action: "list" })],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("checked"),
    ]);
    await layer.sendMessage({ ...goCommand, conversationId: "conv-bg", prompt: "run it" });
    await waitForEvent(events, "turn_settled", undefined, 20000);

    // 审批断言：spawn 是效果动作，ask 档弹卡（审判链对挂载的 bg 工具自动生效）。
    const requested = (await waitForEvent(events, "approval_requested",
      event => event.toolName === "bg_task"))[0];
    assert.ok(requested, "bg_task spawn asks for approval");
    assert.match(String(requested.content), /spawn/, "the card shows the spawn action");
    await waitForEvent(events, "approval_resolved", event => event.approved === true);

    // 执行断言：收据立即返回（bg_ id + 日志路径）。
    const spawnEnd = (await waitForEvent(events, "tool_call_end",
      event => event.toolName === "bg_task"))[0];
    assert.equal(spawnEnd.isError, false);
    assert.match(spawnEnd.content, /Started background process b2d-echo \(bg_/);
    assert.match(spawnEnd.content, /Log: .*bg-tasks.*output\.log/);
    const bgId = (spawnEnd.content.match(/\(bg_[a-z0-9_]+\)/) ?? [""])[0].slice(1, -1);

    // 完成通知回投：anchor 终态后 follow-up 输入唤醒会话（真 echo 进程 exit 0）。
    const notified = await waitForUserEntry(layer, "conv-bg",
      content => content.includes("Background task b2d-echo") && content.includes("succeeded"));
    assert.match(notified.content, new RegExp(`id=${bgId}`));
    await waitForEvent(events, "turn_settled", undefined, 20000);

    // bg_status 查 durable 真相：list 行含本任务与终态。
    const statusEnd = (await waitForEvent(events, "tool_call_end",
      event => event.toolName === "bg_status"))[0];
    assert.equal(statusEnd.isError, false);
    assert.match(statusEnd.content, new RegExp(`${bgId} b2d-echo process succeeded`));
    void maps;
  });
});

test("denying bg_task spawn blocks it before any process or task exists", async () => {
  await withB2dFixture(async ({ layer, events, faux, bgTasksDir }) => {
    await layer.createSession({ ...goCommand, conversationId: "conv-bg-deny" });
    faux.setResponses([
      fauxAssistantMessage(
        [fauxToolCall("bg_task", { action: "spawn", command: "echo denied" })],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("gave up"),
    ]);
    await layer.sendMessage({ ...goCommand, conversationId: "conv-bg-deny", prompt: "run it" });
    await waitForEvent(events, "turn_settled", undefined, 20000);
    await waitForEvent(events, "approval_requested", event => event.toolName === "bg_task");
    const toolEnd = (await waitForEvent(events, "tool_call_end",
      event => event.toolName === "bg_task"))[0];
    assert.equal(toolEnd.isError, true);
    assert.match(toolEnd.content, /MilkSU user denied bg_task/);
    // 拒绝零 spawn：磁盘面无任务目录，durable 无 anchor。
    const dirs = await readdir(bgTasksDir).catch(() => []);
    assert.deepEqual(dirs, [], "no bg task directories exist after denial");
  }, { approvalBehavior: () => "deny" });
});

test("bg_task watch polls until the success condition matches", async () => {
  await withB2dFixture(async ({ layer, events, faux }) => {
    await layer.createSession({ ...goCommand, conversationId: "conv-bg-watch" });
    faux.setResponses([
      fauxAssistantMessage(
        [fauxToolCall("bg_task", {
          action: "watch",
          command: 'echo \'{"ok":true}\'',
          interval_seconds: 1,
          timeout_seconds: 30,
          success_when: { type: "json_path_exists", path: "$.ok" },
        })],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("watching"),
      fauxAssistantMessage("done"),
    ]);
    await layer.sendMessage({ ...goCommand, conversationId: "conv-bg-watch", prompt: "watch it" });
    await waitForEvent(events, "turn_settled", undefined, 20000);
    const spawnEnd = (await waitForEvent(events, "tool_call_end",
      event => event.toolName === "bg_task"))[0];
    assert.equal(spawnEnd.isError, false);
    assert.match(spawnEnd.content, /Started background command_watch/);
    // watch 轮询到条件命中 → 终态通知（succeeded）。
    await waitForUserEntry(layer, "conv-bg-watch",
      content => content.includes("Background task") && content.includes("succeeded"),
      30000);
    await waitForEvent(events, "turn_settled", undefined, 20000);
  });
});

test("the desktop control surface spawns and stops real harness anchors", async () => {
  await withB2dFixture(async ({ layer, events }) => {
    await layer.createSession({ ...goCommand, conversationId: "conv-bg-desktop" });
    await layer.controlBackgroundTask({
      conversationId: "conv-bg-desktop",
      requestId: "bg-ctl-1",
      control: "spawn",
      command: "sleep 30",
      executionMode: "go",
      approvalPolicy: "ask",
    });
    const spawned = (await waitForEvent(events, "background_task_controlled",
      event => event.requestId === "bg-ctl-1"))[0];
    assert.equal(spawned.error, undefined);
    assert.equal(spawned.tasks.length, 1, "the desktop task shows in the projection");
    assert.equal(spawned.tasks[0].status, "running");
    assert.match(spawned.tasks[0].command, /sleep/);
    const bgId = spawned.tasks[0].id;

    await layer.controlBackgroundTask({
      conversationId: "conv-bg-desktop",
      requestId: "bg-ctl-2",
      control: "stop",
      taskId: bgId,
    });
    const stopped = (await waitForEvent(events, "background_task_controlled",
      event => event.requestId === "bg-ctl-2"))[0];
    assert.equal(stopped.error, undefined);
    assert.equal(stopped.tasks[0].status, "cancelled", "stop lands cancelled on the anchor");
  });
});
