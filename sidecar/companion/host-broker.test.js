import assert from "node:assert/strict";
import test from "node:test";
import {
  createCompanionHostBroker,
  defaultCompanionHostTimeoutMs,
} from "./host-broker.js";

test("host broker defaults to a finite timeout like workspace_action", async () => {
  assert.ok(defaultCompanionHostTimeoutMs > 0);
  const events = [];
  const broker = createCompanionHostBroker((type, data) => {
    events.push({ type, ...data });
  }, { defaultTimeoutMs: 20 });
  await assert.rejects(
    () => broker.request("app", { action: "read_conversation" }),
    /timed out \(app\)/,
  );
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "companion_host");
  assert.equal(events[0].action, "app");
  assert.equal(broker.pendingCount(), 0);
});

test("timeoutMs 0 parks until respond or cancelAll", async () => {
  const broker = createCompanionHostBroker(() => {});
  const pending = broker.request("app", { action: "quit" }, { timeoutMs: 0 });
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(broker.pendingCount(), 1);
  broker.cancelAll("turn aborted");
  await assert.rejects(() => pending, /turn aborted/);
  assert.equal(broker.pendingCount(), 0);
});

test("respond resolves a pending host request", async () => {
  let requestId = "";
  const broker = createCompanionHostBroker((_type, data) => {
    requestId = data.requestId;
  });
  const pending = broker.request("board", { action: "list" });
  assert.equal(broker.respond({ requestId, ok: true, result: { sessions: [] } }), true);
  assert.deepEqual(await pending, { sessions: [] });
});

test("one host timeout does not cancelAll other pending host waits", async () => {
  let parkedId = "";
  const broker = createCompanionHostBroker((_type, data) => {
    if (data?.action === "app") parkedId = data.requestId;
  }, { defaultTimeoutMs: 20 });
  const timedOut = broker.request("board", { action: "list" });
  const parked = broker.request("app", { action: "quit" }, { timeoutMs: 0 });
  await assert.rejects(() => timedOut, /timed out \(board\)/);
  // Finite timeout must not wipe parked confirm waits — that would abort the loop.
  assert.equal(broker.pendingCount(), 1);
  assert.ok(parkedId);
  assert.equal(broker.respond({ requestId: parkedId, ok: true, result: { ok: true } }), true);
  assert.deepEqual(await parked, { ok: true });
  assert.equal(broker.pendingCount(), 0);
});

test("host timeout rejects without calling cancelAll", async () => {
  let cancelReason = "";
  const events = [];
  const broker = createCompanionHostBroker((type, data) => {
    events.push({ type, ...data });
  }, { defaultTimeoutMs: 15 });
  const originalCancel = broker.cancelAll.bind(broker);
  broker.cancelAll = (reason) => {
    cancelReason = String(reason || "");
    return originalCancel(reason);
  };
  await assert.rejects(
    () => broker.request("dispatch", { action: "speak" }),
    /timed out \(dispatch\)/,
  );
  assert.equal(cancelReason, "");
  assert.equal(broker.pendingCount(), 0);
  assert.equal(events.length, 1);
});

test("late respond after cancelAll is ignored without throwing", async () => {
  let requestId = "";
  const broker = createCompanionHostBroker((_type, data) => {
    requestId = data.requestId;
  });
  const pending = broker.request("app", { action: "quit" }, { timeoutMs: 0 });
  broker.cancelAll("turn aborted");
  await assert.rejects(() => pending, /turn aborted/);
  assert.equal(broker.respond({ requestId, ok: true, result: {} }), false);
  assert.equal(broker.pendingCount(), 0);
});
