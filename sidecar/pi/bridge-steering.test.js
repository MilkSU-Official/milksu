import assert from "node:assert/strict";
import test from "node:test";
import { projectSteeringQueue, steerSession } from "./bridge-steering.js";

test("delegates running guidance to Pi steering semantics", async () => {
  const calls = [];
  const sessions = new Map([["coding-1", {
    async steer(message) {
      calls.push(message);
    },
  }]]);

  await steerSession(sessions, {
    conversationId: "coding-1",
    prompt: "先保留当前修改，再检查失败测试。",
  });

  assert.deepEqual(calls, ["先保留当前修改，再检查失败测试。"]);
});

test("rejects steering without an existing Pi session", async () => {
  await assert.rejects(
    steerSession(new Map(), { conversationId: "missing", prompt: "继续" }),
    /PI session not found/,
  );
});

test("projects a bounded Pi queue for the desktop UI", () => {
  assert.deepEqual(projectSteeringQueue({
    steering: ["一", "二"],
    followUp: ["完成后总结"],
  }), {
    steering: ["一", "二"],
    followUp: ["完成后总结"],
  });
});
