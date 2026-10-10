// PR-2 批次 B2e 崩溃注入子进程驱动（goal 自主续跑的 durable 恢复场景，C2
// harness-bridge-subagents-async-crash-scenario 的同款父子结构）。
//
// 用法：node harness-bridge-goal-crash-scenario.mjs --phase before|after --run-dir <dir>
//
// before：门开会话 → /goal 立目标 → 首轮文本答复 → run_end 观察门投递续跑#1
//         （requestId=goal-continue:<goalId>:1 幂等）→ 续跑 run 的 faux 工厂发信号
//         continuation-running 后睡 8s（generation 在飞行中）→ 父进程 SIGKILL。
// after：重开同一存储（锁偷取：持有 pid 已死）→ createSession 的 adoption 按
//         Conversation Document 恢复 goal（同一 goal id、active）→ 被打断的 run 由
//         调度器续跑（快节拍 faux 收尾）→ run_end 观察门投递续跑#2 → goal_complete
//         → 停。断言写 result.json：goal id 跨崩溃稳定、每代 continuation 的 pi.user
//         恰一条（requestId 幂等不重复）、终态 complete、turn_settled 恰一次。
//
// 红线：faux provider 零网络零真实密钥；数据全在 --run-dir 临时目录。

import { appendFile, readFile, writeFile } from "node:fs/promises";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
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
  console.error("usage: harness-bridge-goal-crash-scenario.mjs --phase before|after --run-dir <dir>");
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

const conversationId = "conv-goal-crash";
const baseCommand = {
  conversationId,
  provider: "faux",
  model: "faux-1",
  locale: "zh",
  executionMode: "go",
  approvalPolicy: "full-auto",
};

function goalIdFromMessages(messages) {
  const all = messages.map(m => {
    if (typeof m?.content === "string") return m.content;
    if (Array.isArray(m?.content)) return m.content.map(b => String(b?.text ?? "")).join("");
    return "";
  }).join("\n");
  return [...all.matchAll(/<goal_id>\n([^\n]+)\n<\/goal_id>/g)].at(-1)?.[1];
}

function userTextOf(messages) {
  const lastUser = [...messages].reverse().find(m => m?.role === "user");
  return typeof lastUser?.content === "string"
    ? lastUser.content
    : Array.isArray(lastUser?.content)
      ? lastUser.content.filter(b => b?.type === "text").map(b => String(b?.text ?? "")).join("")
      : "";
}

