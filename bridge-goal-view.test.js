import assert from "node:assert/strict";
import test from "node:test";
import {
  goalKeepsSessionRunning,
  projectGoalStateData,
  projectSessionGoal,
} from "./bridge-goal-view.js";

const activeGoal = {
  id: "goal-1",
  text: "交付并验证当前项目",
  status: "active",
  startedAt: 100,
  updatedAt: 200,
  iteration: 2,
  tokenBudget: 100_000,
  tokensUsed: 12_345.9,
  timeUsedSeconds: 67.8,
  automaticModelTurns: 3,
};

test("projects the bounded pi-goal state used by the desktop protocol", () => {
  assert.deepEqual(projectGoalStateData({
    goal: activeGoal,
    queue: [{}, {}],
  }), {
    id: "goal-1",
    text: "交付并验证当前项目",
    status: "active",
    startedAt: 100,
    updatedAt: 200,
    iteration: 2,
    tokenBudget: 100_000,
    tokensUsed: 12_345,
    timeUsedSeconds: 67,
    automaticModelTurns: 3,
    queuedCount: 2,
  });
});

test("uses the latest canonical entry and honors an explicit clear", () => {
  const sessionManager = {
    getBranch: () => [
      {
        type: "custom",
        customType: "goal-state",
        data: { goal: activeGoal },
      },
      {
        type: "custom",
        customType: "goal-state",
        data: { goal: null },
      },
    ],
  };
  assert.equal(projectSessionGoal(sessionManager), null);
});

test("rejects malformed or unsupported goal state", () => {
  assert.equal(projectGoalStateData({ goal: { ...activeGoal, status: "mystery" } }), null);
  assert.equal(projectGoalStateData({ goal: { ...activeGoal, id: "" } }), null);
  assert.equal(projectGoalStateData({ goal: null }), null);
});

test("only active or queued goals keep the visible turn running", () => {
  assert.equal(goalKeepsSessionRunning(activeGoal), true);
  assert.equal(goalKeepsSessionRunning({ ...activeGoal, status: "queued" }), true);
  for (const status of [
    "complete",
    "paused",
    "blocked",
    "usage_limited",
    "budget_limited",
  ]) {
    assert.equal(goalKeepsSessionRunning({ ...activeGoal, status }), false);
  }
  assert.equal(goalKeepsSessionRunning(null), false);
});
