// PR-2 批次 B2e：goal 自主续跑状态机（harness-bridge-goal.js）的门开端到端测试。
//
// 工单场景逐项（faux provider、零网络、数据全在临时目录、进程内 chdir 工作区）：
//   ① 立 goal → 干一轮 → 自动续跑下一轮（无人工输入）→ goal_complete → 停；
//   ② goal_blocked → 报告卡点并停；
//   ③ 无进展上限（faux 连续几轮无有效产出 → 自动喊停）；
//   ④ 预算收尾（预算小值 → budget_limited + 收尾投递；wrap-up 期实质工具被块，
//      goal_complete 放行）；
//   ⑤ stale goal_id 守卫（旧 goal_id 不追，goal 继续跑）；
//   ⑥ ready.goal_state 投影逐字段（与门关 projectGoalStateData 同形）+ destroy/
//      重开的 Document 恢复投影；
//   ⑦ 崩溃恢复（真 SIGKILL）见 harness-bridge-goal-crash.test.js；
//   补充：队列语义（experimental add/advance）、用户输入 epoch 重置、系统提示段。
//
// 进程纪律：与 harness-bridge-b2d.test.js 相同——keepProductTools 挂产品面（goal 两件
// 在 coding 清单），临时工作区 chdir 后跑，finally 恢复。

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fauxAssistantMessage, fauxToolCall, fauxText } from "@earendil-works/pi-ai/providers/faux";
import { projectGoalStateData } from "./bridge-goal-view.js";
import { parseGoalCommand } from "./harness-bridge-goal.js";
import {
  buildTestLayer,
  makeFauxModels,
  waitForEvent,
} from "./harness-bridge-test-support.mjs";

const originalCwd = process.cwd();

async function withB2eFixture(run, options = {}) {
  const root = await mkdtemp(join(tmpdir(), "milksu-harness-b2e-"));
  const agentDir = join(root, "agent");
  const workspace = join(root, "workspace");
  await mkdir(agentDir, { recursive: true });
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
    return await run({ layer, events, emit, maps, faux, models, workspace, root, agentDir });
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

/** 内容分派 faux 工厂（时序不敏感；按最后一条 user 消息分派）。 */
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
      if (rule.match(userText, roundAfterTool)) return rule.respond(userText, roundAfterTool, messages);
    }
    return fauxAssistantMessage("unhandled dispatch");
  };
}

/** 从上下文消息里提取当前 goal_id（取最后一个 goal_id 块——多 goal 转录里首个是旧 id）。 */
function goalIdFromMessages(messages) {
  const all = messages.map(m => {
    if (typeof m?.content === "string") return m.content;
    if (Array.isArray(m?.content)) return m.content.map(b => String(b?.text ?? "")).join("");
    return "";
  }).join("\n");
  const matches = [...all.matchAll(/<goal_id>\n([^\n]+)\n<\/goal_id>/g)];
  return matches.at(-1)?.[1];
}

const goalStartRound = { match: text => text.includes("Goal mode is active") };
const continuationRound = { match: text => text.includes("Continue the active /goal") };
const wrapUpRound = { match: text => text.includes("token budget is exhausted") };

