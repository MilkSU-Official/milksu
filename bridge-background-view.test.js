import assert from "node:assert/strict";
import test from "node:test";
import {
  backgroundTaskMetasForSession,
  projectBackgroundTaskMetas,
} from "./bridge-background-view.js";

test("background task selection isolates conversations sharing one workspace", () => {
  const selected = backgroundTaskMetasForSession([
    {
      id: "first",
      callbackOrigin: { cwd: "/workspace", sessionId: "conversation-1" },
    },
    {
      id: "second",
      callbackOrigin: { cwd: "/workspace", sessionId: "conversation-2" },
    },
    {
      id: "legacy",
      cwd: "/workspace",
    },
  ], "conversation-1");

  assert.deepEqual(selected.map(task => task.id), ["first"]);
  assert.deepEqual(backgroundTaskMetasForSession(selected, ""), []);
});

test("background task projection keeps active and recent Pi tasks without env values", () => {
  const now = 2_000_000;
  const tasks = projectBackgroundTaskMetas([
    {
      id: "running",
      name: "Vite dev server",
      kind: "process",
      status: "running",
      startedAt: 1_990_000,
      command: "npm run dev",
      cwd: "/workspace",
      pid: 4321,
      pgid: 4320,
      logPath: "/runtime/output.log",
      env: { SECRET: "must-not-leak" },
    },
    {
      id: "recent",
      kind: "command_watch",
      status: "succeeded",
      startedAt: 1_980_000,
      endedAt: 1_995_000,
      argv: ["npm", "test"],
      cwd: "/workspace",
      spawnPid: 12,
      logPath: "/runtime/test.log",
      lastExitCode: 0,
    },
    {
      id: "expired",
      kind: "process",
      status: "failed",
      startedAt: 1,
      endedAt: 100_000,
      cwd: "/workspace",
      spawnPid: 13,
      logPath: "/runtime/old.log",
    },
  ], now, (path, tailLines) => ({
    text: `${path}:${tailLines}\nready on http://127.0.0.1:4173`,
    truncated: true,
  }));

  assert.deepEqual(tasks.map(task => task.id), ["running", "recent"]);
  assert.equal(tasks[0].command, "npm run dev");
  assert.equal(tasks[0].pgid, 4320);
  assert.match(tasks[0].logTail, /ready on/);
  assert.equal(tasks[0].logTruncated, true);
  assert.equal(tasks[1].kind, "watch");
  assert.equal(tasks[1].pid, 12);
  assert.equal(tasks[1].lastExitCode, 0);
  assert.equal("env" in tasks[0], false);
  assert.equal(JSON.stringify(tasks).includes("must-not-leak"), false);
});

test("background task projection keeps recovered spawnPid visible as PID", () => {
  const [task] = projectBackgroundTaskMetas([{
    id: "recovered-watch",
    kind: "command_watch",
    status: "running",
    startedAt: 1,
    argv: ["npm", "run", "dev"],
    cwd: "/workspace",
    spawnPid: 9876,
    pid: 0,
  }], 2);

  assert.equal(task.pid, 9876);
});

test("background task projection treats unreadable logs as optional", () => {
  const task = projectBackgroundTaskMetas([{
    id: "running",
    kind: "process",
    status: "running",
    startedAt: 1,
    cwd: "/workspace",
    spawnPid: 12,
    logPath: "/runtime/output.log",
  }], 2, () => {
    throw new Error("unreadable");
  })[0];

  assert.equal("logTail" in task, false);
  assert.equal("logTruncated" in task, false);
});

test("background task projection bounds untrusted registry text", () => {
  const task = projectBackgroundTaskMetas([{
    id: "task\u0000",
    kind: "process",
    status: "running",
    startedAt: 1,
    command: `node ${"x".repeat(3000)}`,
    cwd: "/workspace",
    spawnPid: 12,
    logPath: "/runtime/output.log",
    error: "y".repeat(1500),
  }], 2)[0];

  assert.equal(task.id, "task");
  assert.ok(task.command.length <= 2000);
  assert.ok(task.error.length <= 1000);
});
