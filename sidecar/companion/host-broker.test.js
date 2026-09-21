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
