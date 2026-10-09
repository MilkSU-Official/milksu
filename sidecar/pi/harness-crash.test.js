// pi-durable Harness 崩溃注入 / 防双开 / inbox 硬核测试（PR-2 批次 A）。
//
// 结构照 REHEARSAL-pi-harness 的 runner.mjs：父进程（本测试）spawn 子进程（harness-crash-
// scenario.mjs）跑 before 阶段，tail status.ndjson 到触发信号后延迟 150ms 发 SIGKILL（真
// kill -9），再起 after 子进程重开同一存储断言。测试方法论遵 REHEARSAL §8-6：不轮询 <25ms
// 的瞬态（SQLite 后端），断言全部基于已提交状态（提交序 / 转录 kind 计数 / submission 终态）。
//
// 红线：全部数据在 mkdtemp 临时目录；不触碰 ~/Library/Application Support 下的真实
// runtime-data；模型层零网络（pi-ai faux provider）。
//
// Node 版本注记（REHEARSAL R11）：本套件跑在本机开发 Node（`node --version`）；打包侧车
// Node 24.18.0 的 node:sqlite 行为未在本套件覆盖，如实声明，不谎称已验。

import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRegistry, defineExtension, defineTool, ConversationBusy } from "@earendil-works/pi-durable";
import { Type } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { createModels } from "@earendil-works/pi-ai/models";
import { HarnessLockHeldError, openMilkSUHarness } from "./harness-adapter.js";

const scenarioPath = join(dirname(fileURLToPath(import.meta.url)), "harness-crash-scenario.mjs");
const KILL_DELAY_MS = 150;

async function tailSignal(statusPath, trigger, timeoutMs = 30_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      for (const line of (await readFile(statusPath, "utf8")).split("\n")) {
        if (!line) continue;
        try {
          if (JSON.parse(line).msg === trigger) return;
        } catch {
          // 半行写入：下一轮再读。
        }
      }
    } catch {
      // 文件尚未创建。
    }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`timeout waiting for trigger "${trigger}" in ${statusPath}`);
}

function spawnScenario(args) {
  const child = spawn(process.execPath, [scenarioPath, ...args], {
    cwd: dirname(scenarioPath),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", chunk => {
    output += chunk;
  });
  child.stderr.on("data", chunk => {
    output += chunk;
  });
  const exited = new Promise(resolve => {
    child.on("exit", (code, signal) => resolve({ code, signal, output }));
  });
  return { child, exited };
}

