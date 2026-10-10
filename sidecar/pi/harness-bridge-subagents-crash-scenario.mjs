// PR-2 批次 C1 崩溃注入子进程驱动（replay-safe 子代理场景，B1 harness-bridge-crash
// 的同款父子结构）。
//
// 用法：node harness-bridge-subagents-crash-scenario.mjs --phase before|after --run-dir <dir>
//
// before：门开会话（full-auto：builtin 单发不弹卡）提交 → 模型派活 worker → 工具
//         execute 建任务拥有的 child 会话并提交（requestId=subagent:<taskId>）→
//         child 模型调 bash sleep（20s，signal-aware）→ exec-log 落一行后写信号
//         child-running（携带 child conversationId 与心跳 beats）。父进程看到信号
//         后 SIGKILL：child 的 bash execute 在飞行中被杀（intent 已落盘、结果未落）。
// after：重开同一存储（锁偷取：持有 pid 已死），faux 续答 [child 终答, parent 终答]；
//         同 requestId 重投 → 调度翻起 → ① subagent 工具 replay-safe 重跑 → 所有权
//         索引找回同一 child（不重复建）→ requestId 幂等（不重投）→ child 的
//         interrupted bash 以错误结果收场 → child 续答完成 → ② 工具结果回传 child
//         终答 → parent 续答 → run 收尾。断言写 result.json：
//         同一 child conversationId、child 恰好 1 条 pi.user、exec-log 恰好 1 行、
//         工具结果非错且含 child 终答、parent 终答在转录里。
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
  console.error("usage: harness-bridge-subagents-crash-scenario.mjs --phase before|after --run-dir <dir>");
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

const conversationId = "conv-crash-sub";
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

function buildLayer() {
  const { faux, models } = makeFauxModels();
  const testLayer = buildTestLayer({
    agentDir,
    workspace,
    faux,
    models,
    keepProductTools: true,
    extraTools: [crashBashTool({ workspace, sleepMs: 20000 })],
    // 心跳保持默认 ref（产品形态）：子代理运行期间由心跳定时器保活。
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
  faux.setResponses([
    fauxAssistantMessage([fauxToolCall("subagent", { agent: "worker", task: "run the tool" })], { stopReason: "toolUse" }),
    fauxAssistantMessage([fauxToolCall("bash", { command: "sleep" })], { stopReason: "toolUse" }),
  ]);
  await layer.createSession(baseCommand);
  void layer.sendMessage({
    ...baseCommand,
    prompt: "delegate to a worker",
    requestId: "crash-sub-1",
  }).catch(() => undefined);
  // child 登记 + child 的 bash 真正开跑（exec-log 落行）之后才发信号。
  await waitFor(() => (
    layer.subagentChildren(conversationId).some(child => child.conversationId !== undefined)
  ), 30000, "child conversation registration");
  const child = layer.subagentChildren(conversationId)[0];
  await waitFor(async () => {
    const text = await readFile(join(workspace, "exec-log.txt"), "utf8").catch(() => "");
    return text.split("\n").filter(Boolean).length >= 1;
  }, 30000, "child bash execution");
  const heartbeat = layer.heartbeatState();
  await signal("child-running", {
    childConversationId: child.conversationId,
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
    check("before phase recorded the child conversation", Number.isInteger(beforeChildId), beforeSignal);

    // 恢复续答：child 的 interrupted bash 收错误结果后续答一次，parent 收工具结果后续答一次。
    faux.setResponses([
      fauxAssistantMessage("child final answer"),
      fauxAssistantMessage("parent final answer"),
    ]);
    await layer.createSession(baseCommand);
    const ready = events.find(event => event.type === "ready");
    check("ready reports resumed conversation", ready?.resumed === true, ready);

    // 同 requestId 重投：reacquire 崩溃前已放置的同一 submission（两层幂等），
    // 调度翻起 pending 的 tool 任务（replay-safe 重跑）与 child 的 generation。
    await layer.sendMessage({
      ...baseCommand,
      prompt: "delegate to a worker",
      requestId: "crash-sub-1",
    });
    await waitForEvent(events, "turn_settled", () => true, 30000);

    const children = layer.subagentChildren(conversationId);
    check("exactly one child conversation is registered", children.length === 1, children.length);
    const afterChildId = children[0]?.conversationId;
    check("rerun found the same child conversation (ownership index)", afterChildId === beforeChildId, {
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
    check("child delivered its final answer", childAssistantText.includes("child final answer"), childAssistantText);

    const execLog = await readFile(join(workspace, "exec-log.txt"), "utf8")
      .then(text => text.split("\n").filter(Boolean))
      .catch(() => []);
    check("child bash executed exactly once (crash attempt never re-ran)", execLog.length === 1, execLog.length);

    const parentPage = await layer.conversationEntries(conversationId, { limit: 100 });
    const parentItems = [...parentPage.items].reverse();
    const toolResults = parentItems
      .map(item => (item.model ?? []).find(message => message?.role === "toolResult"))
      .filter(Boolean);
    check("exactly one subagent tool result", toolResults.length === 1, toolResults.length);
    const toolResultText = JSON.stringify(toolResults[0]?.content ?? "");
    check("tool result is not an error", toolResults[0]?.isError === false, toolResults[0]?.isError);
    check("tool result carries the child answer", toolResultText.includes("child final answer"), toolResultText);
    const parentAssistantText = parentItems
      .map(item => (item.model ?? []).find(message => message?.role === "assistant"))
      .filter(Boolean)
      .map(message => (Array.isArray(message.content)
        ? message.content.map(block => String(block?.text ?? "")).join("")
        : String(message.content ?? "")))
      .join("\n");
    check("parent delivered its final answer", parentAssistantText.includes("parent final answer"), parentAssistantText);

    const roster = events.filter(event => event.type === "subagent_tasks");
    const lastRow = roster.at(-1)?.subagentTasks?.[0];
    check("roster closed the child as succeeded", lastRow?.status === "succeeded", lastRow);

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
