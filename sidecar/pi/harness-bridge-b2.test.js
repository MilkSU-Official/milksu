// PR-2 批次 B2：门开路径端到端（产品工具面挂载，faux provider，零网络，数据全在
// 临时目录）。与 harness-bridge-session.test.js（B1，测试工具面）互补：本文件
// keepProductTools=true，跑**真**的 milksu-coding-tools/lsp/skills 挂载。
//
// 覆盖工单验收点：
//   - ready.tools 工具面对照：go 档挂载面全集、plan 档只读面，暂缓差集逐项列出
//   - 移植工具的执行 + 审批断言（beforeTool 审判链对新挂载工具自动生效的实证）：
//     bash（真执行 + ask 弹卡）、write/read（真落盘真读回）
//   - outputLimits 裁剪：超限结果被引擎截到 50KB/2000 行契约内
//   - LSP 受审链端到端（假 LSP 核心 + 真审判链）：ask 弹卡带 Diff、拒绝不落盘
//   - 技能目录端到端：pi.system 条目带目录不带正文；CTF/研究负向路径
//   - decision_query：门开分支接 models.completeSimple（faux）
//   - reasoning-only recovery：只思考不答复的回合自动补一轮
//
// 进程纪律：coding 工具面按进程 cwd 解析工作区（与真 sidecar 同构），本文件在
// 临时工作区 chdir 后跑，finally 恢复（node --test 每文件独立进程，无跨文件串扰）。

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Type } from "typebox";
import { defineTool } from "@earendil-works/pi-durable";
import { fauxAssistantMessage, fauxText, fauxThinking, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { codingReadOnlyToolNames, codingWorkspaceAutoToolNames } from "./bridge-coding-policy.js";
import { createMilksuLspExtension } from "./harness-bridge-tools.js";
import {
  buildTestLayer,
  kindCounts,
  makeFauxModels,
  waitForEvent,
} from "./harness-bridge-test-support.mjs";

const originalCwd = process.cwd();
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

async function withProductFixture(run, options = {}) {
  const root = await mkdtemp(join(tmpdir(), "milksu-harness-b2-"));
  const agentDir = join(root, "agent");
  const workspace = join(root, "workspace");
  await mkdir(workspace, { recursive: true });
  process.chdir(workspace);
  const { faux, models } = makeFauxModels();
  const { layer, events, emit, maps } = buildTestLayer({
    agentDir,
    workspace,
    faux,
    models,
    keepProductTools: true,
    ...options,
  });
  try {
    return await run({ layer, events, emit, maps, faux, models, workspace, root });
  } finally {
    await layer.disposeAll();
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

// ---------- 工具面对照（ready.tools） ----------

test("ready.tools mounts the full B2 surface in Go mode with the deferred set explicit", async () => {
  await withProductFixture(async ({ layer, events }) => {
    await layer.createSession({ ...goCommand, conversationId: "conv-surface" });
    const ready = (await waitForEvent(events, "ready"))[0];
    // 门关 activeTools（go 档）∩ 已挂载面 = ready.tools；差集即暂缓面。
    // B2c 起 ask/progress/workspace/imagegen/archify/web 两件已挂载；C1 起 subagent
    // 已挂载（harness-bridge-subagents）；剩余暂缓面是 bg/goal（B2d）、
    // computer_use 两件（B2d）。
    const expectedMounted = [
      ...codingWorkspaceAutoToolNames
        .filter(name => ![
          "bg_task", "bg_status",
          "prepare_computer_use_driver", "computer_use",
          "goal_complete", "goal_blocked",
          // 本夹具未配置 ImageGen（imageGenConfigured=false）：门关同样不会把
          // milksu_imagegen 放进 activeTools（bridge-policy.js:1539）。
          "milksu_imagegen",
        ].includes(name)),
      // PR-2 批次 C1：subagent 进门关 go 档 activeTools（bridge-policy.js:1562），
      // 注册表已挂载 milksu-subagents，按 activeTools 次序排在最后。
      "subagent",
    ];
    assert.deepEqual(ready.tools, expectedMounted,
      "gate-open offers every mounted tool in gate-closed order");
    assert.ok(ready.tools.includes("bash") && ready.tools.includes("lsp_fix"));
    assert.ok(ready.tools.includes("milksu_ask") && ready.tools.includes("web_search"));
    assert.deepEqual(
      ready.extensions,
      [
        "milksu-prompt", "milksu-coding-tools", "milksu-lsp", "milksu-skills",
        "milksu-mcp", "milksu-daily-tools", "milksu-security-tools",
        // PR-2 批次 C1：子代理·协作工具面（milksu-core 前安装）。
        "milksu-subagents", "milksu-core",
      ],
      "the registry reports the mounted extensions",
    );
  });
});

test("plan mode keeps the read-only surface mounted", async () => {
  await withProductFixture(async ({ layer, events }) => {
    await layer.createSession({
      ...goCommand,
      executionMode: "plan",
      conversationId: "conv-plan",
    });
    const ready = (await waitForEvent(events, "ready"))[0];
    assert.deepEqual(
      ready.tools,
      [
        "read", "grep", "find", "ls", "milksu_progress", "milksu_ask",
        "milksu_workspace", "lsp_diagnostics", "web_search", "web_fetch",
      ],
      "plan sessions expose the mounted read-only subset (B2c daily tools included)",
    );
    assert.equal(codingReadOnlyToolNames.includes("lsp_fix"), false);
  });
});

// ---------- 移植工具：执行 + 审批（审判链自动生效实证） ----------

test("the ported bash tool executes for real behind the auto-applied approval chain", async () => {
  await withProductFixture(async ({ layer, events, faux, workspace }) => {
    await layer.createSession({ ...goCommand, conversationId: "conv-bash" });
    faux.setResponses([
      fauxAssistantMessage(
        [fauxText("running"), fauxToolCall("bash", { command: "echo b2-real-bash" })],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("bash done"),
    ]);
    await layer.sendMessage({ ...goCommand, conversationId: "conv-bash", prompt: "run it" });
    await waitForEvent(events, "turn_settled");

    // 审判链对新挂载的工具自动生效：ask 策略弹卡，卡面带格式化命令。
    const requested = (await waitForEvent(events, "approval_requested",
      event => event.toolName === "bash"))[0];
    assert.ok(requested.content.includes("echo b2-real-bash"));
    await waitForEvent(events, "approval_resolved", event => event.approved === true);

    // 真执行：真 bash 进程的输出进 tool_call_end。
    const toolEnd = (await waitForEvent(events, "tool_call_end",
      event => event.toolName === "bash"))[0];
    assert.equal(toolEnd.isError, false);
    assert.match(toolEnd.content, /b2-real-bash/);
    assert.ok(toolEnd.content.length < 200, `compact echo output: ${toolEnd.content}`);
    void workspace;
  });
});

test("denying the ported write tool blocks it before any disk change", async () => {
  await withProductFixture(async ({ layer, events, faux, workspace }) => {
    await layer.createSession({ ...goCommand, conversationId: "conv-deny-write" });
    faux.setResponses([
      fauxAssistantMessage(
        [fauxToolCall("write", { path: "denied.txt", content: "nope" })],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("gave up"),
    ]);
    await layer.sendMessage({ ...goCommand, conversationId: "conv-deny-write", prompt: "write" });
    await waitForEvent(events, "turn_settled");
    await waitForEvent(events, "approval_requested", event => event.toolName === "write");
    const toolEnd = (await waitForEvent(events, "tool_call_end",
      event => event.toolName === "write"))[0];
    assert.equal(toolEnd.isError, true);
    assert.match(toolEnd.content, /MilkSU user denied write/);
    await assert.rejects(readFile(join(workspace, "denied.txt"), "utf8"), /ENOENT/);
  }, { approvalBehavior: () => "deny" });
});

test("the ported write and read tools round-trip file contents", async () => {
  await withProductFixture(async ({ layer, events, faux, workspace }) => {
    await layer.createSession({ ...goCommand, conversationId: "conv-write-read" });
    faux.setResponses([
      fauxAssistantMessage(
        [fauxToolCall("write", { path: "b2.txt", content: "B2-ROUNDTRIP" })],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(
        [fauxToolCall("read", { path: "b2.txt" })],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("read back"),
    ]);
    await layer.sendMessage({ ...goCommand, conversationId: "conv-write-read", prompt: "roundtrip" });
    await waitForEvent(events, "turn_settled");
    assert.equal(await readFile(join(workspace, "b2.txt"), "utf8"), "B2-ROUNDTRIP");
    const readEnd = (await waitForEvent(events, "tool_call_end",
      event => event.toolName === "read"))[0];
    assert.match(readEnd.content, /B2-ROUNDTRIP/);
    // write 的执行断言：文件内容即写入值（上面 readFile 已证）；审判链对 write 也弹卡。
    await waitForEvent(events, "approval_requested", event => event.toolName === "write");
  });
});

// ---------- outputLimits（引擎侧硬界） ----------

test("oversized tool results are engine-bounded to the 50KB contract", async () => {
  const oversized = defineTool({
    name: "giant_dump",
    description: "returns a giant blob",
    parameters: Type.Object({}),
    async execute() {
      return {
        content: [{ type: "text", text: "X".repeat(300_000) }],
      };
    },
  });
  await withProductFixture(async ({ layer, events, faux }) => {
    await layer.createSession({ ...goCommand, conversationId: "conv-bound" });
    faux.setResponses([
      fauxAssistantMessage(
        [fauxToolCall("giant_dump", {})],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("bounded"),
    ]);
    await layer.sendMessage({ ...goCommand, conversationId: "conv-bound", prompt: "dump" });
    await waitForEvent(events, "turn_settled");
    const toolEnd = (await waitForEvent(events, "tool_call_end",
      event => event.toolName === "giant_dump"))[0];
    assert.ok(toolEnd.content.length <= 51_457 + 200,
      `result stays inside the 50KB/2000-line contract: ${toolEnd.content.length}`);
    assert.match(toolEnd.content, /Output truncated/, "the engine adds its truncation notice");
  }, { extraTools: [oversized], extraActiveToolNames: ["giant_dump"] });
});

// ---------- LSP 受审链端到端（假核心 + 真审判链 + 真 broker） ----------

function fakeLspCore(calls, { after }) {
  return {
    defaultFileLimit: 50,
    loadRuntime(root) {
      calls.push({ kind: "loadRuntime", root });
      return { adapters: [{ name: "fake-lsp" }], timeoutMs: 500 };
    },
    selectFixRoute(adapters, params) {
      return { root: params.root, route: { adapter: adapters[0], reason: "fake" } };
    },
    selectDiagnosticRoutes(adapters, params) {
      return { root: params.root, routes: [], skipped: [] };
    },
    async runFix(adapter, params) {
      calls.push({ kind: "runFix", params: { ...params } });
      if (params.write) {
        await writeFile(join(params.root, params.path), after, "utf8");
      }
      return {
        content: [{ type: "text", text: "fake fix" }],
        details: { path: params.path, text: params.write ? undefined : after },
      };
    },
    async runDiagnostics() {
      return { content: [{ type: "text", text: "clean" }], details: {} };
    },
  };
}

async function withLspFixture(run, { approval = () => "approve" } = {}) {
  const before = "const answer: string = 42\n";
  const after = "const answer: number = 42\n";
  await withProductFixture(async context => {
    await writeFile(join(context.workspace, "main.ts"), before, "utf8");
    const calls = [];
    // buildTestLayer 的 lspExtension 在 openRuntime（首次 createSession）时消费，
    // 层构造完成后补上真 policy/broker 引用（懒绑定）。
    let policies;
    let broker;
    const lspExtension = createMilksuLspExtension({
      resolveConversation: () => "conv-lsp-e2e",
      getPolicy: id => policies?.get(id),
      approvalBroker: { request: async value => broker.request(value) },
      lsp: fakeLspCore(calls, { after }),
    });
    const built = buildTestLayer({
      agentDir: join(context.root, "agent"),
      workspace: context.workspace,
      faux: context.faux,
      models: context.models,
      keepProductTools: true,
      approvalBehavior: approval,
      lspExtension,
    });
    policies = built.maps.sessionPolicies;
    broker = built.approvalBroker;
    try {
      await run({ ...context, ...built, calls, before, after });
    } finally {
      await built.layer.disposeAll();
    }
  }, { approvalBehavior: approval });
}

test("lsp_fix e2e: ask approval carries the Diff and approval applies the fix", async () => {
  await withLspFixture(async ({ layer, events, faux, workspace, calls, after }) => {
    await layer.createSession({ ...goCommand, conversationId: "conv-lsp-e2e" });
    faux.setResponses([
      fauxAssistantMessage(
        [fauxToolCall("lsp_fix", { path: "main.ts", write: true })],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("fix applied"),
    ]);
    await layer.sendMessage({ ...goCommand, conversationId: "conv-lsp-e2e", prompt: "fix it" });
    await waitForEvent(events, "turn_settled", undefined, 20000);

    // ask 策略：受审链弹卡，卡面是「LSP 修复 · 路径 + 统一 Diff」。
    const requested = (await waitForEvent(events, "approval_requested",
      event => event.toolName === "lsp_fix"))[0];
    assert.match(requested.content, /LSP 修复 · main\.ts/);
    assert.match(requested.content, /-const answer: string = 42/);
    assert.match(requested.content, /\+const answer: number = 42/);

    // 强制 dry-run → 批准 → apply：两次 runFix，第一次 write:false。
    assert.equal(calls.filter(call => call.kind === "runFix").length, 2);
    assert.equal(calls.find(call => call.kind === "runFix").params.write, false);
    assert.equal(await readFile(join(workspace, "main.ts"), "utf8"), after);

    const toolEnd = (await waitForEvent(events, "tool_call_end",
      event => event.toolName === "lsp_fix"))[0];
    assert.equal(toolEnd.isError, false);
    assert.match(toolEnd.content, /LSP applied the reviewed source fix/);
  });
});

test("lsp_fix e2e: denial leaves the file untouched with an error result", async () => {
  await withLspFixture(async ({ layer, events, faux, workspace, calls, before }) => {
    await layer.createSession({ ...goCommand, conversationId: "conv-lsp-e2e" });
    faux.setResponses([
      fauxAssistantMessage(
        [fauxToolCall("lsp_fix", { path: "main.ts", write: true })],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("gave up"),
    ]);
    await layer.sendMessage({ ...goCommand, conversationId: "conv-lsp-e2e", prompt: "fix it" });
    await waitForEvent(events, "turn_settled", undefined, 20000);
    const toolEnd = (await waitForEvent(events, "tool_call_end",
      event => event.toolName === "lsp_fix"))[0];
    assert.equal(toolEnd.isError, true);
    assert.match(toolEnd.content, /denied lsp_fix/);
    assert.equal(await readFile(join(workspace, "main.ts"), "utf8"), before,
      "the reviewed file is unchanged after denial");
    assert.equal(calls.filter(call => call.kind === "runFix").length, 1,
      "only the dry-run pass executed");
  }, { approval: () => "deny" });
});

// ---------- 技能目录端到端 ----------

test("the skills catalog lands as a pi.system section without bodies", async () => {
  await withProductFixture(async ({ layer, events, faux }) => {
    await layer.createSession({ ...goCommand, conversationId: "conv-skills-e2e" });
    faux.setResponses([fauxAssistantMessage("ack")]);
    await layer.sendMessage({ ...goCommand, conversationId: "conv-skills-e2e", prompt: "hi" });
    await waitForEvent(events, "turn_settled");
    const page = await layer.conversationEntries("conv-skills-e2e", { limit: 100 });
    const sections = [];
    for (const entry of page.items) {
      const message = entry.model?.[0];
      if (message?.role === "system" && message.sections?.skills) {
        sections.push(message.sections.skills);
      }
    }
    assert.ok(sections.length > 0, "a pi.system entry carries the skills section");
    const catalog = sections.at(-1);
    assert.ok(catalog.includes("<available_skills>"));
    assert.ok(catalog.includes("<name>frontend-visual-qa</name>"),
      "first-party skills are listed");
    assert.ok(!catalog.includes("<name>release-milksu</name>"),
      "disable-model-invocation skills stay out");
    assert.ok(!/SKILL BODY|---\nname:/.test(catalog), "no skill bodies leak into the prompt");
  }, { skillPaths: [
    join(repositoryRoot, "skills", "frontend-visual-qa"),
    join(repositoryRoot, "skills", "release-milksu"),
  ] });
});

test("sessions without skill paths render no skills section (negative path)", async () => {
  await withProductFixture(async ({ layer, events, faux }) => {
    await layer.createSession({ ...goCommand, conversationId: "conv-noskills" });
    faux.setResponses([fauxAssistantMessage("ack")]);
    await layer.sendMessage({ ...goCommand, conversationId: "conv-noskills", prompt: "hi" });
    await waitForEvent(events, "turn_settled");
    const page = await layer.conversationEntries("conv-noskills", { limit: 100 });
    for (const entry of page.items) {
      const message = entry.model?.[0];
      assert.ok(!message?.sections?.skills, "no skills section without paths");
    }
  });
});

// ---------- decision_query（门开分支） ----------

test("decision_query answers through the harness models collection", async () => {
  await withProductFixture(async ({ layer, events, faux }) => {
    await layer.createSession({ ...goCommand, conversationId: "conv-decision" });
    faux.setResponses([fauxAssistantMessage("DECISION-ANSWER")]);
    await layer.decisionQuery({
      conversationId: "conv-decision",
      id: "dq-1",
      systemPrompt: "you decide",
      prompt: "pick one",
    });
    const answer = (await waitForEvent(events, "decision_answer",
      event => event.id === "dq-1"))[0];
    assert.equal(answer.text, "DECISION-ANSWER");
    assert.equal(answer.error, undefined);
  });
});

test("decision_query reports an explicit error before the model is wired", async () => {
  await withProductFixture(async ({ layer, events }) => {
    await layer.decisionQuery({
      conversationId: "conv-no-model",
      id: "dq-2",
      prompt: "pick one",
    });
    const answer = (await waitForEvent(events, "decision_answer",
      event => event.id === "dq-2"))[0];
    assert.match(answer.error, /model completer is not wired|not ready/);
  });
});

// ---------- reasoning-only recovery ----------

test("a reasoning-only turn recovers with a no-tools follow-up run", async () => {
  await withProductFixture(async ({ layer, events, faux, maps }) => {
    await layer.createSession({ ...goCommand, conversationId: "conv-recovery" });
    faux.setResponses([
      fauxAssistantMessage([fauxThinking("deep thought, no answer")], { stopReason: "stop" }),
      fauxAssistantMessage("RECOVERED-FINAL-ANSWER"),
    ]);
    await layer.sendMessage({ ...goCommand, conversationId: "conv-recovery", prompt: "think only" });

    // 恢复轮的最终答复可见。
    const done = (await waitForEvent(events, "message_done",
      event => event.content === "RECOVERED-FINAL-ANSWER", 20000))[0];
    assert.ok(done, "the recovery turn produces a visible answer");
    await waitForEvent(events, "turn_settled", undefined, 20000);

    // 恢复输入落成 pi.user 条目（s7 口径：custom_message→pi.user 等价）。
    const page = await layer.conversationEntries("conv-recovery", { limit: 100 });
    const counts = kindCounts(page.items);
    assert.equal(counts["pi.user"], 2, JSON.stringify(counts));
    const userText = message => {
      const content = message?.content;
      if (typeof content === "string") return content;
      if (Array.isArray(content)) {
        return content.map(block => String(block?.text ?? "")).join("");
      }
      return "";
    };
    const recoveryUser = page.items
      .filter(item => item.kind === "pi.user")
      .map(item => item.model?.[0])
      .find(message => userText(message).includes("只输出一段简短的最终答复"));
    assert.ok(recoveryUser, "the recovery prompt is the second user entry");

    // 恢复回合无工具（契约压着），结束后工具面还原。
    assert.equal(maps.sessionTurnContracts.has("conv-recovery"), false,
      "the no-tools contract is cleared after recovery");
    const session = maps.sessions.get("conv-recovery");
    assert.ok(session.getActiveToolNames().includes("read"),
      "the tool surface is restored after the recovery turn");
    // 只有一轮用户输入 + 一轮恢复输入；无工具结果（恢复回合无工具可调）。
    assert.equal(counts["pi.tool-result"] ?? 0, 0);
  });
});
