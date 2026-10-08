// PR-2 批次 C1 测试：门开路径的子代理·协作工具路（MilkSU 自有 `subagent` 工具）。
//
// 覆盖（对照施工单验收清单）：
//   ① builtin 角色派活 → 子会话真跑 → 结果回传 → api.details 可见（child 会话
//      登记 + 工具结果 details）＋ 角色工具集/提示词/思考档/模型继承对照；
//   ③ 外部 CLI：审批弹卡→拒绝零 spawn；批准→假 CLI 执行→输出回传（cursor/
//      claude/codex 及 writer 变体，PATH 前置假可执行脚本）；
//   ④ worktree 消费面：writer-1 派活走隔离目录；未登记路径拒绝；上限 2（描述符
//      规整拒绝第三个 writer——normalizeCodingCollaboration）；
//   ⑤ abort 级联：父停→子停（child 会话 idle + run 收场）；
//   ⑥ 审判链：subagent 校验（未支持角色/多任务）+ 逐次审批（ask 档）+ 外部 CLI
//      恒审批；控制动作面（list/get/models/status/children.list/steer）+ 超时语义。
//   崩溃场景 ②（replay-safe：SIGKILL→重开→同 child→requestId 幂等→收尾）在
//   harness-bridge-subagents-crash.test.js（真 SIGKILL，照 harness-crash 模式）。
//
// 红线：faux provider 零网络零密钥；数据全在 mkdtemp 临时目录；外部 CLI 用 PATH
// 前置的假可执行脚本（preflight 的 version/help 校验走真实路径）。

import assert from "node:assert/strict";
import test from "node:test";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { Type } from "typebox";
import { defineTool } from "@earendil-works/pi-durable";
import {
  buildTestLayer,
  makeFauxModels,
  waitForEvent,
} from "./harness-bridge-test-support.mjs";

