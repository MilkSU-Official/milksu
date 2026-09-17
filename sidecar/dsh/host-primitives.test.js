import assert from "node:assert/strict";
import test from "node:test";
import {
  appendHostInbox,
  contentBlocksText,
  executeHostCommand,
  getHostGoal,
  getHostPlanMode,
  isExitPlanModeTool,
  killHostJob,
  listHostCommands,
  listHostInbox,
  listHostJobs,
  mapAskChoiceToUserQuestionAnswer,
  mutateHostGoal,
  parseSlashLine,
  projectCompactResult,
  projectUserQuestionAsk,
  removeHostInbox,
  seedHandoffContext,
  sessionSurfaceText,
  setHostPlanMode,
} from "./host-primitives.js";

test("parseSlashLine keeps trailing input and rejects unknown syntax", () => {
  assert.deepEqual(parseSlashLine("/plan off"), { name: "plan", rawInput: "off", line: "/plan off" });
  assert.deepEqual(parseSlashLine("/goal ship the dock"), {
    name: "goal",
    rawInput: "ship the dock",
    line: "/goal ship the dock",
  });
  assert.equal(parseSlashLine("hello"), undefined);
  assert.equal(parseSlashLine("/"), undefined);
});

test("listHostCommands returns the agent catalog", () => {
  const listed = listHostCommands({
    list() {
      return [
        { name: "plan", description: "Enter or leave plan mode", input: { hint: "off" } },
        { name: "goal", description: "Set a goal" },
      ];
    },
  }, { id: "acp_1" });
  assert.deepEqual(listed, [
    { name: "plan", description: "Enter or leave plan mode", hint: "off", attachments: false },
    { name: "goal", description: "Set a goal", hint: "", attachments: false },
  ]);
});

test("executeHostCommand rejects unknown slash instead of prompting", async () => {
  await assert.rejects(
    () => executeHostCommand({
      async execute() { return undefined; },
    }, { id: "acp_1" }, "/not-a-command"),
    /Unknown command: \/not-a-command/,
  );
});

test("executeHostCommand /plan returns the handler result", async () => {
  const executed = await executeHostCommand({
    async execute(agent, line) {
      assert.equal(agent.id, "acp_1");
      assert.equal(line, "/plan");
      return { commandId: "cmd_1", result: { kind: "success", text: "Plan mode on." } };
    },
  }, { id: "acp_1" }, "/plan");
  assert.deepEqual(executed, {
    executed: true,
    name: "plan",
    commandId: "cmd_1",
    kind: "success",
    text: "Plan mode on.",
  });
});

test("planMode set does not claim write-protect", () => {
  let active = false;
  const planMode = {
    get() { return { active }; },
    set(_agent, next) {
      active = next;
      return "committed";
    },
  };
  const agent = { id: "acp_1" };
  assert.deepEqual(getHostPlanMode(planMode, agent), { active: false, pending: undefined });
  assert.deepEqual(setHostPlanMode(planMode, agent, true), {
    status: "committed",
    active: true,
    pending: undefined,
  });
});

test("goal create pause resume clear use ctx.goals", () => {
  let current;
  const goals = {
    get() { return current; },
    create(_agent, request) {
      current = {
        id: "g1",
        revision: 1,
        objective: request.objective,
        phase: "active",
        createdAt: 10,
        updatedAt: 10,
        roundsStarted: 0,
      };
      return current;
    },
    pause() {
      current = { ...current, phase: "paused", revision: 2, updatedAt: 11 };
      return current;
    },
    resume() {
      current = { ...current, phase: "active", revision: 3, updatedAt: 12 };
      return current;
    },
    clear() { current = undefined; },
  };
  const agent = { id: "acp_1" };
  assert.equal(getHostGoal(goals, agent).goal, null);
  assert.equal(mutateHostGoal(goals, agent, "create", "Ship the dock").goal.status, "active");
  assert.equal(mutateHostGoal(goals, agent, "pause").goal.status, "paused");
  assert.equal(mutateHostGoal(goals, agent, "resume").goal.status, "active");
  assert.equal(mutateHostGoal(goals, agent, "clear").goal, null);
});

