import assert from "node:assert/strict";
import test from "node:test";
import { dshPermissionResult } from "./permission.js";

test("DSH allow maps to ACP allow-once, never allow-always", () => {
  assert.deepEqual(dshPermissionResult(true), {
    outcome: { outcome: "selected", optionId: "allow-once" },
  });
});

test("DSH deny is ACP cancelled without optionId", () => {
  assert.deepEqual(dshPermissionResult(false), {
    outcome: { outcome: "cancelled" },
  });
  assert.equal("optionId" in dshPermissionResult(false).outcome, false);
});