/** 测试 bash：sleep 可被 abort signal 提前唤醒（abort/timeout 场景不拖 20s）。 */
function makeSignalSleepBashTool({ workspace, sleepMs, onExecute }) {
  return defineTool({
    name: "bash",
    description: "test bash",
    parameters: Type.Object({
      command: Type.String(),
      timeout: Type.Optional(Type.Number()),
    }),
    async execute(args, api, context) {
      onExecute?.(args);
      api.output(`ran ${args.command}\n`);
      if (args.command === "sleep") {
        await new Promise(resolve => {
          const timer = setTimeout(resolve, sleepMs);
          timer.unref?.();
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
import {
  buildExternalCliPrompt,
  MILKSU_SUBAGENTS_EXTENSION,
  parseSubagentModelOverride,
  readBundledAgentDefinitions,
  resolveExternalCliLaunch,
  resolveRoleToolObjects,
} from "./harness-bridge-subagents.js";
import { normalizeCodingCollaboration } from "./bridge-collaboration.js";
import { projectSubagentRosterStart } from "./bridge-subagent-yield.js";

const originalCwd = process.cwd();

const goCommand = {
  provider: "faux",
  model: "faux-1",
  locale: "zh",
  executionMode: "go",
  approvalPolicy: "ask",
};

/** 外部 CLI 需要的进程环境子集（PATH 解析/preflight 用；binDirectory 前置假 CLI）。 */
const cliEnvironment = binDirectory => ({
  PATH: `${binDirectory}:${process.env.PATH}`,
  HOME: process.env.HOME,
  TMPDIR: process.env.TMPDIR,
});

async function withSubagentFixture(run, optionsOrFactory = {}) {
  const root = await mkdtemp(join(tmpdir(), "milksu-harness-c1-"));
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

async function readChildAgent(layer, conversationId) {
  const handle = await layer.harnessHandle();
  const conversation = await handle.harness.conversation(conversationId, BACKGROUND_CONTEXT);
  return conversation.agent(BACKGROUND_CONTEXT);
}

async function readChildEntries(layer, conversationId, limit = 100) {
  const handle = await layer.harnessHandle();
  const conversation = await handle.harness.conversation(conversationId, BACKGROUND_CONTEXT);
  const page = await conversation.entries({}, limit, undefined, BACKGROUND_CONTEXT);
  return page.items;
}

async function readToolResults(layer, conversationId, limit = 200) {
  const page = await layer.conversationEntries(conversationId, { limit });
  // conversationEntries 是 newest-first：按时间正序返回工具结果。
  return [...page.items]
    .reverse()
    .map(item => (item.model ?? []).find(message => message?.role === "toolResult"))
    .filter(Boolean);
}

// ---------- 角色定义（钉包数据面） ----------

test("bundled agent definitions parse roles, runners, toolsets and thinking levels", () => {
  const definitions = readBundledAgentDefinitions(process.env);
  assert.equal(definitions.size, 13);
  const scout = definitions.get("scout");
  assert.deepEqual(scout.tools, ["read", "grep", "find", "ls", "bash", "write", "contact_supervisor"]);
  assert.equal(scout.thinking, "low");
  assert.equal(scout.systemPromptMode, "replace");
  assert.equal(scout.inheritProjectContext, true);
  assert.equal(scout.externalCli, false);
  const worker = definitions.get("worker");
  assert.equal(worker.thinking, "high");
  assert.equal(worker.acceptanceRole, "writer");
  assert.match(worker.prompt, /^You are `worker`: the implementation subagent\./);
  const oracle = definitions.get("oracle");
  assert.equal(oracle.defaultContext, "fork");
  const cursor = definitions.get("cursor-agent");
  assert.equal(cursor.externalCli, true);
  assert.deepEqual(cursor.runner, {
    type: "external-cli",
    adapter: "cursor-agent",
    command: "cursor-agent",
    promptDelivery: "",
  });
  const claudeWriter = definitions.get("claude-code-writer");
  assert.equal(claudeWriter.runner.adapter, "claude-code-writer");
  assert.equal(claudeWriter.runner.command, "claude");
  assert.equal(claudeWriter.runner.promptDelivery, "stdin");
});

test("role toolset resolution intersects the registry and skips runner-internal tools", () => {
  const definitions = readBundledAgentDefinitions(process.env);
  const snapshot = {
    // RegistrySnapshot.tools() 的真实形状：[{extension, tool}]。
    tools: () => ["read", "bash", "edit", "write", "grep", "find", "ls"]
      .map(name => ({ extension: { name: "test" }, tool: { name } })),
  };
  const reviewer = resolveRoleToolObjects(definitions.get("reviewer"), snapshot);
  assert.deepEqual(reviewer.map(tool => tool.name), ["read", "grep", "find", "ls"]);
  const worker = resolveRoleToolObjects(definitions.get("worker"), snapshot);
  assert.deepEqual(worker.map(tool => tool.name), ["read", "grep", "find", "ls", "bash", "edit", "write"]);
  const evidence = resolveRoleToolObjects(definitions.get("evidence-auditor"), snapshot);
  // 门关 runner 子会话同样只有 pi 原生工具面：web 研究工具两边都不可用。
  assert.deepEqual(evidence.map(tool => tool.name), ["read"]);
});

test("model override parsing accepts provider/id, unique bare ids and thinking suffixes", () => {
  const models = {
    getModels: () => [
      { id: "faux-1", provider: "faux" },
      { id: "faux-2", provider: "faux" },
      { id: "twin", provider: "a" },
      { id: "twin", provider: "b" },
    ],
    getModel: (provider, id) => (
      provider === "faux" && (id === "faux-1" || id === "faux-2") ? { id, provider } : undefined
    ),
  };
  assert.deepEqual(
    parseSubagentModelOverride("faux/faux-2", { models }),
    { provider: "faux", modelId: "faux-2", thinkingLevel: undefined },
  );
  assert.deepEqual(
    parseSubagentModelOverride("faux/faux-2:low", { models }),
    { provider: "faux", modelId: "faux-2", thinkingLevel: "low" },
  );
  assert.deepEqual(
    parseSubagentModelOverride("faux-1", { models }),
    { provider: "faux", modelId: "faux-1", thinkingLevel: undefined },
  );
  assert.throws(() => parseSubagentModelOverride("twin", { models }), /unique provider/);
  assert.throws(() => parseSubagentModelOverride("faux/missing", { models }), /no model/);
  assert.equal(parseSubagentModelOverride("", { models }), undefined);
});

test("external CLI launch surface mirrors the gate-closed adapters", () => {
  const definitions = readBundledAgentDefinitions(process.env);
  const runDirectory = "/tmp/milksu-c1-launch";
  const cursor = resolveExternalCliLaunch(definitions.get("cursor-agent"), runDirectory, "/ws");
  assert.equal(cursor.promptDelivery, "file");
  assert.deepEqual(cursor.args.slice(0, 6), [
    "-p", "--output-format", "stream-json", "--mode", "ask", "--sandbox",
  ]);
  assert.ok(cursor.promptFilePath.endsWith("external-0.cursor-prompt/handoff.txt"));
  assert.ok(cursor.allowlist.includes("CURSOR_API_KEY"));
  const cursorWriter = resolveExternalCliLaunch(definitions.get("cursor-agent-writer"), runDirectory, "/ws");
  assert.ok(!cursorWriter.args.includes("ask"));
  const claude = resolveExternalCliLaunch(definitions.get("claude-code"), runDirectory, "/ws");
  assert.equal(claude.promptDelivery, "stdin");
  assert.deepEqual(claude.args.slice(0, 8), [
    "-p", "--input-format", "text", "--output-format", "stream-json", "--verbose",
    "--permission-mode", "plan",
  ]);
  assert.equal(claude.args[claude.args.indexOf("--tools") + 1], "");
  const claudeWriter = resolveExternalCliLaunch(definitions.get("claude-code-writer"), runDirectory, "/ws");
  assert.equal(claudeWriter.args[claudeWriter.args.indexOf("--permission-mode") + 1], "acceptEdits");
  assert.equal(claudeWriter.args[claudeWriter.args.indexOf("--tools") + 1], "Read,Write,Edit,Glob,Grep");
  const codex = resolveExternalCliLaunch(definitions.get("codex-exec"), runDirectory, "/ws");
  assert.equal(codex.args[codex.args.indexOf("-s") + 1], "read-only");
  assert.ok(codex.finalOutputPath.endsWith("external-0.final-message.txt"));
  const codexWriter = resolveExternalCliLaunch(definitions.get("codex-exec-writer"), runDirectory, "/ws");
  assert.equal(codexWriter.args[codexWriter.args.indexOf("-s") + 1], "workspace-write");
  assert.equal(buildExternalCliPrompt("sys", "task"), "<System instructions>\nsys\n\n<Task>\ntask");
});

// ---------- ① builtin 角色端到端 ----------

test("builtin worker launch runs a task-owned child conversation and returns the answer", async () => {
  await withSubagentFixture(async ({ layer, events, faux, workspace }) => {
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("subagent", { agent: "worker", task: "fix the bug" })], { stopReason: "toolUse" }),
      fauxAssistantMessage([fauxToolCall("write", { path: "context.md", content: "notes" })], { stopReason: "toolUse" }),
      fauxAssistantMessage("child final answer"),
      fauxAssistantMessage("parent final answer"),
    ]);
    await layer.createSession({ ...goCommand, conversationId: "conv-worker" });
    await layer.sendMessage({
      ...goCommand,
      conversationId: "conv-worker",
      prompt: "delegate",
      requestId: "worker-1",
    });
    await waitForEvent(events, "turn_settled", () => true, 30000);

    const tasks = events.filter(event => event.type === "subagent_tasks");
    assert.ok(tasks.length >= 2, "roster start + end events");
    assert.equal(tasks[0].subagentTasks[0].status, "start");
    assert.equal(tasks[0].subagentTasks[0].role, "worker");
    const last = tasks.at(-1).subagentTasks[0];
    assert.equal(last.status, "succeeded");
    assert.equal(last.exitCode, 0);
    assert.deepEqual(last.yield.files, ["context.md"]);

    const children = layer.subagentChildren("conv-worker");
    assert.equal(children.length, 1);
    assert.equal(children[0].role, "worker");
    assert.equal(children[0].status, "succeeded");
    const childId = children[0].conversationId;
    assert.ok(Number.isInteger(childId), "api.details-exposed child conversation id");

    const [toolResult] = await readToolResults(layer, "conv-worker");
    assert.equal(toolResult.isError, false);
    assert.match(JSON.stringify(toolResult.content), /child final answer/);

    const agent = await readChildAgent(layer, childId);
    assert.deepEqual(agent.tools.map(tool => tool.name), [
      "read", "grep", "find", "ls", "bash", "edit", "write",
    ]);
    assert.equal(agent.thinkingLevel, "high");
    assert.equal(agent.cwd, realpathSync(workspace));
    assert.match(agent.instructions, /^You are `worker`: the implementation subagent\./);
    // inheritProjectContext：项目说明拼接在角色提示词之后。
    assert.match(agent.instructions, /milkSU 测试项目/);
    const entries = await readChildEntries(layer, childId);
    assert.equal(entries.filter(entry => entry.kind === "pi.user").length, 1);
    assert.ok(entries.some(entry => entry.kind === "pi.assistant"));
    // 模型继承：child 复制父会话模型（faux/faux-1）。
    assert.equal(agent.model?.provider, "faux");
    assert.equal(agent.model?.modelId, "faux-1");
  }, { projectInstructions: "项目说明：milkSU 测试项目。" });
});

test("read-only reviewer role runs without bash or edit and inherits the parent model", async () => {
  await withSubagentFixture(async ({ layer, events, faux }) => {
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("subagent", { agent: "reviewer", task: "review it" })], { stopReason: "toolUse" }),
      fauxAssistantMessage("review answer"),
      fauxAssistantMessage("parent done"),
    ]);
    await layer.createSession({ ...goCommand, conversationId: "conv-reviewer" });
    await layer.sendMessage({
      ...goCommand,
      conversationId: "conv-reviewer",
      prompt: "delegate",
      requestId: "reviewer-1",
    });
    await waitForEvent(events, "turn_settled", () => true, 30000);
    const children = layer.subagentChildren("conv-reviewer");
    assert.equal(children.length, 1);
    const agent = await readChildAgent(layer, children[0].conversationId);
    assert.deepEqual(agent.tools.map(tool => tool.name), ["read", "grep", "find", "ls"]);
    assert.equal(agent.thinkingLevel, "high");
    assert.equal(agent.model?.modelId, "faux-1");
    assert.match(agent.instructions, /^You are a disciplined review subagent\./);
  });
});

