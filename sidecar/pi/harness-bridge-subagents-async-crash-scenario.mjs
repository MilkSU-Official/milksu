// PR-2 批次 C2 崩溃注入子进程驱动（异步路面 replay-safe 场景，C1
// harness-bridge-subagents-crash-scenario 的同款父子结构）。
//
// 用法：node harness-bridge-subagents-async-crash-scenario.mjs --phase before|after --run-dir <dir>
//
// before：门开会话（full-auto：spawn 不弹卡）提交 → 模型调 subagent_async（默认
//         async）→ 工具 execute 建 background anchor 任务 + 立即返回收据 →
//         anchor 的 run 相位建任务拥有的 child 会话并提交
//         （requestId=subagent-async:<runId>）→ child 模型调 bash sleep（20s，
//         signal-aware）→ exec-log 落一行 + 注册表见 running 行后写信号
//         child-running（携带 child conversationId / runId / 心跳 beats）。父进程
//         看到信号后 SIGKILL：child 的 bash execute 在飞行中被杀（intent 已落盘、
//         结果未落），anchor 停在 monitor 等待中。
// after：重开同一存储（锁偷取：持有 pid 已死），anchor 任务由调度器续跑（run 相位
//         从 initial checkpoint 重来）→ 所有权索引找回同一 child（不重复建）→
//         requestId 幂等（不重投，child 仍恰一条 pi.user）→ child 的 interrupted
//         bash 以错误结果收场 → child 续答终答 → anchor 摘要 + 完成通知作为
//         follow-up 输入投回父会话（requestId=subagent-async-notify:<runId> 幂等）
//         → 父会话被原生唤醒续答。断言写 result.json：同一 child conversationId、
//         child 恰 1 条 pi.user、exec-log 恰 1 行、注册表/roster succeeded、父会话
//         转录含完成通知（带 child 终答）与父终答。
//
// faux 调度：重开后 child 续答与父会话通知回合的先后不定序——按消息内容分派的
// faux 工厂（FauxResponseFactory 收 TranscriptContext）。
//
// 红线：faux provider 零网络零真实密钥；数据全在 --run-dir 临时目录。

import { appendFile, readFile, writeFile } from "node:fs/promises";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { Type } from "typebox";
import { defineTool } from "@earendil-works/pi-durable";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { buildTestLayer, makeFauxModels, waitForEvent } from "./harness-bridge-test-support.mjs";

