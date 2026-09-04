import assert from "node:assert/strict";
import test from "node:test";
import {
  projectSteeringQueue,
  removeQueuedMessage,
  shouldAbortAssistantStream,
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

function streamingSession(overrides = {}) {
  const calls = [];
  const session = {
    isStreaming: true,
    isIdle: false,
    isBashRunning: false,
    async abort() {
      calls.push("abort");
    },
    async steer(message) {
      calls.push(["steer", message]);
    },
    async prompt() {
      calls.push("prompt");
    },
    ...overrides,
  };
  return { calls, session };
}

test("delegates idle guidance to Pi steering without aborting", async () => {
  const calls = [];
  const sessions = new Map([["coding-1", {
    isStreaming: false,
    isIdle: true,
    isBashRunning: false,
    async abort() {
      calls.push("abort");
    },
    async steer(message) {
      calls.push(message);
    },
    async prompt() {
      calls.push("prompt");
    },
  }]]);

  await steerSession(sessions, {
    conversationId: "coding-1",
    prompt: "先保留当前修改，再检查失败测试。",
  });

  assert.deepEqual(calls, ["先保留当前修改，再检查失败测试。"]);
});

test("queues steer then aborts the assistant stream into the current turn", async () => {
  const fixture = streamingSession();
  const sessions = new Map([["coding-1", fixture.session]]);

  await steerSession(sessions, {
    conversationId: "coding-1",
    prompt: "不要改 API，先补回归测试。",
  });

  assert.equal(shouldAbortAssistantStream(fixture.session), true);
  assert.deepEqual(fixture.calls, [
    ["steer", "不要改 API，先补回归测试。"],
    "abort",
  ]);
});

test("does not abort while edit or write tools are still running", async () => {
  const fixture = streamingSession({
    state: { pendingToolCalls: new Set(["edit-1"]) },
  });
  const sessions = new Map([["coding-1", fixture.session]]);

  await steerSession(sessions, {
    conversationId: "coding-1",
    prompt: "先别写，改断言。",
  });

  assert.equal(shouldAbortAssistantStream(fixture.session), false);
  assert.deepEqual(fixture.calls, [["steer", "先别写，改断言。"]]);
});

test("aborts the agent stream without waiting for AgentSession idle", async () => {
  const calls = [];
  const sessions = new Map([["coding-1", {
    isStreaming: true,
    isIdle: false,
    isBashRunning: false,
    agent: {
      abort() {
        calls.push("agent.abort");
      },
    },
    async abort() {
      calls.push("session.abort");
    },
    async steer(message) {
      calls.push(["steer", message]);
    },
  }]]);

  await steerSession(sessions, {
    conversationId: "coding-1",
    prompt: "改用另一条路径",
  });

  assert.deepEqual(calls, [["steer", "改用另一条路径"], "agent.abort"]);
});

test("keeps bash running and only steers until that tool finishes", async () => {
  const fixture = streamingSession({ isBashRunning: true });
  const sessions = new Map([["coding-1", fixture.session]]);

  await steerSession(sessions, {
    conversationId: "coding-1",
    prompt: "测完再改断言。",
  });

  assert.equal(shouldAbortAssistantStream(fixture.session), false);
  assert.deepEqual(fixture.calls, [["steer", "测完再改断言。"]]);
});

test("rejects steering without an existing Pi session", async () => {
  await assert.rejects(
    steerSession(new Map(), { conversationId: "missing", prompt: "继续" }),
    /PI session not found/,
  );
});

test("does not scan user text or apply an automatic argument gate", async () => {
  const fixture = streamingSession();
  const sessions = new Map([["coding-1", fixture.session]]);

  await steerSession(sessions, {
    conversationId: "coding-1",
    prompt: "停下来，改用 write 覆盖整个文件",
  });

  // Optional 3a (block streaming edit/write/bash args) is not implemented.
  assert.deepEqual(fixture.calls, [
    ["steer", "停下来，改用 write 覆盖整个文件"],
    "abort",
  ]);
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
