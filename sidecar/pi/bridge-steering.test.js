import assert from "node:assert/strict";
import test from "node:test";
import {
  projectSteeringQueue,
  removeQueuedMessage,
  steerSession,
} from "./bridge-steering.js";

function queuedSession(steering, followUp) {
  const state = {
    steering: [...steering],
    followUp: [...followUp],
    calls: [],
  };
  return {
    state,
    session: {
      clearQueue() {
        const cleared = {
          steering: [...state.steering],
          followUp: [...state.followUp],
        };
        state.steering = [];
        state.followUp = [];
        state.calls.push(["clear"]);
        return cleared;
      },
      async steer(message) {
        state.steering.push(message);
        state.calls.push(["steer", message]);
      },
      async followUp(message) {
        state.followUp.push(message);
        state.calls.push(["followUp", message]);
      },
    },
  };
}

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

test("removes one exact Pi steering message and rebuilds both queues", async () => {
  const fixture = queuedSession(
    ["先保留修改", "再检查失败测试"],
    ["最后总结"],
  );
  const sessions = new Map([["coding-1", fixture.session]]);

  const updated = await removeQueuedMessage(sessions, {
    conversationId: "coding-1",
    queue: "steering",
    index: 0,
    expected: "先保留修改",
  });

  assert.deepEqual(updated, {
    steering: ["再检查失败测试"],
    followUp: ["最后总结"],
  });
  assert.deepEqual(fixture.state.steering, ["再检查失败测试"]);
  assert.deepEqual(fixture.state.followUp, ["最后总结"]);
  assert.deepEqual(fixture.state.calls, [
    ["clear"],
    ["steer", "再检查失败测试"],
    ["followUp", "最后总结"],
  ]);
});

test("restores the exact queue when index and expected text are stale", async () => {
  const fixture = queuedSession(
    ["已经被应用的消息", "仍在等待的消息"],
    ["最后总结"],
  );
  const sessions = new Map([["coding-1", fixture.session]]);

  await assert.rejects(
    removeQueuedMessage(sessions, {
      conversationId: "coding-1",
      queue: "steering",
      index: 0,
      expected: "用户看到的旧消息",
    }),
    /changed before it could be removed/,
  );
  assert.deepEqual(fixture.state.steering, [
    "已经被应用的消息",
    "仍在等待的消息",
  ]);
  assert.deepEqual(fixture.state.followUp, ["最后总结"]);
});

test("rejects malformed queue controls before mutating Pi", async () => {
  const fixture = queuedSession(["保留"], []);
  const sessions = new Map([["coding-1", fixture.session]]);

  await assert.rejects(
    removeQueuedMessage(sessions, {
      conversationId: "coding-1",
      queue: "unknown",
      index: 0,
      expected: "保留",
    }),
    /unsupported queued message type/,
  );
  assert.deepEqual(fixture.state.calls, []);
});