function buildLayer() {
  const { faux, models } = makeFauxModels();
  const testLayer = buildTestLayer({
    agentDir,
    workspace,
    faux,
    models,
    keepProductTools: true,
    heartbeatOptions: { heartbeatMs: 200, settleMs: 20 },
    onEvent: record => {
      if (record.type === "goal_state" && record.goal) {
        void signal("goal-state", { status: record.goal.status, id: record.goal.id, iteration: record.goal.iteration });
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
  // 首轮快答；续跑轮在工厂里发信号后睡 8s——generation 在飞行中被杀。
  const dispatcher = async context => {
    const messages = Array.isArray(context?.messages) ? context.messages : [];
    const text = userTextOf(messages);
    if (text.includes("Continue the active /goal")) {
      await signal("continuation-running", {});
      await new Promise(resolve => setTimeout(resolve, 8000));
      return fauxAssistantMessage("continuation answer (unreachable pre-crash)");
    }
    return fauxAssistantMessage("round one done before the crash");
  };
  faux.setResponses(Array.from({ length: 8 }, () => dispatcher));
  await layer.createSession(baseCommand);
  await layer.sendMessage({ ...baseCommand, prompt: "/goal survive the SIGKILL and resume" });
  // 等续跑 run 真正开跑（工厂信号）后再由父进程 SIGKILL；这里防御性兜底等待。
  await waitFor(async () => {
    const lines = (await readFile(statusPath, "utf8").catch(() => "")).split("\n").filter(Boolean);
    return lines.some(line => {
      try {
        return JSON.parse(line).msg === "continuation-running";
      } catch {
        return false;
      }
    });
  }, 30000, "continuation run in flight");
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
    const beforeSignals = (await readFile(statusPath, "utf8"))
      .split("\n")
      .filter(Boolean)
      .map(line => JSON.parse(line));
    const goalStates = beforeSignals.filter(entry => entry.msg === "goal-state");
    const beforeActive = goalStates.find(entry => entry.data?.status === "active");
    const beforeGoalId = beforeActive?.data?.id;
    check("before phase recorded the active goal", Boolean(beforeGoalId), beforeActive);
    check("before phase reached the continuation run", beforeSignals.some(entry => entry.msg === "continuation-running"));

    // 重开后快节拍：续跑轮文本，第二轮 goal_complete。
    const dispatcher = context => {
      const messages = Array.isArray(context?.messages) ? context.messages : [];
      const text = userTextOf(messages);
      if (text.includes("Continue the active /goal")) {
        const seen = Number(/automatic continuation #(\d+)/.exec(text)?.[1] ?? 0);
        if (seen >= 2) {
          return fauxAssistantMessage([
            fauxToolCall("goal_complete", {
              goal_id: goalIdFromMessages(messages),
              summary: "Resumed after the crash and verified complete.",
            }),
          ], { stopReason: "toolUse" });
        }
        return fauxAssistantMessage("resumed continuation answer");
      }
      return fauxAssistantMessage("unhandled round");
    };
    faux.setResponses(Array.from({ length: 12 }, () => dispatcher));

    await layer.createSession(baseCommand);
    const ready = events.find(event => event.type === "ready");
    check("ready reports resumed conversation", ready?.resumed === true, ready);
    const reopened = (await waitForEvent(events, "goal_state", e => e.goal?.status === "active"))[0];
    check("the goal restores from the conversation document with the same id", reopened.goal.id === beforeGoalId, {
      before: beforeGoalId,
      after: reopened.goal?.id,
    });

    // 续跑到完成：goal_complete → goal 清场 + turn_settled。
    await waitForEvent(events, "goal_state", e => e.goal === null, 30000);
    await waitForEvent(events, "turn_settled", () => true, 30000);
    await new Promise(resolve => setTimeout(resolve, 400));

    const handle = await layer.harnessHandle();
    const conversation = await handle.conversation(conversationId);
    const convId = conversation?.id;
    const conv = await handle.harness.conversation(convId, BACKGROUND_CONTEXT);
    const page = await conv.entries({}, 200, undefined, BACKGROUND_CONTEXT);
    const items = [...page.items].reverse();
    const continuationEntries = items.filter(item => {
      const message = (item.model ?? []).find(m => m?.role === "user");
      const text = typeof message?.content === "string" ? message.content : "";
      return item.kind === "pi.user" && text.includes("Continue the active /goal");
    });
    const iterationCounts = {};
    for (const entry of continuationEntries) {
      const message = (entry.model ?? []).find(m => m?.role === "user");
      const iteration = /automatic continuation #(\d+)/.exec(String(message?.content ?? ""))?.[1] ?? "?";
      iterationCounts[iteration] = (iterationCounts[iteration] ?? 0) + 1;
    }
    check(
      "each continuation iteration appears exactly once (requestId idempotent)",
      Object.values(iterationCounts).every(count => count === 1) && Object.keys(iterationCounts).length >= 2,
      iterationCounts,
    );
    const goalPromptCount = items.filter(item => {
      const message = (item.model ?? []).find(m => m?.role === "user");
      return item.kind === "pi.user" && String(message?.content ?? "").includes("Goal mode is active");
    }).length;
    check("the goal prompt appears exactly once", goalPromptCount === 1, goalPromptCount);

    const settledCount = events.filter(event => event.type === "turn_settled").length;
    check("the goal settles exactly once at completion", settledCount === 1, settledCount);
    const turnStarts = events.filter(event => event.type === "turn_started").length;
    check(
      "a fresh turn_started fired for the post-crash continuation run",
      turnStarts >= 1,
      turnStarts,
    );

    const finalGoalState = events.filter(event => event.type === "goal_state").at(-1);
    check("the final goal_state projects no goal after completion", finalGoalState?.goal === null || finalGoalState?.goal === undefined, finalGoalState?.goal ?? null);

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