test("oracle defaults to a fork of the parent transcript", async () => {
  await withSubagentFixture(async ({ layer, events, faux }) => {
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("subagent", { agent: "oracle", task: "decide" })], { stopReason: "toolUse" }),
      fauxAssistantMessage("oracle answer"),
      fauxAssistantMessage("parent done"),
    ]);
    await layer.createSession({ ...goCommand, conversationId: "conv-oracle" });
    await layer.sendMessage({
      ...goCommand,
      conversationId: "conv-oracle",
      prompt: "delegate",
      requestId: "oracle-1",
    });
    await waitForEvent(events, "turn_settled", () => true, 30000);
    const children = layer.subagentChildren("conv-oracle");
    assert.equal(children.length, 1);
    // fork 的 child 继承父转录：父会话的 pi.user（"delegate"）先于派活输入出现。
    const childEntries = await readChildEntries(layer, children[0].conversationId);
    const userEntries = childEntries.filter(entry => entry.kind === "pi.user");
    assert.equal(userEntries.length, 2, "inherited parent input + the delegated task");
    const inheritedUser = userEntries.at(-1);
    const inheritedText = JSON.stringify(inheritedUser?.model ?? []);
    assert.match(inheritedText, /delegate/);
  });
});

test("model override with thinking suffix reconfigures the child model", async () => {
  await withSubagentFixture(async ({ layer, events, faux }) => {
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("subagent", {
        agent: "worker",
        task: "do it",
        model: "faux/faux-2:low",
      })], { stopReason: "toolUse" }),
      fauxAssistantMessage("child answer"),
      fauxAssistantMessage("parent done"),
    ]);
    await layer.createSession({ ...goCommand, conversationId: "conv-model" });
    await layer.sendMessage({
      ...goCommand,
      conversationId: "conv-model",
      prompt: "delegate",
      requestId: "model-1",
    });
    await waitForEvent(events, "turn_settled", () => true, 30000);
    const children = layer.subagentChildren("conv-model");
    const agent = await readChildAgent(layer, children[0].conversationId);
    assert.equal(agent.model?.modelId, "faux-2");
    assert.equal(agent.thinkingLevel, "low");
  });
});