async function withCrashRun(run) {
  const root = await mkdtemp(join(tmpdir(), "milksu-harness-crash-"));
  await mkdir(join(root, "workspace"), { recursive: true });
  try {
    return await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function runCrashScenario({ scenario, variant = "unsafe", trigger = "tool-running" }) {
  return withCrashRun(async root => {
    const before = spawnScenario([
      "--phase", "before",
      "--scenario", scenario,
      "--variant", variant,
      "--run-dir", root,
    ]);
    await tailSignal(join(root, "status.ndjson"), trigger);
    await new Promise(resolve => setTimeout(resolve, KILL_DELAY_MS));
    before.child.kill("SIGKILL");
    const beforeExit = await before.exited;
    assert.equal(beforeExit.signal, "SIGKILL", "before phase must die by SIGKILL");

    const after = spawnScenario([
      "--phase", "after",
      "--scenario", scenario,
      "--variant", variant,
      "--run-dir", root,
    ]);
    const afterExit = await after.exited;
    assert.equal(afterExit.code, 0, `after phase failed:\n${afterExit.output}`);
    return JSON.parse(await readFile(join(root, "result.json"), "utf8"));
  });
}

function expectScenarioPass(result) {
  const failures = result.checks.filter(check => !check.ok);
  assert.deepEqual(failures, [], JSON.stringify(result.checks, null, 2));
}

test("crash resume with replay safe: rerun, idempotent side effect, clean rerun output", async () => {
  expectScenarioPass(await runCrashScenario({ scenario: "s1", variant: "safe" }));
});

test("crash resume with replay unsafe: no rerun, interrupted error result, run finishes", async () => {
  expectScenarioPass(await runCrashScenario({ scenario: "s1", variant: "unsafe" }));
});

test("requestId idempotency across three submits and a SIGKILL", async () => {
  expectScenarioPass(await runCrashScenario({ scenario: "s2", variant: "unsafe" }));
});

test("crash while inbox holds queued items: nothing is lost after reopen", async () => {
  expectScenarioPass(await runCrashScenario({ scenario: "s4", variant: "unsafe", trigger: "queued" }));
});

test("flock double-open: a second process cannot open the same harness storage", async () => {
  await withCrashRun(async root => {
    const agentDir = join(root, "agent");
    // D2（存储按工作区分目录）：场景子进程的工作区 = 其 cwd（sidecar/pi），父进程要
    // 开「同一存储」必须显式对准同一 workspace 键——防双开语义按工作区一一对应，
    // 跨工作区并存正是 D2 修的 parked-sidecar 锁冲突面（见 harness-adapter.test.js）。
    const scenarioWorkspace = dirname(scenarioPath);
    // 子进程 before 阶段持有 harness（心跳活跃），父进程此刻对同一存储开第二个。
    const before = spawnScenario([
      "--phase", "before",
      "--scenario", "s1",
      "--variant", "unsafe",
      "--run-dir", root,
    ]);
    try {
      await tailSignal(join(root, "status.ndjson"), "tool-running");
      await assert.rejects(
        () => openMilkSUHarness({
          agentDir,
          workspace: scenarioWorkspace,
          models: makeFauxModels().models,
          registry: createRegistry(),
          heartbeatMs: 200,
          settleMs: 20,
          unrefHeartbeat: true,
        }),
        error => error instanceof HarnessLockHeldError,
        "upstream has no lock (REHEARSAL s8); our host-side lock must reject the second opener",
      );
    } finally {
      before.child.kill("SIGKILL");
      await before.exited;
    }

    // 持有者死后（waitpid 之后的等价面：pid 已死）→ 锁可被接管，重开成功。
    const handle = await openMilkSUHarness({
      agentDir,
      workspace: scenarioWorkspace,
      models: makeFauxModels().models,
      registry: createRegistry(),
      heartbeatMs: 200,
      settleMs: 20,
      unrefHeartbeat: true,
    });
    await handle.close();
  });
});

test("inbox three modes: steer/followUp placement, reject, and abort", async () => {
  await withCrashRun(async root => {
    const agentDir = join(root, "agent");
    const { faux, models } = makeFauxModels();
    const registry = createRegistry();
    registry.install(defineExtension({
      name: "milksu-harness-inbox-test",
      tools: [defineTool({
        name: "slow_touch",
        description: "sleep",
        parameters: Type.Object({ ms: Type.Number() }),
        async execute(args) {
          await new Promise(resolve => setTimeout(resolve, args.ms));
          return {};
        },
      })],
    }));
    const handle = await openMilkSUHarness({
      agentDir,
      models,
      registry,
      heartbeatMs: 200,
      settleMs: 20,
      unrefHeartbeat: true,
    });
    try {
      await handle.configureConversation("conv-inbox", {
        provider: "faux",
        modelId: "faux-1",
        thinkingLevel: "off",
      });
      // 断言基于提交序/终态（REHEARSAL §8-6）：SQLite 后端忙→消费的瞬态 <25ms，不轮询。
      faux.setResponses([
        fauxAssistantMessage([fauxToolCall("slow_touch", { ms: 700 })], { stopReason: "toolUse" }),
        fauxAssistantMessage("after steer"),
        fauxAssistantMessage("after follow up"),
      ]);
      handle.resume();
      const base = await handle.submitInput("conv-inbox", {
        requestId: "base",
        content: "start",
      });

      // 忙时三模式：steer（显式）/ followUp（默认）。
      const steer = await handle.submitInput("conv-inbox", {
        requestId: "steer-1",
        content: "STEER-TEXT",
        whenBusy: "steer",
      });
      const followUp = await handle.submitInput("conv-inbox", {
        requestId: "follow-1",
        content: "FOLLOWUP-TEXT",
      });
      // reject：忙时直接抛 ConversationBusy 且不写任何东西。
      await assert.rejects(
        () => handle.submitInput("conv-inbox", {
          requestId: "reject-1",
          content: "nope",
          whenBusy: "reject",
        }),
        error => error instanceof ConversationBusy,
      );

      // abort：撤回排队的 steer（此时 run 仍挂着 slow_touch）。
      assert.equal(await handle.abortSubmission(steer.id), "aborted");
      const steerSettled = await handle.waitSubmission(steer);
      assert.equal(steerSettled.status, "unanswered");
      assert.equal(steerSettled.reason, "aborted");

      assert.equal((await handle.waitSubmission(base)).status, "done");
      const followSettled = await handle.waitSubmission(followUp);
      assert.equal(followSettled.status, "done");

      const page = await handle.conversationEntries("conv-inbox", { limit: 100 });
      const kinds = page.items.map(entry => entry.kind);
      assert.equal(kinds.filter(kind => kind === "pi.user").length, 2, "base + followUp user entries");
      assert.ok(kinds.filter(kind => kind === "pi.assistant").length >= 2, "steer reply and followUp reply");
      const texts = page.items
        .flatMap(entry => (entry.model ?? []).map(message => messageText(message)));
      assert.ok(texts.some(text => text.includes("FOLLOWUP-TEXT")), "followUp placed as user entry");
      assert.ok(!texts.some(text => text.includes("STEER-TEXT")), "aborted steer never placed");
    } finally {
      await handle.close();
    }
  });
});

function messageText(message) {
  const content = message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map(block => block?.text ?? "").join("");
  return "";
}

function makeFauxModels() {
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  return { faux, models };
}