function argument(name, fallback = undefined) {
  const prefix = `--${name}`;
  const index = process.argv.indexOf(prefix);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const phase = argument("phase");
const runDir = argument("run-dir");
if (!phase || !runDir) {
  console.error("usage: harness-bridge-subagents-async-crash-scenario.mjs --phase before|after --run-dir <dir>");
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

const conversationId = "conv-crash-async";
const baseCommand = {
  conversationId,
  provider: "faux",
  model: "faux-1",
  locale: "zh",
  executionMode: "go",
  approvalPolicy: "full-auto",
};

/** 测试 bash：sleep 可被 abort signal 提前唤醒；执行即写 exec-log（崩溃取证）。 */
function crashBashTool({ workspace, sleepMs }) {
  return defineTool({
    name: "bash",
    description: "test bash",
    parameters: Type.Object({
      command: Type.String(),
      timeout: Type.Optional(Type.Number()),
    }),
    async execute(args, api, context) {
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
      } else {
        api.output(`ran ${args.command}\n`);
      }
      return {};
    },
  });
}

/** 内容分派 faux 工厂（时序不敏感；roundAfterTool 只看最后一条消息）。 */
function makeDispatcher(rules) {
  return context => {
    const messages = Array.isArray(context?.messages) ? context.messages : [];
    const lastUser = [...messages].reverse().find(m => m?.role === "user");
    const userText = typeof lastUser?.content === "string"
      ? lastUser.content
      : Array.isArray(lastUser?.content)
        ? lastUser.content.filter(b => b?.type === "text").map(b => String(b?.text ?? "")).join("")
        : "";
    const roundAfterTool = messages[messages.length - 1]?.role === "toolResult";
    for (const rule of rules) {
      if (rule.match(userText, roundAfterTool)) return rule.respond(userText, roundAfterTool);
    }
    return fauxAssistantMessage("unhandled dispatch");
  };
}

const dispatcher = makeDispatcher([
  {
    match: text => text.includes("delegate async"),
    respond: (_text, roundAfterTool) => (
      roundAfterTool
        ? fauxAssistantMessage("spawned, waiting for the native wake")
        : fauxAssistantMessage(
          [fauxToolCall("subagent_async", { agent: "worker", task: "write the crash report" })],
          { stopReason: "toolUse" },
        )
    ),
  },
  {
    match: text => text.startsWith("Background task"),
    respond: () => fauxAssistantMessage("crash notification acknowledged"),
  },
  {
    match: text => text.includes("write the crash report"),
    respond: (_text, roundAfterTool) => (
      roundAfterTool
        ? fauxAssistantMessage("child final answer after crash")
        : fauxAssistantMessage([fauxToolCall("bash", { command: "sleep" })], { stopReason: "toolUse" })
    ),
  },
]);

function buildLayer() {
  const { faux, models } = makeFauxModels();
  const testLayer = buildTestLayer({
    agentDir,
    workspace,
    faux,
    models,
    keepProductTools: true,
    extraTools: [crashBashTool({ workspace, sleepMs: 20000 })],
    // 心跳保持默认 ref（产品形态）：anchor 运行期间由心跳定时器保活。
    heartbeatOptions: { heartbeatMs: 200, settleMs: 20 },
    onEvent: record => {
      if (record.type === "subagent_tasks") {
        void signal("subagent-tasks", {
          tasks: (record.subagentTasks ?? []).map(task => ({
            id: task.id, role: task.role, status: task.status,
          })),
        });
      }
    },
  });
  return { layer: testLayer.layer, events: testLayer.events, faux };
}

async function waitFor(predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await predicate()) return;
    if (Date.now() > deadline) throw new Error(`timeout waiting for ${label}`);
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}

async function runBefore() {
  const { layer, faux } = buildLayer();
  faux.setResponses(Array.from({ length: 12 }, () => dispatcher));
  await layer.createSession(baseCommand);
  void layer.sendMessage({
    ...baseCommand,
    prompt: "delegate async",
    requestId: "crash-async-1",
  }).catch(() => undefined);
  // 注册表见 running 行 + child 的 bash 真正开跑（exec-log 落行）之后才发信号。
  await waitFor(() => (
    layer.subagentAsyncChildren(conversationId).some(child => child.conversationId !== undefined)
  ), 30000, "async child registration");
  const child = layer.subagentAsyncChildren(conversationId)[0];
  await waitFor(async () => {
    const text = await readFile(join(workspace, "exec-log.txt"), "utf8").catch(() => "");
    return text.split("\n").filter(Boolean).length >= 1;
  }, 30000, "child bash execution");
  const heartbeat = layer.heartbeatState();
  await signal("child-running", {
    childConversationId: child.conversationId,
    runId: child.runId,
    beats: heartbeat?.beats ?? -1,
  });
  await new Promise(resolve => setTimeout(resolve, 25000));
  // 父进程会在此之前 SIGKILL；走到这里（防御性兜底）就干净收尾。
  await layer.disposeAll();
}