test("timeoutMs aborts the child conversation and fails the launch", async () => {
  await withSubagentFixture(async ({ layer, events, faux }) => {
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("subagent", {
        agent: "worker",
        task: "run the tool",
        timeoutMs: 400,
      })], { stopReason: "toolUse" }),
      fauxAssistantMessage([fauxToolCall("bash", { command: "sleep" })], { stopReason: "toolUse" }),
      fauxAssistantMessage("never reached"),
      fauxAssistantMessage("parent done"),
    ]);
    await layer.createSession({ ...goCommand, conversationId: "conv-timeout" });
    await layer.sendMessage({
      ...goCommand,
      conversationId: "conv-timeout",
      prompt: "delegate",
      requestId: "timeout-1",
    });
    await waitForEvent(events, "turn_settled", () => true, 30000);
    const children = layer.subagentChildren("conv-timeout");
    assert.equal(children.length, 1);
    assert.equal(children[0].status, "failed");
    const [toolResult] = await readToolResults(layer, "conv-timeout");
    assert.equal(toolResult.isError, true);
    assert.match(JSON.stringify(toolResult.content), /Subagent timed out\./);
    const tasks = events.filter(event => event.type === "subagent_tasks");
    assert.equal(tasks.at(-1).subagentTasks[0].status, "failed");
  }, workspace => ({
    extraTools: [makeSignalSleepBashTool({ workspace, sleepMs: 15000 })],
  }));
});

// ---------- ⑥ 审判链：校验 + 审批 ----------

test("approval chain blocks unsupported agents and multi-launch inputs without executing", async () => {
  await withSubagentFixture(async ({ layer, events, faux }) => {
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("subagent", { agent: "custom-project-agent", task: "run" })], { stopReason: "toolUse" }),
      fauxAssistantMessage([fauxToolCall("subagent", {
        tasks: [{ agent: "worker", task: "a" }, { agent: "worker", task: "b" }],
      })], { stopReason: "toolUse" }),
      fauxAssistantMessage("parent done"),
    ]);
    await layer.createSession({ ...goCommand, conversationId: "conv-validate" });
    await layer.sendMessage({
      ...goCommand,
      conversationId: "conv-validate",
      prompt: "delegate",
      requestId: "validate-1",
    });
    await waitForEvent(events, "turn_settled", () => true, 30000);
    const results = await readToolResults(layer, "conv-validate");
    assert.equal(results.length, 2);
    assert.match(JSON.stringify(results[0].content), /unsupported bundled subagent/);
    assert.match(JSON.stringify(results[1].content), /one subagent launch per call/);
    assert.equal(results.every(result => result.isError === true), true);
    // 校验 block 在 call 相位：无 subagent_tasks、无 child。
    assert.equal(events.some(event => event.type === "subagent_tasks"), false);
    assert.deepEqual(layer.subagentChildren("conv-validate"), []);
  });
});

test("ask policy prompts per subagent launch and denial blocks the tool without children", async () => {
  const requested = [];
  await withSubagentFixture(async ({ layer, events, faux }) => {
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("subagent", { agent: "scout", task: "scan the code" })], { stopReason: "toolUse" }),
      fauxAssistantMessage("parent done"),
    ]);
    await layer.createSession({ ...goCommand, conversationId: "conv-approval" });
    await layer.sendMessage({
      ...goCommand,
      conversationId: "conv-approval",
      prompt: "delegate",
      requestId: "approval-1",
    });
    await waitForEvent(events, "turn_settled", () => true, 30000);
    assert.equal(requested.length, 1, "one approval card");
    const [result] = await readToolResults(layer, "conv-approval");
    assert.match(JSON.stringify(result.content), /MilkSU user denied subagent delegation/);
    assert.deepEqual(layer.subagentChildren("conv-approval"), []);
  }, {
    approvalBehavior: () => "deny",
    onEvent: record => {
      if (record.type === "approval_requested") requested.push(record);
    },
  });
});

