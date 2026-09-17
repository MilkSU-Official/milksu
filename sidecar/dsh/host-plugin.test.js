import assert from "node:assert/strict";
import { createConnection } from "node:net";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { dshProductIpc } from "../hostpath.js";

const here = dirname(fileURLToPath(import.meta.url));

function loadHostPlugin() {
  return import(pathToFileURL(join(here, "host-plugin.mjs")).href);
}

function withHostIpcEnv(id, work) {
  const previous = process.env.MILKSU_DSH_HOST_IPC;
  process.env.MILKSU_DSH_HOST_IPC = dshProductIpc(id);
  return Promise.resolve()
    .then(work)
    .finally(() => {
      if (previous === undefined) delete process.env.MILKSU_DSH_HOST_IPC;
      else process.env.MILKSU_DSH_HOST_IPC = previous;
    });
}

test("host plugin loads as an ES module from a .mjs path", async () => {
  const loaded = await loadHostPlugin();
  assert.equal(loaded.name, "milksu-dsh-host");
  assert.equal(loaded.inject, undefined);
  assert.equal(loaded.optionalInject, undefined);
  assert.equal(typeof loaded.apply, "function");
  assert.equal(typeof loaded.dispatch, "function");
});

test("host plugin lists and interrupts through ctx.subagents", async () => {
  const loaded = await import(pathToFileURL(join(here, "host-plugin.mjs")).href);
  const interrupted = [];
  const ctx = {
    agents: { get: (id) => (id === "acp_1" ? { id } : null) },
    subagents: {
      async listChildren() {
        return [{
          kind: "child",
          id: "cf4fb9a2",
          activity: "running",
          mode: "continuable",
          label: "环境巡检",
        }];
      },
      interruptByParent(childId, parentId) {
        interrupted.push({ childId, parentId });
      },
      async drainContinuableChildren() {},
    },
  };
  const listed = await loaded.dispatch(ctx, new Set(), {}, {
    method: "list_subagents",
    params: { sessionId: "acp_1" },
  });
  assert.deepEqual(listed.subagentTasks, [{
    id: "cf4fb9a2",
    role: "环境巡检",
    status: "running",
    toolCallId: "cf4fb9a2",
  }]);
  await loaded.dispatch(ctx, new Set(), {}, {
    method: "interrupt_subagent",
    params: { sessionId: "acp_1", subagentId: "cf4fb9a2" },
  });
  assert.deepEqual(interrupted, [{ childId: "cf4fb9a2", parentId: "acp_1" }]);
});

test("Sidecar package bundles the host plugin so DSH can load it from a CommonJS tree", () => {
  const packager = readFileSync(join(here, "..", "..", "scripts", "package-sidecar.mjs"), "utf8");
  assert.match(packager, /bundleDshHostPlugin/);
  assert.match(packager, /host-plugin\.mjs/);
  assert.match(packager, /format: 'esm'/);
  assert.match(packager, /playwright-lazy-mcp\.cjs/);
});

test("apply does not leak cannot-create-effect on inactive context", async (t) => {
  const loaded = await loadHostPlugin();

  await t.test("inactive fiber skips effect and listeners", async () => {
    let effectCalls = 0;
    let listenerCalls = 0;
    const ctx = {
      fiber: { uid: null, state: 5 },
      effect() {
        effectCalls += 1;
        throw new Error("cannot create effect on inactive context");
      },
      on() {
        listenerCalls += 1;
        throw new Error("cannot create effect on inactive context");
      },
    };
    await withHostIpcEnv(`host-inactive-${process.pid}`, () => {
      loaded.apply(ctx);
    });
    assert.equal(effectCalls, 0);
    assert.equal(listenerCalls, 0);
  });

  await t.test("late inactive-context throw does not fail apply", async () => {
    const ctx = {
      fiber: { uid: 3, state: 1 },
      effect() {
        throw new Error("cannot create effect on inactive context");
      },
      on() {
        throw new Error("cannot create effect on inactive context");
      },
    };
    await withHostIpcEnv(`host-race-${process.pid}`, () => {
      loaded.apply(ctx);
    });
  });

  await t.test("active fiber listens through ctx.effect", async () => {
    const listeners = [];
    const disposers = [];
    try {
      await withHostIpcEnv(`host-active-${process.pid}`, async () => {
        const path = process.env.MILKSU_DSH_HOST_IPC;
        const ctx = {
          fiber: { uid: 1, state: 1 },
          effect(fn) {
            const dispose = fn();
            disposers.push(dispose);
            return dispose;
          },
          on(name) {
            listeners.push(name);
            return () => {};
          },
        };
        loaded.apply(ctx);
        assert.deepEqual(listeners, ["user-questions/request", "subagent/start", "subagent/end"]);
        assert.equal(disposers.length, 1);
        await new Promise((resolve, reject) => {
          const started = Date.now();
          const tryConnect = () => {
            const socket = createConnection(path);
            socket.on("connect", () => {
              socket.end();
              resolve();
            });
            socket.on("error", () => {
              socket.destroy();
              if (Date.now() - started > 1000) {
                reject(new Error("host plugin did not listen"));
                return;
              }
              setTimeout(tryConnect, 20);
            });
          };
          tryConnect();
        });
      });
    } finally {
      for (const dispose of disposers) {
        if (typeof dispose === "function") dispose();
      }
    }
  });
});