async function runAfter() {
  const { layer, faux, events } = buildLayer();
  const checks = [];
  const check = (name, ok, detail = undefined) => {
    checks.push({ name, ok: Boolean(ok), detail });
    return ok;
  };
  try {
    const beforeSignal = (await readFile(statusPath, "utf8"))
      .split("\n")
      .filter(Boolean)
      .map(line => JSON.parse(line))
      .find(entry => entry.msg === "child-running");
    const beforeChildId = beforeSignal?.data?.childConversationId;
    const beforeRunId = beforeSignal?.data?.runId;
    check("before phase recorded the async child conversation", Number.isInteger(beforeChildId), beforeSignal);
    check("before phase recorded the run id", Boolean(beforeRunId), beforeRunId);

    // 恢复续答：child 的 interrupted bash 收错误结果后续答一次，父会话收通知后
    // 被唤醒续答一次。
    faux.setResponses(Array.from({ length: 12 }, () => dispatcher));
    await layer.createSession(baseCommand);
    const ready = events.find(event => event.type === "ready");
    check("ready reports resumed conversation", ready?.resumed === true, ready);

    // anchor 由调度器续跑：run 相位重来 → 所有权索引找回同一 child → requestId
    // 幂等 → child 收尾 → 完成通知唤醒父会话（新回合）。
    await waitForEvent(events, "turn_settled", () => true, 30000);
    await waitFor(async () => {
      const entries = await layer.conversationEntries(conversationId, { limit: 100 });
      return [...entries.items].some(item => {
        const message = (item.model ?? []).find(candidate => candidate?.role === "user");
        const text = typeof message?.content === "string" ? message.content : "";
        return item.kind === "pi.user" && text.startsWith("Background task completed");
      });
    }, 30000, "completion notification input");

    const children = layer.subagentAsyncChildren(conversationId);
    check("exactly one async child is registered", children.length === 1, children.length);
    const afterChildId = children[0]?.conversationId;
    check("anchor rerun found the same child conversation (ownership index)", afterChildId === beforeChildId, {
      before: beforeChildId,
      after: afterChildId,
    });

    const handle = await layer.harnessHandle();
    const childConversation = await handle.harness.conversation(afterChildId, BACKGROUND_CONTEXT);
    const childPage = await childConversation.entries({}, 100, undefined, BACKGROUND_CONTEXT);
    const childKinds = childPage.items.map(entry => entry.kind);
    check(
      "child has exactly one pi.user entry (requestId idempotent, no re-submit)",
      childKinds.filter(kind => kind === "pi.user").length === 1,
      childKinds,
    );
    const childAssistantText = childPage.items
      .map(entry => (entry.model ?? []).find(message => message?.role === "assistant"))
      .filter(Boolean)
      .map(message => (Array.isArray(message.content)
        ? message.content.map(block => String(block?.text ?? "")).join("")
        : String(message.content ?? "")))
      .join("\n");
    check("child delivered its final answer after the crash", childAssistantText.includes("child final answer after crash"), childAssistantText);

    const execLog = await readFile(join(workspace, "exec-log.txt"), "utf8")
      .then(text => text.split("\n").filter(Boolean))
      .catch(() => []);
    check("child bash executed exactly once (crash attempt never re-ran)", execLog.length === 1, execLog.length);

    // 父会话转录：完成通知（带 child 终答）+ 父终答。
    const parentPage = await layer.conversationEntries(conversationId, { limit: 100 });
    const parentItems = [...parentPage.items].reverse();
    const noticeEntry = parentItems.find(item => {
      const message = (item.model ?? []).find(candidate => candidate?.role === "user");
      return item.kind === "pi.user" && typeof message?.content === "string"
        && message.content.startsWith("Background task completed");
    });
    const noticeText = typeof ((noticeEntry?.model ?? []).find(m => m?.role === "user"))?.content === "string"
      ? ((noticeEntry?.model ?? []).find(m => m?.role === "user")).content
      : "";
    check("parent transcript carries the completion notification", Boolean(noticeEntry), noticeText.slice(0, 120));
    check("notification carries the child answer", noticeText.includes("child final answer after crash"), noticeText);
    const parentAssistantText = parentItems
      .map(item => (item.model ?? []).find(message => message?.role === "assistant"))
      .filter(Boolean)
      .map(message => (Array.isArray(message.content)
        ? message.content.map(block => String(block?.text ?? "")).join("")
        : String(message.content ?? "")))
      .join("\n");
    check("parent answered the notification wake", parentAssistantText.includes("crash notification acknowledged"), parentAssistantText);

    const roster = events.filter(event => event.type === "subagent_tasks");
    const lastRow = roster.at(-1)?.subagentTasks?.[0];
    check("roster closed the async run as succeeded", lastRow?.status === "succeeded", lastRow);

    await writeFile(join(runDir, "result.json"), JSON.stringify({
      phase: "after",
      checks,
      failed: checks.filter(item => !item.ok).length,
    }, null, 2));
  } finally {
    await layer.disposeAll();
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