test("approved ask-policy launch proceeds and the approval card carries the roster preview", async () => {
  const requested = [];
  await withSubagentFixture(async ({ layer, events, faux }) => {
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("subagent", { agent: "scout", task: "scan the code" })], { stopReason: "toolUse" }),
      fauxAssistantMessage("scout answer"),
      fauxAssistantMessage("parent done"),
    ]);
    await layer.createSession({ ...goCommand, conversationId: "conv-approval-ok" });
    await layer.sendMessage({
      ...goCommand,
      conversationId: "conv-approval-ok",
      prompt: "delegate",
      requestId: "approval-ok-1",
    });
    await waitForEvent(events, "turn_settled", () => true, 30000);
    assert.equal(requested.length, 1);
    assert.equal(requested[0].toolName, "subagent");
    assert.match(requested[0].content, /single · 1 个后台 Pi 会话/);
    assert.match(requested[0].content, /scout/);
    const children = layer.subagentChildren("conv-approval-ok");
    assert.equal(children.length, 1);
    assert.equal(children[0].status, "succeeded");
  }, {
    onEvent: record => {
      if (record.type === "approval_requested") requested.push(record);
    },
  });
});

// ---------- 控制动作 ----------

test("control actions cover catalog, models, children status, steer and deferred notices", async () => {
  await withSubagentFixture(async ({ layer, events, faux }) => {
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("subagent", { agent: "worker", task: "first task" })], { stopReason: "toolUse" }),
      fauxAssistantMessage("first answer"),
      fauxAssistantMessage([fauxToolCall("subagent", { action: "list" })], { stopReason: "toolUse" }),
      fauxAssistantMessage([fauxToolCall("subagent", { action: "get", agent: "scout" })], { stopReason: "toolUse" }),
      fauxAssistantMessage([fauxToolCall("subagent", { action: "models" })], { stopReason: "toolUse" }),
      fauxAssistantMessage([fauxToolCall("subagent", { action: "children.list" })], { stopReason: "toolUse" }),
      fauxAssistantMessage([fauxToolCall("subagent", { action: "status", agent: "worker" })], { stopReason: "toolUse" }),
      fauxAssistantMessage([fauxToolCall("subagent", { action: "steer", agent: "worker", message: "please also check x" })], { stopReason: "toolUse" }),
      fauxAssistantMessage("steered answer"),
      fauxAssistantMessage([fauxToolCall("subagent", { action: "doctor" })], { stopReason: "toolUse" }),
      fauxAssistantMessage("parent done"),
    ]);
    await layer.createSession({ ...goCommand, conversationId: "conv-control" });
    await layer.sendMessage({
      ...goCommand,
      conversationId: "conv-control",
      prompt: "delegate",
      requestId: "control-1",
    });
    await waitForEvent(events, "turn_settled", () => true, 60000);

    const results = await readToolResults(layer, "conv-control");
    assert.equal(results.length, 8);
    const text = result => JSON.stringify(result.content);
    assert.match(text(results[0]), /first answer/);
    assert.match(text(results[1]), /Subagent catalog/);
    assert.match(text(results[1]), /claude-code \[external-cli\]: Read-only Claude Code CLI analysis/);
    assert.match(text(results[2]), /agent: scout/);
    assert.match(text(results[2]), /tools: read, grep, find, ls, bash, write/);
    assert.match(text(results[3]), /faux\/faux-1/);
    assert.match(text(results[4]), /Harness subagent children/);
    assert.match(text(results[5]), /agent: worker/);
    assert.match(text(results[5]), /status: succeeded/);
    assert.match(text(results[6]), /delivered/);
    assert.match(text(results[6]), /steered answer/);
    assert.match(text(results[7]), /does not carry the pi-subagents/);
    assert.match(text(results[7]), /doctor/);
    // steer 之后同一 child 会话多了一条 pi.user（follow-up/steer 共用一个 child）。
    const children = layer.subagentChildren("conv-control");
    assert.equal(children.length, 1);
    const entries = await readChildEntries(layer, children[0].conversationId);
    assert.equal(entries.filter(entry => entry.kind === "pi.user").length, 2);
  });
});

// ---------- ④ worktree 消费面 ----------

async function worktreeFixture(writers = 2) {
  const root = await mkdtemp(join(tmpdir(), "milksu-c1-worktree-"));
  const workspace = join(root, "workspace");
  const collaborationRoot = join(root, "runtime");
  const conversationId = "conv-worktree";
  const key = createHash("sha256").update(conversationId).digest("hex").slice(0, 32);
  await mkdir(workspace);
  const worktrees = [];
  for (let index = 1; index <= writers; index += 1) {
    const id = `writer-${index}`;
    const path = join(collaborationRoot, key, id);
    await mkdir(path, { recursive: true });
    worktrees.push({ id, path, branch: `codex/agent-${key.slice(0, 12)}-writer-${index}` });
  }
  return { root, workspace, collaborationRoot, conversationId, key, worktrees };
}

