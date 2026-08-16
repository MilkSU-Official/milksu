import assert from "node:assert/strict";
import test from "node:test";

import {
  codingCollaborationRequiresApproval,
  codingMcpOperationRequiresApproval,
} from "./bridge-auto-approval.js";

test("Project Auto approves only reviewed local capability servers", () => {
  assert.equal(codingCollaborationRequiresApproval("workspace-auto"), false);
  for (const input of [
    { connect: "milksu-playwright" },
    { server: "milksu-playwright", tool: "browser_snapshot", args: {} },
    { server: "milksu-playwright", tool: "browser_click", args: {} },
    { server: "milksu-computer-use", tool: "computer_use", args: { action: "click" } },
  ]) {
    assert.equal(
      codingMcpOperationRequiresApproval(
        input,
        "workspace-auto",
        String(input.server ?? input.connect ?? ""),
      ),
      false,
    );
  }

  assert.equal(
    codingMcpOperationRequiresApproval(
      { server: "project-tools", tool: "read_resource", args: {} },
      "workspace-auto",
      "project-tools",
    ),
    true,
  );
});

test("tool-name wording never changes the approval result", () => {
  for (const tool of [
    "read_resource",
    "create_pull_request",
    "harmlessLookingName",
    "delete_everything",
  ]) {
    assert.equal(
      codingMcpOperationRequiresApproval(
        { server: "github", tool, args: {} },
        "full-auto",
        "github",
      ),
      true,
    );
    assert.equal(
      codingMcpOperationRequiresApproval(
        { server: "project-tools", tool, args: {} },
        "full-auto",
        "project-tools",
      ),
      false,
    );
  }
});

test("external authentication remains explicit in every permission tier", () => {
  for (const policy of ["read-only", "ask", "workspace-auto", "full-auto"]) {
    for (const action of ["auth-start", "auth-complete"]) {
      assert.equal(
        codingMcpOperationRequiresApproval({ server: "github", action }, policy, "github"),
        true,
      );
    }
  }
});

test("Request Approval asks per operation while Full Access runs local MCP tools", () => {
  const operation = {
    server: "milksu-playwright",
    tool: "browser_type",
    args: { text: "MilkSU" },
  };
  assert.equal(codingCollaborationRequiresApproval("ask"), true);
  assert.equal(codingMcpOperationRequiresApproval(operation, "ask"), true);
  assert.equal(codingCollaborationRequiresApproval("full-auto"), false);
  assert.equal(codingMcpOperationRequiresApproval(operation, "full-auto"), false);
});

test("unknown policies fail closed and non-operations do not prompt", () => {
  const operation = { server: "fixture", tool: "mutate" };
  assert.equal(codingCollaborationRequiresApproval("read-only"), false);
  assert.equal(codingMcpOperationRequiresApproval(operation, "read-only"), true);
  assert.equal(codingMcpOperationRequiresApproval(operation, "unknown"), true);
  assert.equal(codingMcpOperationRequiresApproval({}, "workspace-auto"), false);
});
