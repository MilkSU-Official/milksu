// PR-2 批次 B1 崩溃注入子进程驱动（审批挂起场景，REHEARSAL s5 形状）。
//
// 用法：node harness-bridge-crash-scenario.mjs --phase before|after --run-dir <dir>
//
// before：经 harness-bridge-session 层（faux 模型 + 测试 bash 工具 + 真审批链）开会话
//         并提交；工具调用触发 ask 审批，假桌面**永不回包**（approvalBehavior=manual）
//         → beforeTool 挂起。写 approval-pending 信号，随后周期性写 heartbeat 信号
//         （beats 计数），证明：①进程在审批挂起期间不死（心跳 ref 保活，Q3-2）；
//         ②心跳真的在跳。父进程看到两组递增 beats 后 SIGKILL。
// after：重开同一存储（锁偷取：持有 pid 已死），假桌面改为自动批准；用同 requestId
//         重投（reacquire 同一 submission）→ 调度翻起 → call 阶段重来 → 审批重弹
//         （自动批准）→ 工具执行 → run 收尾。断言写 result.json：审批重弹、exec-log
//         恰好 1 行（崩溃前从未执行）、恰好 1 条 pi.tool-result、submission done。
//
// 红线：数据全在 --run-dir 临时目录；faux provider，零网络零真实密钥。

import { appendFile, readFile, writeFile } from "node:fs/promises";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import {
  buildTestLayer,
  kindCounts,
  makeFauxModels,
  makeTestBashTool,
} from "./harness-bridge-test-support.mjs";

function argument(name, fallback = undefined) {
  const prefix = `--${name}`;
  const index = process.argv.indexOf(prefix);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const phase = argument("phase");
const runDir = argument("run-dir");
if (!phase || !runDir) {
  console.error("usage: harness-bridge-crash-scenario.mjs --phase before|after --run-dir <dir>");
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

const conversationId = "conv-crash";
const baseCommand = {
  conversationId,
  provider: "faux",
  model: "faux-1",
  locale: "zh",
  executionMode: "go",
  approvalPolicy: "ask",
};

function buildLayer({ approveAutomatically }) {
  const { faux, models } = makeFauxModels();
  const tool = makeTestBashTool({
    workspace,
    onExecute: () => {
      void appendFile(join(workspace, "exec-log.txt"), `${Date.now()}\n`);
    },
  });
  return buildTestLayer({
    agentDir,
    workspace,
    faux,
    models,
    approvalBehavior: () => (approveAutomatically ? "approve" : "manual"),
    extraTools: [tool],
    // 心跳保持默认 ref（产品形态）：审批挂起时由心跳定时器保活进程。
    heartbeatOptions: { heartbeatMs: 200, settleMs: 20 },
    onEvent: record => {
      if (record.type === "approval_requested") {
        void signal("approval-requested", { requestId: record.requestId });
      }
    },
  });
}

async function runBefore() {
  const { layer, faux } = buildLayer({ approveAutomatically: false });
  faux.setResponses([
    fauxAssistantMessage([fauxToolCall("bash", { command: "echo hi" })], { stopReason: "toolUse" }),
    fauxAssistantMessage("final answer"),
  ]);
  await layer.createSession(baseCommand);
  void layer.sendMessage({
    ...baseCommand,
    prompt: "run the tool",
    requestId: "crash-1",
  }).catch(() => undefined);
  // beforeTool 挂起（审批无人回包）后由 onEvent 信号 approval-requested；这里等它，
  // 然后周期记录心跳：进程必须在无任何事件循环业务句柄的情况下持续存活。
  await new Promise(resolve => setTimeout(resolve, 1200));
  const first = layer.heartbeatState();
  await signal("approval-pending", { beats: first?.beats ?? -1 });
  await new Promise(resolve => setTimeout(resolve, 900));
  const second = layer.heartbeatState();
  await signal("approval-pending-2", { beats: second?.beats ?? -1 });
  await new Promise(resolve => setTimeout(resolve, 25_000));
  // 父进程会在此之前 SIGKILL；走到这里（防御性兜底）就干净收尾。注意不能 await
  // submitted：审批永不回包，那个 promise 不会落定。
  await layer.disposeAll();
}

async function runAfter() {
  const { layer, faux, events } = buildLayer({ approveAutomatically: true });
  const checks = [];
  const check = (name, ok, detail = undefined) => {
    checks.push({ name, ok: Boolean(ok), detail });
    return ok;
  };
  try {
    // 恢复不需要重放工具调用：意图未落盘（call 相位），generation 续答要终答。
    faux.setResponses([fauxAssistantMessage("final answer after crash")]);
    await layer.createSession(baseCommand);
    const ready = events.find(event => event.type === "ready");
    check("ready reports resumed conversation", ready?.resumed === true, ready);

    const approvalCountBefore = events.filter(
      event => event.type === "approval_requested",
    ).length;

    // 同 requestId 重投：reacquire 崩溃前已放置的同一 submission（两层幂等）。
    await layer.sendMessage({
      ...baseCommand,
      prompt: "run the tool",
      requestId: "crash-1",
    });
    await new Promise(resolve => setTimeout(resolve, 6000));

    const approvals = events.filter(event => event.type === "approval_requested");
    check(
      "approval re-fires after crash and reopen (Q3)",
      approvals.length > approvalCountBefore || approvals.length >= 1,
      { count: approvals.length, before: approvalCountBefore },
    );
    check(
      "approval was answered (not pending forever)",
      events.some(event => event.type === "approval_resolved" && event.approved === true),
    );

    const settled = events.filter(event => event.type === "turn_settled");
    check("turn settled after resume", settled.length >= 1, settled.length);

    const execLog = await readFile(join(workspace, "exec-log.txt"), "utf8")
      .then(text => text.split("\n").filter(Boolean))
      .catch(() => []);
    check("tool executed exactly once (crash attempt never ran)", execLog.length === 1, execLog.length);

    const page = await layer.conversationEntries(conversationId, { limit: 100 });
    const counts = kindCounts(page.items);
    check("exactly one user entry", counts["pi.user"] === 1, counts);
    check("exactly one tool-result", counts["pi.tool-result"] === 1, counts);
    check("assistant entries present", (counts["pi.assistant"] ?? 0) >= 2, counts);
    const toolResult = page.items
      .find(item => item.kind === "pi.tool-result")
      ?.model?.find(message => message?.role === "toolResult");
    check("tool result is not an error", toolResult?.isError === false, toolResult?.isError);

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