test("worktree launches isolate the child cwd and reject unregistered directories", async () => {
  const fixture = await worktreeFixture(2);
  try {
    process.chdir(fixture.workspace);
    const { faux, models } = makeFauxModels();
    const descriptor = normalizeCodingCollaboration({
      schemaVersion: 2,
      conversationId: fixture.conversationId,
      workspace: fixture.workspace,
      baseHead: "a".repeat(40),
      worktrees: fixture.worktrees,
    }, fixture.conversationId, fixture.workspace, fixture.collaborationRoot);
    const { loadSessionPolicy } = await import("./bridge-policy.js");
    const { layer, events } = buildTestLayer({
      agentDir: join(fixture.root, "agent"),
      workspace: fixture.workspace,
      faux,
      models,
      keepProductTools: true,
      policyLoader: async (cwd, command) => {
        const policy = await loadSessionPolicy(cwd, "", {
          executionMode: command.executionMode === "plan" ? "plan" : "go",
          approvalPolicy: command.approvalPolicy ?? "ask",
        });
        policy.uiLocale = command.locale === "en" ? "en" : "zh";
        policy.skillNames = [];
        policy.codingCollaboration = descriptor;
        return { policy, effectiveSessionRole: "", codingSkillPaths: [], mcpConfig: undefined, securityTools: [] };
      },
    });
    try {
      faux.setResponses([
        fauxAssistantMessage([fauxToolCall("subagent", {
          agent: "worker",
          task: "isolate",
          cwd: fixture.worktrees[0].path,
        })], { stopReason: "toolUse" }),
        fauxAssistantMessage("isolated answer"),
        fauxAssistantMessage([fauxToolCall("subagent", {
          agent: "worker",
          task: "escape",
          cwd: tmpdir(),
        })], { stopReason: "toolUse" }),
        fauxAssistantMessage("parent done"),
      ]);
      await layer.createSession({ ...goCommand, conversationId: fixture.conversationId });
      await layer.sendMessage({
        ...goCommand,
        conversationId: fixture.conversationId,
        prompt: "delegate",
        requestId: "worktree-1",
      });
      await waitForEvent(events, "turn_settled", () => true, 60000);

      const children = layer.subagentChildren(fixture.conversationId);
      assert.equal(children.length, 1);
      assert.equal(children[0].cwd, "writer-1");
      const agent = await readChildAgent(layer, children[0].conversationId);
      assert.equal(agent.cwd, realpathSync(fixture.worktrees[0].path));
      const tasks = events.filter(event => event.type === "subagent_tasks");
      assert.equal(tasks.at(-1).subagentTasks[0].yield.worktreeId, "writer-1");

      const results = await readToolResults(layer, fixture.conversationId);
      assert.match(JSON.stringify(results[1].content), /must use the main workspace or a registered writer worktree/);
      assert.equal(results[1].isError, true);
    } finally {
      await layer.disposeAll();
    }
  } finally {
    process.chdir(originalCwd);
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("the collaboration descriptor bounds writer worktrees at two", async () => {
  const fixture = await worktreeFixture(3);
  try {
    assert.throws(() => normalizeCodingCollaboration({
      schemaVersion: 2,
      conversationId: fixture.conversationId,
      workspace: fixture.workspace,
      baseHead: "a".repeat(40),
      worktrees: fixture.worktrees,
    }, fixture.conversationId, fixture.workspace, fixture.collaborationRoot), /one or two writer worktrees/);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

// ---------- ③ 外部 CLI ----------

const fakeCliScripts = {
  // cursor-agent：prompt 走 handoff 文件，stdout 出 stream-json result。
  "cursor-agent": `#!/bin/sh
case "$1" in
  --version) echo "2026.10.01-0a1b2c3"; exit 0 ;;
  --help) cat <<'EOF'
Start the Cursor Agent
  -p, --print
  --output-format <format>  stream-json
  --sandbox <mode>          enabled
  --mode <mode>             ask: read-only
  --workspace <path-or-name>
  --add-dir <path>
  all tools, including write and shell
EOF
    exit 0 ;;
esac
for arg in "$@"; do
  case "$arg" in
    *"handoff.txt"*) handoff="$arg" ;;
  esac
done
printf 'cursor saw: %s\\n' "$(cat "$handoff")" > /dev/stderr
echo '{"type":"result","subtype":"success","is_error":false,"result":"cursor fake answer"}'
`,
  "claude": `#!/bin/sh
case "$1" in
  --version) echo "2.1.259 (Claude Code)"; exit 0 ;;
  --help) cat <<'EOF'
Claude Code - starts an interactive session
  -p, --print
  --input-format <format>  text
  --output-format <format> stream-json
  --verbose
  --permission-mode <mode> plan acceptEdits
  --tools <tools> Read,Write,Edit,Glob,Grep
  --strict-mcp-config
  --mcp-config <file>
  --setting-sources <sources>
  --no-session-persistence
  --disable-slash-commands
  --no-chrome
EOF
    exit 0 ;;
esac
prompt="$(cat)"
printf 'claude saw: %s\\n' "$prompt" > /dev/stderr
case "$prompt" in
  *slow-writer*) sleep 15 ;;
esac
echo '{"type":"result","subtype":"success","is_error":false,"result":"claude fake answer"}'
`,
  "codex": `#!/bin/sh
if [ "$1" = "--version" ]; then echo "codex-cli 0.48.0"; exit 0; fi
if [ "$1" = "exec" ] && [ "$2" = "--help" ]; then cat <<'EOF'
Run Codex non-interactively
  --json
  --output-last-message <path>
  --ephemeral
  --ignore-user-config
  --ignore-rules
  --skip-git-repo-check
  --sandbox <mode>  read-only workspace-write
  --config
EOF
  exit 0
fi
prompt="$(cat)"
final=""
for arg in "$@"; do
  case "$arg" in
    *.final-message.txt) final="$arg" ;;
  esac
done
printf 'codex saw: %s\\n' "$prompt" > /dev/stderr
echo "codex final message content" > "$final"
echo '{"type":"turn.completed"}'
`,
};

async function fakeCliBinDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "milksu-c1-cli-"));
  for (const [name, script] of Object.entries(fakeCliScripts)) {
    const path = join(directory, name);
    await writeFile(path, script, { mode: 0o755 });
    await chmod(path, 0o755);
  }
  return directory;
}

test("external CLI launches go through approval, preflight and guarded spawn", async () => {
  const binDirectory = await fakeCliBinDirectory();
  const requested = [];
  try {
    await withSubagentFixture(async ({ layer, events, faux }) => {
      // full-auto 档：builtin 不弹卡，外部 CLI 恒弹卡（subagentCallRequiresApproval）。
      faux.setResponses([
        fauxAssistantMessage([fauxToolCall("subagent", {
          agent: "claude-code",
          task: "analyze the repo",
        })], { stopReason: "toolUse" }),
        fauxAssistantMessage([fauxToolCall("subagent", {
          agent: "codex-exec",
          task: "analyze again",
        })], { stopReason: "toolUse" }),
        fauxAssistantMessage([fauxToolCall("subagent", {
          agent: "cursor-agent",
          task: "analyze with cursor",
        })], { stopReason: "toolUse" }),
        fauxAssistantMessage("parent done"),
      ]);
      await layer.createSession({
        ...goCommand,
        conversationId: "conv-cli",
        approvalPolicy: "full-auto",
      });
      await layer.sendMessage({
        ...goCommand,
        conversationId: "conv-cli",
        approvalPolicy: "full-auto",
        prompt: "delegate",
        requestId: "cli-1",
      });
      await waitForEvent(events, "turn_settled", () => true, 60000);
      assert.equal(requested.length, 3, "every external CLI launch asks");

      const results = await readToolResults(layer, "conv-cli");
      assert.equal(results.length, 3);
      assert.equal(results.every(result => result.isError === false), true);
      assert.match(JSON.stringify(results[0].content), /claude fake answer/);
      assert.match(JSON.stringify(results[1].content), /codex final message content/);
      assert.match(JSON.stringify(results[2].content), /cursor fake answer/);

      const children = layer.subagentChildren("conv-cli");
      assert.equal(children.length, 3);
      assert.equal(children.every(child => child.status === "succeeded"), true);
      for (const child of children) {
        assert.ok(existsSync(join(child.runDirectory, "status.json")));
        assert.ok(existsSync(join(child.runDirectory, "external-0.stdout.log")));
      }
    }, {
      environment: cliEnvironment(binDirectory),
      onEvent: record => {
        if (record.type === "approval_requested") requested.push(record);
      },
    });
  } finally {
    await rm(binDirectory, { recursive: true, force: true });
  }
});

test("external CLI denial spawns nothing and writer variants keep the writer flags", async () => {
  const binDirectory = await fakeCliBinDirectory();
  const requested = [];
  try {
    await withSubagentFixture(async ({ layer, events, faux }) => {
      faux.setResponses([
        fauxAssistantMessage([fauxToolCall("subagent", { agent: "claude-code", task: "nope" })], { stopReason: "toolUse" }),
        fauxAssistantMessage([fauxToolCall("subagent", { agent: "claude-code-writer", task: "write it" })], { stopReason: "toolUse" }),
        fauxAssistantMessage("parent done"),
      ]);
      await layer.createSession({ ...goCommand, conversationId: "conv-cli-deny" });
      await layer.sendMessage({
        ...goCommand,
        conversationId: "conv-cli-deny",
        prompt: "delegate",
        requestId: "cli-deny-1",
      });
      await waitForEvent(events, "turn_settled", () => true, 60000);
      assert.equal(requested.length, 2);
      const results = await readToolResults(layer, "conv-cli-deny");
      // 第一张卡拒绝 → block（拒绝零 spawn：无 run 目录）；第二张批准 → writer 真跑。
      assert.match(JSON.stringify(results[0].content), /MilkSU user denied subagent delegation/);
      assert.match(JSON.stringify(results[1].content), /claude fake answer/);
      const children = layer.subagentChildren("conv-cli-deny");
      assert.equal(children.length, 1);
      assert.equal(children[0].role, "claude-code-writer");
      assert.equal(children[0].status, "succeeded");
      // 进程收到的 prompt 是 buildExternalCliPrompt 的形状（System instructions + Task）。
      const stderr = await readFile(join(children[0].runDirectory, "external-0.stderr.log"), "utf8");
      assert.match(stderr, /System instructions/);
      assert.match(stderr, /Task/);
    }, {
      environment: cliEnvironment(binDirectory),
      approvalBehavior: () => (requested.length === 1 ? "deny" : "approve"),
      onEvent: record => {
        if (record.type === "approval_requested") requested.push(record);
      },
    });
  } finally {
    await rm(binDirectory, { recursive: true, force: true });
  }
});

// ---------- ⑤ abort 级联 ----------

test("aborting the parent cascades to the harness child conversation", async () => {
  await withSubagentFixture(async ({ layer, events, faux, workspace }) => {
    const execLog = join(workspace, "exec-log.txt");
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("subagent", { agent: "worker", task: "run the tool" })], { stopReason: "toolUse" }),
      fauxAssistantMessage([fauxToolCall("bash", { command: "sleep" })], { stopReason: "toolUse" }),
      fauxAssistantMessage("child final answer"),
      fauxAssistantMessage("parent final answer"),
    ]);
    await layer.createSession({ ...goCommand, conversationId: "conv-abort" });
    await layer.sendMessage({
      ...goCommand,
      conversationId: "conv-abort",
      prompt: "delegate",
      requestId: "abort-1",
    });
    // 等 child 的 sleeping bash 真正开跑，再 abort 父会话。
    for (let attempt = 0; attempt < 400; attempt += 1) {
      const text = await readFile(execLog, "utf8").catch(() => "");
      if (text.split("\n").filter(Boolean).length >= 1) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    await layer.abortSession({ conversationId: "conv-abort" });
    await waitForEvent(events, "turn_settled", () => true, 30000);

    const children = layer.subagentChildren("conv-abort");
    assert.equal(children.length, 1);
    const handle = await layer.harnessHandle();
    const child = await handle.harness.conversation(children[0].conversationId, BACKGROUND_CONTEXT);
    // abort 级联：子会话普通所有权范围收干净（waitForIdle 立即落定、run 收场）。
    await child.waitForIdle(BACKGROUND_CONTEXT);
    const state = await child.viewState(BACKGROUND_CONTEXT);
    try {
      assert.equal(state?.value?.docs?.["pi.live"]?.run, undefined, "child run ended");
    } finally {
      state?.dispose?.();
    }
    const tasks = events.filter(event => event.type === "subagent_tasks");
    assert.ok(tasks.length >= 2);
    const lastStatus = tasks.at(-1).subagentTasks[0]?.status;
    assert.ok(["failed", "aborted"].includes(lastStatus), `unexpected roster status ${lastStatus}`);
  }, workspace => ({
    extraTools: [makeSignalSleepBashTool({
      workspace,
      sleepMs: 20000,
      onExecute: () => {
        void import("node:fs/promises").then(({ appendFile }) => {
          void appendFile(join(workspace, "exec-log.txt"), `${Date.now()}\n`);
        });
      },
    })],
  }));
});

