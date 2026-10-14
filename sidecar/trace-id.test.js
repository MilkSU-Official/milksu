import assert from "node:assert/strict";
import test from "node:test";
import {
  applyTraceEnv,
  formatTracePrefix,
  normalizeTraceId,
  resolveTraceId,
} from "./trace-id.js";

test("resolveTraceId prefers the command field over env", () => {
  const id = "trc_550e8400-e29b-41d4-a716-446655440000";
  assert.equal(resolveTraceId({ traceId: id }, { MILKSU_TRACE_ID: "trc_11111111-1111-4111-8111-111111111111" }), id);
  assert.equal(resolveTraceId({}, { MILKSU_TRACE_ID: id }), id);
  assert.equal(resolveTraceId({ traceId: "conversation-1" }, {}), "");
  assert.equal(formatTracePrefix(id), `[${id}]`);
  assert.equal(normalizeTraceId("trc_not-a-uuid"), "");
});

test("applyTraceEnv copies a valid id and skips junk", () => {
  const id = "trc_550e8400-e29b-41d4-a716-446655440000";
  assert.equal(applyTraceEnv({ PATH: "/bin" }, id).MILKSU_TRACE_ID, id);
  assert.equal(applyTraceEnv({ PATH: "/bin" }, "nope").MILKSU_TRACE_ID, undefined);
});