/** faux 慢节拍：goal 循环默认 ~10ms/轮，异步工厂延迟给测试注入留窗口。 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function startGoal(layer, objective, extra = {}) {
  await layer.sendMessage({
    ...goCommand,
    conversationId: "conv-goal",
    prompt: `/goal ${objective}`,
    ...extra,
  });
}

// ---------- ① 自主续跑 → goal_complete → 停 ----------

test("a goal runs one round, autonomously continues without user input, and stops on goal_complete", async () => {
  await withB2eFixture(async ({ layer, events, faux }) => {
    await layer.createSession({ ...goCommand, conversationId: "conv-goal" });
    const initial = (await waitForEvent(events, "goal_state"))[0];
    assert.equal(initial.goal, null, "no goal before /goal");

    let completed = false;
    const dispatcher = makeDispatcher([
      {
        ...goalStartRound,
        respond: () => fauxAssistantMessage("round one finished, work continues"),
      },
      {
        ...continuationRound,
        respond: (_text, _afterTool, messages) => {
          if (completed) return fauxAssistantMessage("already complete");
          completed = true;
          return fauxAssistantMessage([
            fauxText("everything is verified complete"),
            fauxToolCall("goal_complete", {
              goal_id: goalIdFromMessages(messages),
              summary: "All requirements verified against the current state.",
            }),
          ], { stopReason: "toolUse" });
        },
      },
    ]);
    faux.setResponses(Array.from({ length: 8 }, () => dispatcher));

    await startGoal(layer, "finish the b2e e2e goal");
    const active = (await waitForEvent(events, "goal_state", e => e.goal?.status === "active"))[0];
    assert.equal(active.goal.text, "finish the b2e e2e goal");
    const activeIndex = events.indexOf(active);

    // 第二轮 turn_started：无任何人工输入（sendMessage 只发过一次 /goal 命令）。
    await waitForEvent(events, "turn_started", undefined, 15000);
    const cleared = (await waitForEvent(
      events,
      "goal_state",
      e => e.goal === null && events.indexOf(e) > activeIndex,
    ))[0];
    assert.equal(cleared.goal, null, "goal cleared after completion");

    const turnStarts = events.filter(e => e.type === "turn_started").length;
    assert.ok(turnStarts >= 2, `autonomous continuation ran (${turnStarts} turns)`);
    const toolEnd = events.find(e => e.type === "tool_call_end" && e.toolName === "goal_complete");
    assert.match(String(toolEnd?.content ?? ""), /Goal complete: /);
    const settled = events.filter(e => e.type === "turn_settled");
    assert.equal(settled.length, 1, "exactly one turn_settled when the goal stops");
    await new Promise(resolve => setTimeout(resolve, 300));
    assert.equal(events.filter(e => e.type === "turn_started").length, turnStarts,
      "no further turns after completion");
  });
});

// ---------- ② goal_blocked → 报告并停 ----------

test("goal_blocked reports the impasse and stops the goal", async () => {
  await withB2eFixture(async ({ layer, events, faux }) => {
    await layer.createSession({ ...goCommand, conversationId: "conv-goal" });
    let blocked = false;
    const dispatcher = makeDispatcher([
      {
        ...goalStartRound,
        respond: () => fauxAssistantMessage("blocked after the first attempt"),
      },
      {
        ...continuationRound,
        respond: (_text, _afterTool, messages) => {
          if (blocked) return fauxAssistantMessage("should not run again");
          blocked = true;
          return fauxAssistantMessage([
            fauxText("true impasse reached"),
            fauxToolCall("goal_blocked", {
              goal_id: goalIdFromMessages(messages),
              reason: "the required external service is down for maintenance",
              evidence: "three consecutive turns failed with the same connection refusal",
              repeated_turns: 3,
            }),
          ], { stopReason: "toolUse" });
        },
      },
    ]);
    faux.setResponses(Array.from({ length: 8 }, () => dispatcher));
    await startGoal(layer, "call the external service");
    const blockedState = (await waitForEvent(events, "goal_state", e => e.goal?.status === "blocked"))[0];
    assert.equal(blockedState.goal.text, "call the external service");
    const toolEnd = events.find(e => e.type === "tool_call_end" && e.toolName === "goal_blocked");
    assert.match(String(toolEnd?.content ?? ""), /Goal blocked: /);
    await waitForEvent(events, "turn_settled", undefined, 15000);
    const turnStarts = events.filter(e => e.type === "turn_started").length;
    await new Promise(resolve => setTimeout(resolve, 300));
    assert.equal(events.filter(e => e.type === "turn_started").length, turnStarts,
      "no continuation after goal_blocked");
    assert.equal(events.filter(e => e.type === "turn_settled").length, 1);
  });
});

// ---------- ③ 无进展上限 ----------

test("the no-progress limit pauses the goal after repeated identical tool-free runs", async () => {
  await withB2eFixture(async ({ layer, events, faux }) => {
    await layer.createSession({ ...goCommand, conversationId: "conv-goal" });
    // 门关默认 continuationLimits：{ automaticTurns: null, noProgressTurns: 3 }。
    const dispatcher = makeDispatcher([
      {
        match: text => text.includes("Goal mode is active") || text.includes("Continue the active /goal"),
        respond: () => fauxAssistantMessage("identical no-progress output"),
      },
    ]);
    faux.setResponses(Array.from({ length: 12 }, () => dispatcher));
    await startGoal(layer, "make measurable progress");
    const paused = (await waitForEvent(events, "goal_state", e => e.goal?.status === "paused"))[0];
    // run1（goal-start 手动）不计 automatic；3 个 automatic 续跑轮指纹全同 → 第 3 轮
    // run_end 时 toolFreeRepeatCount=3 → safety pause。
    assert.equal(paused.goal.automaticModelTurns, 3,
      "three automatic turns counted before the pause");
    await waitForEvent(events, "turn_settled", undefined, 15000);
    const turnStarts = events.filter(e => e.type === "turn_started").length;
    assert.equal(turnStarts, 4, "goal-start run + three automatic continuations, then paused");
    await new Promise(resolve => setTimeout(resolve, 300));
    assert.equal(events.filter(e => e.type === "turn_started").length, turnStarts,
      "no further continuation after the safety pause");
  });
});

// ---------- ④ 预算收尾 ----------

test("the token budget wraps up: budget_limited, substantive tools blocked, goal_complete completes", async () => {
  await withB2eFixture(async ({ layer, events, faux }) => {
    await layer.createSession({ ...goCommand, conversationId: "conv-goal" });
    let wrapUpToolAttempted = false;
    const dispatcher = makeDispatcher([
      {
        // 触顶回合：首个工具后预算到顶（afterTool 触发 budget_limited + 收尾投递
        // 排队）；模型看到工具结果后以文本收口本回合。
        ...goalStartRound,
        respond: (_text, roundAfterTool, messages) => (
          roundAfterTool
            ? fauxAssistantMessage("stopping substantive work under the budget limit")
            : fauxAssistantMessage([
              fauxText("spending the budget"),
              fauxToolCall("bg_status", { action: "list" }),
            ], { stopReason: "toolUse" })
        ),
      },
      {
        // 收尾回合：先试实质工具（应被块），再 goal_complete（放行）。
        ...wrapUpRound,
        respond: (_text, roundAfterTool, messages) => {
          if (roundAfterTool) {
            return fauxAssistantMessage([
              fauxText("wrap-up complete"),
              fauxToolCall("goal_complete", {
                goal_id: goalIdFromMessages(messages),
                summary: "Budget wrap-up: verified progress summary; remaining work documented.",
              }),
            ], { stopReason: "toolUse" });
          }
          wrapUpToolAttempted = true;
          return fauxAssistantMessage([
            fauxText("trying one more substantive call"),
            fauxToolCall("bg_status", { action: "list" }),
          ], { stopReason: "toolUse" });
        },
      },
      {
        ...continuationRound,
        respond: () => fauxAssistantMessage("should not continue under budget limits"),
      },
    ]);
    faux.setResponses(Array.from({ length: 12 }, () => dispatcher));
    // 预算设小值：faux 用量（输入+输出估算）第一轮即越界 → afterTool 触发收尾投递。
    await startGoal(layer, "--tokens 100 budget the work");
    const limited = (await waitForEvent(events, "goal_state", e => e.goal?.status === "budget_limited"))[0];
    assert.equal(limited.goal.tokenBudget, 100);
    const limitedIndex = events.indexOf(limited);
    const cleared = (await waitForEvent(
      events,
      "goal_state",
      e => e.goal === null && events.indexOf(e) > limitedIndex,
    ))[0];
    assert.equal(cleared.goal, null, "goal completed during wrap-up");
    assert.ok(wrapUpToolAttempted, "the wrap-up prompt reached the model");
    const toolEnds = events.filter(e => e.type === "tool_call_end" && e.toolName === "bg_status");
    assert.ok(toolEnds.length >= 1, "the first bg_status ran before the budget tripped");
    const blockedTool = toolEnds.find(e => /budget is exhausted/.test(String(e.content ?? "")));
    assert.ok(blockedTool, "substantive tools are blocked during wrap-up");
    const completeEnd = events.find(e => e.type === "tool_call_end" && e.toolName === "goal_complete");
    assert.match(String(completeEnd?.content ?? ""), /Goal complete: /);
    await waitForEvent(events, "turn_settled", undefined, 15000);
    // 完成后无孤儿收尾回合（goal_complete 撤回了排队的收尾输入已被消费的场景除外：
    // 这里收尾回合本身跑了并完成）。
    const turnStarts = events.filter(e => e.type === "turn_started").length;
    await new Promise(resolve => setTimeout(resolve, 300));
    assert.equal(events.filter(e => e.type === "turn_started").length, turnStarts,
      "no orphan turn after completion");
  });
});

// ---------- ⑤ stale goal_id 守卫 ----------

test("stale goal_id completions are rejected and the goal keeps running", async () => {
  await withB2eFixture(async ({ layer, events, faux }) => {
    await layer.createSession({ ...goCommand, conversationId: "conv-goal" });
    let phase = 0;
    const dispatcher = makeDispatcher([
      {
        ...goalStartRound,
        respond: () => fauxAssistantMessage("first round done"),
      },
      {
        ...continuationRound,
        respond: (_text, roundAfterTool, messages) => {
          const realId = goalIdFromMessages(messages);
          if (roundAfterTool) {
            // 上一个工具结果（stale 拒绝）之后的第二轮：真 id 达成。
            phase += 1;
            return fauxAssistantMessage([
              fauxText("completing with the real id"),
              fauxToolCall("goal_complete", { goal_id: realId, summary: "Verified complete." }),
            ], { stopReason: "toolUse" });
          }
          phase += 1;
          return fauxAssistantMessage([
            fauxText("trying a stale id"),
            fauxToolCall("goal_complete", { goal_id: "0f000000-0000-4000-8000-000000000000", summary: "stale attempt" }),
          ], { stopReason: "toolUse" });
        },
      },
    ]);
    faux.setResponses(Array.from({ length: 8 }, () => dispatcher));
    await startGoal(layer, "guard against stale ids");
    const active = (await waitForEvent(events, "goal_state", e => e.goal?.status === "active"))[0];
    const activeIndex = events.indexOf(active);
    // stale 拒绝：goal 仍 active（reject 不 terminate），run 继续到下一轮。
    const staleEnd = (await waitForEvent(
      events,
      "tool_call_end",
      e => e.toolName === "goal_complete" && /does not match the active goal/.test(String(e.content ?? "")),
    ))[0];
    assert.ok(staleEnd, "stale goal_id completion rejected");
    // goal 在拒绝后仍 active：同一 run 内第二个 goal_complete 用真 id 成功达成
    //（达成路径要求 status === active——被拒后翻成 paused/blocked 的话这里到不了）。
    const cleared = (await waitForEvent(
      events,
      "goal_state",
      e => e.goal === null && events.indexOf(e) > events.indexOf(staleEnd),
    ))[0];
    assert.equal(cleared.goal, null, "the real goal_id completes the goal");
    assert.ok(phase >= 2, "the run continued after the rejection");
  });
});

// ---------- ⑥ ready.goal_state 投影逐字段 + Document 恢复 ----------

test("goal_state projects the document truth field by field and survives destroy/reopen", async () => {
  await withB2eFixture(async ({ layer, events, faux }) => {
    await layer.createSession({ ...goCommand, conversationId: "conv-goal" });
    const dispatcher = makeDispatcher([
      { ...goalStartRound, respond: () => fauxAssistantMessage("round one done") },
      {
        ...continuationRound,
        respond: (_text, _afterTool, messages) => fauxAssistantMessage([
          fauxText("done"),
          fauxToolCall("goal_complete", {
            goal_id: goalIdFromMessages(messages),
            summary: "Verified complete.",
          }),
        ], { stopReason: "toolUse" }),
      },
    ]);
    faux.setResponses(Array.from({ length: 8 }, () => dispatcher));
    await startGoal(layer, "--tokens 500 project me exactly");
    const active = (await waitForEvent(events, "goal_state", e => e.goal?.status === "active"))[0];
    const goal = active.goal;
    // 门关 projectGoalStateData 的字段集（bridge-goal-view.js）逐字段同形。
    assert.deepEqual(
      [...Object.keys(goal)].sort(),
      [
        "automaticModelTurns", "id", "iteration", "queuedCount", "startedAt",
        "status", "text", "timeUsedSeconds", "tokenBudget", "tokensUsed", "updatedAt",
      ],
      "the projection carries exactly the gate-closed fields",
    );
    assert.equal(typeof goal.id, "string");
    assert.ok(goal.id.length > 10);
    assert.equal(goal.text, "project me exactly");
    assert.equal(goal.status, "active");
    assert.equal(goal.tokenBudget, 500);
    assert.equal(goal.iteration, 0);
    assert.ok(Number.isInteger(goal.startedAt) && goal.startedAt >= 0);
    assert.ok(Number.isInteger(goal.updatedAt) && goal.updatedAt >= 0);
    assert.ok(Number.isInteger(goal.tokensUsed) && goal.tokensUsed >= 0);
    assert.ok(Number.isInteger(goal.timeUsedSeconds) && goal.timeUsedSeconds >= 0);
    assert.equal(goal.automaticModelTurns, 0);
    assert.equal(goal.queuedCount, 0);
    const goalId = goal.id;

    // destroy → 重开：goal 状态从 Conversation Document 恢复（同一 goal id），goal_state
    // 投影不再恒 null（B1/B2d 遗留收口）。
    await layer.destroySession({ conversationId: "conv-goal" });
    await layer.createSession({ ...goCommand, conversationId: "conv-goal" });
    const reopened = (await waitForEvent(
      events,
      "goal_state",
      e => e.goal?.id === goalId && events.indexOf(e) > events.indexOf(active),
    ))[0];
    assert.equal(reopened.goal.id, goalId, "the durable document restores the goal");
    assert.equal(reopened.goal.status, "active");
    // 重开即续跑（durable goal 语义；空闲重挂）→ 完成收尾。
    const cleared = (await waitForEvent(events, "goal_state", e => e.goal === null && e.goal !== undefined && events.indexOf(e) > events.indexOf(reopened)))[0];
    assert.equal(cleared.goal, null, "the reopened goal runs to completion");
  });
});

// ---------- 队列语义（experimental） ----------

test("the experimental queue advances to the next goal on completion", async () => {
  await withB2eFixture(async ({ layer, events, faux, agentDir }) => {
    await writeFile(join(agentDir, "pi-goal.json"), JSON.stringify({
      experimental: { goals: true },
    }, null, 2));
    await layer.createSession({ ...goCommand, conversationId: "conv-goal" });
    const dispatcher = makeDispatcher([
      {
        // 首 goal：文本干一轮（不立即达成——add 要在 goal 存活期落地）。
        match: text => text.includes("Goal mode is active") && text.includes("first objective"),
        respond: async () => {
          await delay(120);
          return fauxAssistantMessage("working on the first objective");
        },
      },
      {
        match: text => text.includes("Goal mode is active") && text.includes("second objective"),
        respond: async (_text, _afterTool, messages) => {
          await delay(120);
          return fauxAssistantMessage([
            fauxText("second done"),
            fauxToolCall("goal_complete", {
              goal_id: goalIdFromMessages(messages),
              summary: "Second objective verified complete.",
            }),
          ], { stopReason: "toolUse" });
        },
      },
      {
        // 续跑 #2 起达成首个 goal（add 已在 #1 期间/之前落盘，确定性由两次
        // sendMessage 的 await 保证）。
        ...continuationRound,
        respond: async (_text, _afterTool, messages) => {
          await delay(120);
          const iteration = Number(/automatic continuation #(\d+)/.exec(_text)?.[1] ?? 0);
          if (iteration < 2) return fauxAssistantMessage("first objective still in flight");
          return fauxAssistantMessage([
            fauxText("first done"),
            fauxToolCall("goal_complete", {
              goal_id: goalIdFromMessages(messages),
              summary: "First objective verified complete.",
            }),
          ], { stopReason: "toolUse" });
        },
      },
    ]);
    faux.setResponses(Array.from({ length: 10 }, () => dispatcher));
    await startGoal(layer, "first objective");
    await waitForEvent(events, "goal_state", e => e.goal?.status === "active" && e.goal?.text === "first objective");
    // add 进队列（experimental.goals 开）。
    await layer.sendMessage({
      ...goCommand,
      conversationId: "conv-goal",
      prompt: "/goal add second objective",
    });
    const queued = (await waitForEvent(events, "goal_state", e => e.goal?.queuedCount === 1))[0];
    assert.equal(queued.goal.text, "first objective");
    // 第一个 goal 达成 → advance → 第二个 goal 激活（新 id，队列空）。
    const second = (await waitForEvent(
      events,
      "goal_state",
      e => e.goal?.status === "active" && e.goal?.text === "second objective",
    ))[0];
    assert.notEqual(second.goal.id, queued.goal.id, "activation mints a fresh goal id");
    assert.equal(second.goal.queuedCount, 0);
    const cleared = (await waitForEvent(events, "goal_state", e => e.goal === null && events.indexOf(e) > events.indexOf(second)))[0];
    assert.equal(cleared.goal, null, "the queue drains to no goal");
    await waitForEvent(events, "turn_settled", undefined, 15000);
  });
});

// ---------- 用户输入 epoch 重置 ----------

test("user input while the goal is active resets the safety epoch", async () => {
  await withB2eFixture(async ({ layer, events, faux }) => {
    await layer.createSession({ ...goCommand, conversationId: "conv-goal" });
    let interjectionSeen = false;
    const dispatcher = makeDispatcher([
      {
        ...goalStartRound,
        respond: () => fauxAssistantMessage("round one done"),
      },
      {
        match: text => text.includes("user interjection"),
        respond: () => {
          interjectionSeen = true;
          return fauxAssistantMessage("acknowledged the user interjection");
        },
      },
      {
        ...continuationRound,
        respond: async (_text, _afterTool, messages) => {
          // 慢节拍（120ms/轮）给用户插话留出窗口——goal 循环否则 ~10ms/轮，测试
          // 注入会落后于整个自旋。
          await delay(120);
          if (interjectionSeen) {
            return fauxAssistantMessage([
              fauxText("done after the interjection"),
              fauxToolCall("goal_complete", {
                goal_id: goalIdFromMessages(messages),
                summary: "Verified complete after the user interjection.",
              }),
            ], { stopReason: "toolUse" });
          }
          // 插话前：先调一次只读工具把 run 拉成多 turn（turn_end 的计数事件在 run
          // 忙时到达，用户插话排队在当前 run 收尾后的边界——用户输入起 run → 重置）。
          if (_afterTool) return fauxAssistantMessage("still working after the check");
          return fauxAssistantMessage([
            fauxText("checking state"),
            fauxToolCall("bg_status", { action: "list" }),
          ], { stopReason: "toolUse" });
        },
      },
    ]);
    faux.setResponses(Array.from({ length: 16 }, () => dispatcher));
    await startGoal(layer, "count automatic turns");
    // 等 ≥1 个 automatic 轮计数（turn_end 观察门的 goal_state 投影），然后用户插话
    // （goal 仍 active；followUp 排队，下一边界起 run → epoch 重置）。
    const counted = (await waitForEvent(events, "goal_state", e => e.goal?.automaticModelTurns >= 1))[0];
    await layer.sendMessage({
      ...goCommand,
      conversationId: "conv-goal",
      prompt: "user interjection: keep going",
    });
    const reset = (await waitForEvent(
      events,
      "goal_state",
      e => e.goal?.automaticModelTurns === 0 && events.indexOf(e) > events.indexOf(counted),
    ))[0];
    assert.ok(reset, "the user-owned run resets the safety epoch");
    assert.ok(interjectionSeen, "the interjection round actually ran");
    await waitForEvent(events, "goal_state", e => e.goal === null, 15000);
  });
});

// ---------- 系统提示段（before_agent_start 的 buildGoalSystemPrompt 对应物） ----------

test("the milksu-goal section renders while active and disappears when the goal stops", async () => {
  await withB2eFixture(async ({ layer, events, faux }) => {
    await layer.createSession({ ...goCommand, conversationId: "conv-goal" });
    const dispatcher = makeDispatcher([
      { ...goalStartRound, respond: () => fauxAssistantMessage("round one done") },
      {
        ...continuationRound,
        respond: (_text, _afterTool, messages) => fauxAssistantMessage([
          fauxText("done"),
          fauxToolCall("goal_complete", {
            goal_id: goalIdFromMessages(messages),
            summary: "Verified complete.",
          }),
        ], { stopReason: "toolUse" }),
      },
    ]);
    faux.setResponses(Array.from({ length: 8 }, () => dispatcher));
    const sections = async () => {
      const page = await layer.conversationEntries("conv-goal", { limit: 100 });
      const found = [];
      for (const entry of [...page.items].reverse()) {
        const message = entry.model?.[0];
        if (message?.role === "system" && message.sections) {
          found.push({ sections: message.sections });
        }
      }
      return found;
    };
    const before = await sections();
    assert.ok(!before.some(r => r.sections["milksu-goal"] !== undefined),
      "no goal section before a goal exists");
    await startGoal(layer, "render the goal section");
    await waitForEvent(events, "turn_started", undefined, 15000);
    const during = await sections();
    const goalSection = during.find(r => typeof r.sections["milksu-goal"] === "string")?.sections["milksu-goal"];
    assert.ok(goalSection, "the goal section renders while the goal is active");
    assert.match(goalSection, /Active \/goal:/);
    assert.match(goalSection, /<goal_objective>/);
    assert.match(goalSection, /<goal_id>/);
    assert.match(goalSection, /Goal-mode rules:/);
    await waitForEvent(events, "goal_state", e => e.goal === null && e.goal !== undefined, 15000);
    await waitForEvent(events, "turn_settled", undefined, 15000);
    // 完成后无后续请求时门关同样不落删除段（惰性）；再发一条用户消息触发新请求，
    // 该请求的 pi.system 里 milksu-goal 被置 null（段移除）。
    const settledBefore = events.filter(e => e.type === "turn_settled").length;
    faux.appendResponses([fauxAssistantMessage("plain reply")]);
    await layer.sendMessage({
      ...goCommand,
      conversationId: "conv-goal",
      prompt: "plain follow-up",
    });
    await waitForEvent(
      events,
      "turn_settled",
      () => events.filter(e => e.type === "turn_settled").length > settledBefore,
      15000,
    );
    const after = await sections();
    const clearedSection = after.filter(r => r.sections["milksu-goal"] === null).length;
    assert.ok(clearedSection >= 1, "the goal section is removed on the next request after completion");
  });
});

// ---------- 命令解析（command.ts 移植的对照锚点） ----------

test("parseGoalCommand matches the pi-goal command surface", () => {
  assert.deepEqual(parseGoalCommand(""), { kind: "show" });
  assert.deepEqual(parseGoalCommand("pause"), { kind: "pause" });
  assert.deepEqual(parseGoalCommand("resume"), { kind: "resume" });
  assert.deepEqual(parseGoalCommand("clear"), { kind: "clear" });
  assert.deepEqual(parseGoalCommand("status"), { kind: "show" });
  assert.deepEqual(parseGoalCommand("edit new text"), { kind: "edit", objective: "new text", tokenBudget: undefined });
  assert.deepEqual(parseGoalCommand("ship the dock"), { kind: "start", objective: "ship the dock", tokenBudget: undefined });
  assert.deepEqual(parseGoalCommand("--tokens 100k ship it"), { kind: "start", objective: "ship it", tokenBudget: 100000 });
  assert.equal(parseGoalCommand("pause now"), "Usage: /goal pause");
  // experimental 门：add/prioritize/drop-last/skip 默认不可用。
  assert.deepEqual(parseGoalCommand("add another"), { kind: "start", objective: "add another", tokenBudget: undefined });
  assert.deepEqual(
    parseGoalCommand("add another", { experimentalGoals: true }),
    { kind: "add", objective: "another", tokenBudget: undefined },
  );
  assert.deepEqual(
    parseGoalCommand("push big", { experimentalGoals: true }),
    { kind: "add", objective: "big", tokenBudget: undefined },
  );
  assert.deepEqual(
    parseGoalCommand("--tokens 1m push big", { experimentalGoals: true }),
    // 与 pi-goal parseCommand 同款：--tokens 前缀吞两 token 后按 start 解析。
    { kind: "start", objective: "push big", tokenBudget: 1000000 },
  );
});

// ---------- 投影共享纯函数（门关同源的回归锚点） ----------

test("the goal projection keeps the gate-closed projectGoalStateData shape", () => {
  const goal = {
    id: "g1",
    text: "objective",
    status: "active",
    startedAt: 1,
    updatedAt: 2,
    iteration: 3,
    tokenBudget: 500,
    tokensUsed: 120,
    timeUsedSeconds: 9,
    automaticModelTurns: 2,
  };
  assert.deepEqual(projectGoalStateData({ goal, queue: [{}, {}, {}] }), {
    id: "g1",
    text: "objective",
    status: "active",
    startedAt: 1,
    updatedAt: 2,
    iteration: 3,
    tokenBudget: 500,
    tokensUsed: 120,
    timeUsedSeconds: 9,
    automaticModelTurns: 2,
    queuedCount: 3,
  });
  assert.equal(projectGoalStateData({ goal: null }), null);
});