// ---------- ⑤ 外部 CLI destroy 链 ----------

test("destroying the session kills the running external CLI process tree", async () => {
  const binDirectory = await fakeCliBinDirectory();
  try {
    await withSubagentFixture(async ({ layer, events, faux, root }) => {
      faux.setResponses([
        fauxAssistantMessage([fauxToolCall("subagent", {
          agent: "claude-code",
          task: "slow-writer analysis",
        })], { stopReason: "toolUse" }),
        fauxAssistantMessage("parent done"),
      ]);
      await layer.createSession({ ...goCommand, conversationId: "conv-cli-halt" });
      void layer.sendMessage({
        ...goCommand,
        conversationId: "conv-cli-halt",
        prompt: "delegate",
        requestId: "cli-halt-1",
      }).catch(() => undefined);
      // 等 run 目录的 status.json 记下活 pid。
      const runDirectory = join(root, "agent", "harness", "subagents");
      let pid = 0;
      for (let attempt = 0; attempt < 400 && !pid; attempt += 1) {
        const children = layer.subagentChildren("conv-cli-halt");
        const directory = children[0]?.runDirectory;
        if (directory && existsSync(join(directory, "status.json"))) {
          const status = JSON.parse(await readFile(join(directory, "status.json"), "utf8"));
          if (Number.isInteger(status.pid) && status.pid > 1) pid = status.pid;
        }
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      assert.ok(pid > 1, "external CLI pid recorded");
      process.kill(pid, 0);

      await layer.destroySession({ conversationId: "conv-cli-halt" });

      // destroy 链杀掉外部 CLI 进程树（SIGTERM 组 → 宽限 → SIGKILL）。
      let dead = false;
      for (let attempt = 0; attempt < 100 && !dead; attempt += 1) {
        try {
          process.kill(pid, 0);
        } catch {
          dead = true;
        }
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      assert.ok(dead, "external CLI process is gone after destroy");
    }, { environment: cliEnvironment(binDirectory) });
  } finally {
    await rm(binDirectory, { recursive: true, force: true });
  }
});

// ---------- 挂载面 ----------

test("ready.tools includes subagent and the registry installs milksu-subagents", async () => {
  await withSubagentFixture(async ({ layer, events }) => {
    await layer.createSession({ ...goCommand, conversationId: "conv-mount" });
    const ready = (await waitForEvent(events, "ready"))[0];
    assert.ok(ready.tools.includes("subagent"), "subagent mounted in ready.tools");
    assert.ok(ready.extensions.includes(MILKSU_SUBAGENTS_EXTENSION));
  });
});

test("roster start rows keep the gate-closed task shape for single launches", () => {
  const rows = projectSubagentRosterStart(
    { agent: "scout", task: "scan", cwd: "/ws" },
    { toolCallId: "call-1", workspace: "/ws", worktrees: [] },
  );
  assert.deepEqual(rows, [{
    id: "call-1",
    toolCallId: "call-1",
    role: "scout",
    prompt: "scan",
    status: "start",
    cwd: undefined,
  }]);
});