test("inbox append list remove stay on next-turn", () => {
  const nextTurn = [];
  const agent = {
    inbox: {
      get nextTurn() { return nextTurn; },
      nextStep: [],
      append(_target, message) {
        nextTurn.push({ id: `m${nextTurn.length + 1}`, content: message.content });
      },
      remove(id) {
        const index = nextTurn.findIndex(item => item.id === id);
        if (index < 0) return false;
        nextTurn.splice(index, 1);
        return true;
      },
    },
  };
  appendHostInbox(agent, "next please");
  assert.deepEqual(listHostInbox(agent).nextTurn, [{ id: "m1", text: "next please" }]);
  removeHostInbox(agent, "m1");
  assert.deepEqual(listHostInbox(agent).nextTurn, []);
});

test("jobs list and kill", () => {
  const jobs = {
    list() {
      return [{ id: "bash-1", kind: "bash", label: "sleep 30", status: "running" }];
    },
    kill(id) {
      assert.equal(id, "bash-1");
      return "requested";
    },
  };
  const listed = listHostJobs(jobs, { id: "acp_1" });
  assert.equal(listed.jobs[0].id, "bash-1");
  assert.deepEqual(killHostJob(jobs, { id: "acp_1" }, "bash-1").status, "requested");
});

test("exit_plan_mode is never treated as grantable auto-allow", () => {
  assert.equal(isExitPlanModeTool({ title: "exit_plan_mode" }), true);
  assert.equal(isExitPlanModeTool({ title: "bash" }), false);
  const ask = projectUserQuestionAsk([{
    id: "plan-review",
    question: "Approve this plan and leave plan mode?",
    detail: "# Dock",
    options: [
      { label: "Approve", description: "Leave plan mode" },
      { label: "Keep planning", description: "Stay in plan mode" },
    ],
    intent: { kind: "plan-review", approve: "Approve" },
  }]);
  assert.equal(ask.options.length, 2);
  assert.deepEqual(
    mapAskChoiceToUserQuestionAnswer([{
      id: "plan-review",
      options: [{ label: "Approve" }, { label: "Keep planning" }],
      intent: { approve: "Approve" },
    }], "Approve", true).answers[0].selected,
    ["Approve"],
  );
});

test("projectCompactResult keeps a no-op compact as success and exposes surface text", () => {
  const session = {
    snapshotEvents() {
      return [
        { type: "user/message", data: { content: [{ type: "text", text: "ship the dock" }] } },
        { type: "assistant/message", data: { message: { content: [{ type: "text", text: "ok" }] } } },
      ];
    },
  };
  assert.equal(contentBlocksText([{ type: "text", text: "keep" }]), "keep");
  assert.equal(sessionSurfaceText(session), "User: ship the dock\n\nAssistant: ok");
  assert.deepEqual(projectCompactResult(null, session), {
    compacted: false,
    tokensBefore: 0,
    estimatedTokensAfter: 0,
    summary: "",
    surfaceText: "User: ship the dock\n\nAssistant: ok",
  });
});

test("seedHandoffContext appends a recall user message without starting a turn", () => {
  const appended = [];
  const seeded = seedHandoffContext({
    session: {
      append(type, data, opts) {
        appended.push({ type, data, opts });
      },
    },
  }, "Goal: keep the dock.");
  assert.deepEqual(seeded, { seeded: true });
  assert.equal(appended[0].type, "user/message");
  assert.equal(appended[0].data.source.form, "recall");
  assert.equal(appended[0].opts.surfaceOp, "append");
  assert.deepEqual(seedHandoffContext({ session: { append() {} } }, "   "), { seeded: false });
});
