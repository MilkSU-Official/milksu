// 崩溃注入子进程驱动（PR-2 批次 A 测试专用，非产品代码）。
//
// 用法：node harness-crash-scenario.mjs --phase before|after --scenario <s1|s2> --variant safe|unsafe
//        --run-dir <dir>
//
// before：经 harness-adapter 打开 Harness（faux 模型 + slow_touch 工具），提交输入，工具进入
//         执行时写 status.ndjson 信号（父进程 tail 到信号后延迟 150ms 发 SIGKILL）。
// after：重开同一存储（锁偷取路径：持有者 pid 已死 → 立即接管），补 faux 终答，resume，断言
//        后写 result.json。断言形状照 REHEARSAL s1/s2：exec-log 行数、副作用幂等、interrupted
//        结果、转录 kind 计数、submission 终态。
//
// 红线：数据全在 --run-dir 下的临时目录；模型层是 pi-ai faux provider，零网络零密钥。

import { appendFile, readFile, writeFile } from "node:fs/promises";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { createRegistry, defineExtension, defineTool } from "@earendil-works/pi-durable";
import { Type } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { createModels } from "@earendil-works/pi-ai/models";
import { openMilkSUHarness } from "./harness-adapter.js";

function argument(name, fallback = undefined) {
  const prefix = `--${name}`;
  const index = process.argv.indexOf(prefix);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const phase = argument("phase");
const scenario = argument("scenario");
const variant = argument("variant", "unsafe");
const runDir = argument("run-dir");
if (!phase || !scenario || !runDir) {
  console.error("usage: harness-crash-scenario.mjs --phase before|after --scenario s1|s2 --variant safe|unsafe --run-dir <dir>");
  process.exit(2);
}
const agentDir = join(runDir, "agent");
const workspace = join(runDir, "workspace");
mkdirSync(workspace, { recursive: true });

const statusPath = join(runDir, "status.ndjson");
const t0 = Date.now();
async function signal(message, data) {
  await appendFile(statusPath, `${JSON.stringify({ t: Date.now() - t0, msg: message, ...(data ? { data } : {}) })}\n`);
}

const TOOL_SLEEP_MS = 1400;

function slowTouchTool() {
  return defineTool({
    name: "slow_touch",
    description: "append exec log, write side effect, sleep",
    parameters: Type.Object({ path: Type.String(), ms: Type.Number() }),
    ...(variant === "safe" ? { replay: "safe" } : {}),
    async execute(args, api) {
      await signal("tool-running", { pid: process.pid });
      api.output(`touching ${args.path}\n`);
      await appendFile(join(workspace, "exec-log.txt"), `${Date.now()}\n`);
      await writeFile(join(workspace, args.path), `${Date.now()}\n`);
      await new Promise(resolve => setTimeout(resolve, args.ms));
      api.output("done\n");
      return {};
    },
  });
}

function sleepingTool({ ms }) {
  return defineTool({
    name: "slow_touch",
    description: "sleep",
    parameters: Type.Object({ ms: Type.Number() }),
    async execute(args) {
      await signal("tool-running", { pid: process.pid });
      await new Promise(resolve => setTimeout(resolve, args.ms ?? ms));
      return {};
    },
  });
}

function makeRegistry() {
  const registry = createRegistry();
  registry.install(defineExtension({
    name: "milksu-harness-crash-test",
    tools: [scenario === "s4" ? sleepingTool({ ms: 20_000 }) : slowTouchTool()],
  }));
  return registry;
}

function makeModels() {
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  return { faux, models };
}

function kindCounts(items) {
  const counts = {};
  for (const item of items) counts[item.kind] = (counts[item.kind] ?? 0) + 1;
  return counts;
}

async function readLines(file) {
  try {
    return (await readFile(file, "utf8")).split("\n").filter(line => line.length > 0);
  } catch {
    return [];
  }
}

function messageText(message) {
  const content = message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map(block => block?.text ?? "").join("");
  return "";
}

async function openHarness(models) {
  return openMilkSUHarness({
    agentDir,
    models,
    registry: makeRegistry(),
    heartbeatMs: 200,
    settleMs: 20,
    unrefHeartbeat: true,
  });
}

const checks = [];
function check(name, ok, detail = undefined) {
  checks.push({ name, ok: Boolean(ok), detail });
  return ok;
}

async function runBefore() {
  const { faux, models } = makeModels();
  const handle = await openHarness(models);
  const alias = `conv-${scenario}`;
  await handle.configureConversation(alias, {
    provider: "faux",
    modelId: "faux-1",
    thinkingLevel: "off",
  });
  if (scenario === "s4") {
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("slow_touch", { ms: 20_000 })], { stopReason: "toolUse" }),
      fauxAssistantMessage("final answer"),
    ]);
    handle.resume();
    await handle.submitInput(alias, { requestId: "base", content: "start" });
    await handle.submitInput(alias, { requestId: "follow", content: "FOLLOWUP-TEXT" });
    await handle.submitInput(alias, { requestId: "steer", content: "STEER-TEXT", whenBusy: "steer" });
    await signal("queued");
    await new Promise(resolve => setTimeout(resolve, 30_000));
    await handle.close();
    return;
  }
  faux.setResponses([
    fauxAssistantMessage([fauxToolCall("slow_touch", { path: "side-effect.txt", ms: TOOL_SLEEP_MS })], {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("final answer"),
  ]);
  handle.resume();
  const first = await handle.submitInput(alias, {
    requestId: scenario === "s1" ? "s1" : "r1",
    content: "run the tool",
  });
  await writeFile(join(runDir, "submission-id.txt"), String(first.id));
  if (scenario === "s2") {
    const second = await handle.submitInput(alias, { requestId: "r1", content: "run the tool" });
    await writeFile(join(runDir, "second-id.txt"), String(second.id));
  }
  await signal("submitted");
  // 工具 sleep 期间进程被 SIGKILL；挂住等待即可。
  await new Promise(resolve => setTimeout(resolve, 30_000));
  await handle.close();
}

async function runAfter() {
  const { faux, models } = makeModels();
  const handle = await openHarness(models);
  try {
    // 恢复不需要重放工具调用：意图已落盘（execute 相位）。generation 的下一条请求要终答。
    faux.setResponses([fauxAssistantMessage("final answer")]);
    const alias = `conv-${scenario}`;
    const saved = scenario === "s4"
      ? 0
      : Number((await readFile(join(runDir, "submission-id.txt"), "utf8")).trim());

    if (scenario === "s1") {
      const reacquired = await handle.submitInput(alias, { requestId: "s1", content: "run the tool" });
      check("requestId reacquires the same submission", Number(reacquired.id) === saved, { saved, got: reacquired.id });
      handle.resume();
      const settled = await handle.waitSubmission(reacquired);
      check("submission settles done", settled.status === "done", settled);

      const execLog = await readLines(join(workspace, "exec-log.txt"));
      const sideEffect = await readLines(join(workspace, "side-effect.txt"));
      if (variant === "safe") {
        check("safe: tool really reran (exec-log = 2)", execLog.length === 2, execLog.length);
        check("safe: side effect idempotent (exactly 1 line)", sideEffect.length === 1, sideEffect.length);
      } else {
        check("unsafe: tool never reran (exec-log = 1)", execLog.length === 1, execLog.length);
        check("unsafe: side effect exactly 1 line", sideEffect.length === 1, sideEffect.length);
      }

      const page = await handle.conversationEntries(alias, { limit: 100 });
      const kinds = kindCounts(page.items);
      check("one user entry", kinds["pi.user"] === 1, kinds);
      check("two assistant entries", kinds["pi.assistant"] === 2, kinds);
      check("exactly one tool-result", kinds["pi.tool-result"] === 1, kinds);

      const toolResult = page.items
        .find(item => item.kind === "pi.tool-result")
        ?.model?.find(message => message?.role === "toolResult");
      if (variant === "safe") {
        check("safe: tool result is not an error", toolResult?.isError === false, toolResult?.isError);
        const text = (toolResult?.content ?? []).map(block => block.text ?? "").join("");
        check(
          "safe: rerun cleared interrupted partial output (no duplicate touching)",
          text === "touching side-effect.txt\ndone\n",
          JSON.stringify(text),
        );
      } else {
        check("unsafe: tool result is an interrupted error", toolResult?.isError === true, toolResult?.isError);
        // interrupted 诊断以 <harness>[error]…</harness> 渲染进模型可见内容（DECISIONS Q3
        // 的实测细节，REHEARSAL s1 同形）；结构化 diagnostics 字段在此路径不存在。
        const text = (toolResult?.content ?? []).map(block => block.text ?? "").join("");
        const diagnostics = toolResult?.details?.diagnostics ?? toolResult?.diagnostics ?? [];
        check(
          "unsafe: interrupted diagnostic (structured code or rendered harness error)",
          (Array.isArray(diagnostics) && diagnostics.some(d => d?.code === "interrupted"))
            || (text.includes("<harness>") && text.includes("[error]") && text.includes("was interrupted and may have partially run")),
          JSON.stringify({ diagnostics, text }),
        );
        check("unsafe: partial output visible in the result", text.includes("touching side-effect.txt"), JSON.stringify(text));
      }
      const inspection = await handle.inspect();
      check("no live tasks after settle", inspection.tasks.length === 0, inspection.tasks.length);
    } else if (scenario === "s2") {
      const secondSaved = Number((await readFile(join(runDir, "second-id.txt"), "utf8")).trim());
      check("second in-process submit already matched", secondSaved === saved, { saved, secondSaved });
      const third = await handle.submitInput(alias, { requestId: "r1", content: "run the tool" });
      check("third submit after reopen returns the same submission id", Number(third.id) === saved, { saved, third: third.id });
      handle.resume();
      const settled = await handle.waitSubmission(third);
      check("reacquired submission settles done", settled.status === "done", settled);
      const page = await handle.conversationEntries(alias, { limit: 100 });
      const kinds = kindCounts(page.items);
      check("exactly one pi.user entry across three submits", kinds["pi.user"] === 1, kinds);
      check("assistant entries present", (kinds["pi.assistant"] ?? 0) >= 2, kinds);
      check("exactly one tool-result", kinds["pi.tool-result"] === 1, kinds);
    } else if (scenario === "s4") {
      // 重开 resume：排队项不丢（REHEARSAL s4），全部随边界放置并落定。
      // 恢复流程要三次模型应答：interrupted 后 generation 续答 → steer 答复 → followUp 答复。
      faux.setResponses([
        fauxAssistantMessage("resumed answer"),
        fauxAssistantMessage("steer answer"),
        fauxAssistantMessage("follow up answer"),
      ]);
      handle.resume();
      const settled = {};
      for (const requestId of ["base", "follow", "steer"]) {
        const submission = await handle.submitInput(alias, { requestId, content: "x" });
        settled[requestId] = await handle.waitSubmission(submission);
      }
      check("base settles done", settled.base.status === "done", settled.base);
      check("followUp settles done", settled.follow.status === "done", settled.follow);
      check("steer settles done", settled.steer.status === "done", settled.steer);
      const page = await handle.conversationEntries(alias, { limit: 100 });
      const texts = page.items
        .flatMap(item => (item.model ?? []).map(message => messageText(message)));
      check("queued followUp text survives the crash", texts.some(text => text.includes("FOLLOWUP-TEXT")));
      check("queued steer text survives the crash", texts.some(text => text.includes("STEER-TEXT")));
      check("three user entries (base + followUp + steer)", kindCounts(page.items)["pi.user"] === 3, kindCounts(page.items));
    }

    await writeFile(join(runDir, "result.json"), JSON.stringify({
      scenario,
      variant,
      checks,
      failed: checks.filter(item => !item.ok).length,
    }, null, 2));
  } finally {
    await handle.close();
  }
}

if (phase === "before") {
  await runBefore();
} else if (phase === "after") {
  await runAfter();
} else {
  console.error(`unknown phase ${phase}`);
  process.exit(2);
}
process.exit(0);
