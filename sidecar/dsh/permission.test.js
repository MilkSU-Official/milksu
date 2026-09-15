import assert from "node:assert/strict";
import test from "node:test";
import {
  dshPermissionResult,
  dshPresetForApprovalPolicy,
  dshShouldAutoAllowPermission,
} from "./permission.js";

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

test("workspace-auto only auto-allows isolated browser and Computer Use", () => {
  assert.equal(
    dshShouldAutoAllowPermission("workspace-auto", { title: "mcp__playwright-mcp__browser_navigate" }),
    true,
  );
  assert.equal(
    dshShouldAutoAllowPermission("workspace-auto", { title: "bash", kind: "execute" }),
    false,
  );
  assert.equal(
    dshShouldAutoAllowPermission("ask", { title: "mcp__playwright-mcp__browser_click" }),
    false,
  );
});

test("MilkSU policies map onto DSH workspace-write, never official auto", () => {
  assert.equal(dshPresetForApprovalPolicy("read-only"), "read-only");
  assert.equal(dshPresetForApprovalPolicy("ask"), "workspace-write");
  assert.equal(dshPresetForApprovalPolicy("workspace-auto"), "workspace-write");
  assert.equal(dshPresetForApprovalPolicy("full-auto"), "workspace-write");
});

test("full-auto still blocks destructive and paid or external actions", () => {
  assert.equal(
    dshShouldAutoAllowPermission("full-auto", { title: "write", kind: "edit" }),
    true,
  );
  assert.equal(
    dshShouldAutoAllowPermission("full-auto", { title: "bash", rawInput: { command: "rm -rf /" } }),
    false,
  );
  assert.equal(
    dshShouldAutoAllowPermission("full-auto", { title: "auth-start", server: "github" }),
    false,
  );
});
