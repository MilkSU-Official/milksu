import assert from "node:assert/strict";
import test from "node:test";
import {
  codingCollaborationRequiresApproval,
  codingMcpOperationRequiresApproval,
} from "./bridge-auto-approval.js";

test("Project Auto removes routine collaboration and selected MCP approvals", () => {
  assert.equal(codingCollaborationRequiresApproval("workspace-auto"), false);
  for (const input of [
    { connect: "milksu-playwright" },
    { server: "milksu-playwright", tool: "browser_snapshot", args: {} },
    { server: "milksu-playwright", tool: "browser_click", args: { target: "e1" } },
    { server: "milksu-computer-use", tool: "computer_use", args: { action: "observe" } },
    { server: "fixture", tool: "read_resource", args: { id: "fixture" } },
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
      { server: "github", tool: "create_pull_request", args: {} },
      "workspace-auto",
      "github",
    ),
    true,
  );
});

test("Project Auto keeps external account authorization as a meaningful boundary", () => {
  assert.equal(
    codingMcpOperationRequiresApproval(
      { server: "github", action: "auth-start" },
      "workspace-auto",
    ),
    true,
  );
  assert.equal(
    codingMcpOperationRequiresApproval(
      { server: "github", action: "auth-complete" },
      "workspace-auto",
    ),
    true,
  );
});

test("Request Approval asks per operation while Full Access runs selected capabilities", () => {
  const operation = {
    server: "milksu-playwright",
    tool: "browser_type",
    args: { text: "MilkSU" },
  };
  assert.equal(codingCollaborationRequiresApproval("ask"), true);
  assert.equal(codingMcpOperationRequiresApproval(operation, "ask"), true);
  assert.equal(codingCollaborationRequiresApproval("full-auto"), false);
  assert.equal(
    codingMcpOperationRequiresApproval(operation, "full-auto", "milksu-playwright"),
    false,
  );
  assert.equal(
    codingMcpOperationRequiresApproval(
      { server: "github", action: "auth-start" },
      "full-auto",
    ),
    false,
  );
});

test("unknown or read-only policies never silently auto-approve operations", () => {
  const operation = { server: "fixture", tool: "mutate" };
  assert.equal(codingCollaborationRequiresApproval("read-only"), false);
  assert.equal(codingMcpOperationRequiresApproval(operation, "read-only"), true);
  assert.equal(codingMcpOperationRequiresApproval(operation, "unknown"), true);
  assert.equal(codingMcpOperationRequiresApproval({}, "workspace-auto"), false);
});