test("host plugin followup uses Agent.followup and does not wait for idle", async () => {
  const loaded = await loadHostPlugin();
  const calls = [];
  const ctx = {
    get(name) {
      if (name === "agents") {
        return {
          get: (id) => (id === "acp_1" ? {
            id,
            followup(message) {
              calls.push(message);
            },
          } : null),
        };
      }
      return undefined;
    },
  };
  const queued = await loaded.dispatch(ctx, new Set(), {}, {
    method: "followup",
    params: { sessionId: "acp_1", prompt: "keep going" },
  });
  assert.deepEqual(queued, { queued: true });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].content, [{ type: "text", text: "keep going" }]);
  assert.deepEqual(calls[0].source, { kind: "user" });
  await assert.rejects(
    () => loaded.dispatch(ctx, new Set(), {}, {
      method: "followup",
      params: { sessionId: "acp_1", prompt: "   " },
    }),
    /prompt is required/,
  );
});

function hostCtx(services) {
  return {
    get(name) {
      return services[name];
    },
  };
}

test("host plugin lists and executes commands without sending unknown slash as a prompt", async () => {
  const loaded = await loadHostPlugin();
  const ctx = hostCtx({
    agents: { get: (id) => (id === "acp_1" ? { id } : null) },
    commands: {
      list() {
        return [{ name: "plan", description: "Enter or leave plan mode" }];
      },
      async execute(_agent, line) {
        if (line === "/plan") {
          return { commandId: "c1", result: { kind: "success", text: "Plan mode on." } };
        }
        return undefined;
      },
    },
  });
  const listed = await loaded.dispatch(ctx, new Set(), {}, {
    method: "list_commands",
    params: { sessionId: "acp_1" },
  });
  assert.equal(listed.commands[0].name, "plan");
  const executed = await loaded.dispatch(ctx, new Set(), {}, {
    method: "execute_command",
    params: { sessionId: "acp_1", line: "/plan" },
  });
  assert.equal(executed.kind, "success");
  await assert.rejects(
    () => loaded.dispatch(ctx, new Set(), {}, {
      method: "execute_command",
      params: { sessionId: "acp_1", line: "/not-real" },
    }),
    /Unknown command: \/not-real/,
  );
});

test("host plugin plan goal inbox and jobs stay on in-process primitives", async () => {
  const loaded = await loadHostPlugin();
  let planActive = false;
  let goal;
  const nextTurn = [];
  const agent = {
    id: "acp_1",
    inbox: {
      get nextTurn() { return nextTurn; },
      nextStep: [],
      append(_target, message) {
        nextTurn.push({ id: "m1", content: message.content });
      },
      remove() {
        nextTurn.splice(0, nextTurn.length);
        return true;
      },
    },
  };
  const ctx = hostCtx({
    agents: { get: (id) => (id === "acp_1" ? agent : null) },
    planMode: {
      get() { return { active: planActive }; },
      set(_agent, active) { planActive = active; return "committed"; },
    },
    goals: {
      get() { return goal; },
      create(_agent, request) {
        goal = { id: "g1", revision: 1, objective: request.objective, phase: "active" };
        return goal;
      },
      pause() {
        goal = { ...goal, phase: "paused", revision: 2 };
        return goal;
      },
      clear() { goal = undefined; },
    },
    jobs: {
      list() { return [{ id: "bash-1", kind: "bash", label: "sleep", status: "running" }]; },
      kill() { return "requested"; },
    },
  });
  const plan = await loaded.dispatch(ctx, new Set(), {}, {
    method: "set_plan",
    params: { sessionId: "acp_1", active: true },
  });
  assert.equal(plan.active, true);
  const created = await loaded.dispatch(ctx, new Set(), {}, {
    method: "control_goal",
    params: { sessionId: "acp_1", action: "create", objective: "Ship dock" },
  });
  assert.equal(created.goal.text, "Ship dock");
  const queued = await loaded.dispatch(ctx, new Set(), {}, {
    method: "inbox_append",
    params: { sessionId: "acp_1", prompt: "after this turn" },
  });
  assert.equal(queued.nextTurn[0].text, "after this turn");
  const jobs = await loaded.dispatch(ctx, new Set(), {}, {
    method: "list_jobs",
    params: { sessionId: "acp_1" },
  });
  assert.equal(jobs.jobs[0].id, "bash-1");
  const killed = await loaded.dispatch(ctx, new Set(), {}, {
    method: "kill_job",
    params: { sessionId: "acp_1", jobId: "bash-1" },
  });
  assert.equal(killed.killed, true);
});

test("dispatch reads agents through ctx.get so the plugin need not inject them", async () => {
  const loaded = await loadHostPlugin();
  const ctx = {
    get(name) {
      if (name === "agents") return { get: (id) => (id === "acp_1" ? { id } : null) };
      if (name === "compaction") {
        return {
          async compactNow() {
            return { shadowedTokenCount: 12 };
          },
        };
      }
      return undefined;
    },
  };
  const compacted = await loaded.dispatch(ctx, new Set(), {}, {
    method: "compact",
    params: { sessionId: "acp_1" },
  });
  assert.equal(compacted.compacted, true);
  assert.equal(compacted.tokensBefore, 12);
});
