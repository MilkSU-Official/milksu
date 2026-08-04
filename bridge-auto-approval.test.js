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

test("Request Approval asks per operation while Full Access runs routine selected capabilities", () => {
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
    true,
  );
});

test("selected Computer Use operations do not create meaningless approvals outside Ask", () => {
  for (const toolCall of [
    { server: "milksu-computer-use", tool: "computer_use", args: { action: "observe" } },
    { server: "milksu-computer-use", tool: "milksu_computer_use_computer_use", args: { action: "observe" } },
    { server: "milksu-computer-use", tool: "computer_use", args: { action: "click", elementId: "button-1" } },
    { server: "milksu-computer-use", tool: "computer_use", args: { action: "type", text: "continue" } },
  ]) {
    assert.equal(
      codingMcpOperationRequiresApproval(toolCall, "workspace-auto", "milksu-computer-use"),
      false,
    );
    assert.equal(
      codingMcpOperationRequiresApproval(toolCall, "full-auto", "milksu-computer-use"),
      false,
    );
    assert.equal(
      codingMcpOperationRequiresApproval(toolCall, "ask", "milksu-computer-use"),
      true,
    );
    assert.equal(
      codingMcpOperationRequiresApproval(toolCall, "read-only", "milksu-computer-use"),
      true,
    );
  }
});

test("every permission tier confirms hosted publication without blocking routine Full Access MCP", () => {
  for (const approvalPolicy of ["ask", "workspace-auto", "full-auto"]) {
    for (const tool of [
      "create_pull_request",
      "github_publish_draft_pull_request",
      "githubCreatePullRequest",
      "merge_merge_request",
      "publish_release",
    ]) {
      assert.equal(
        codingMcpOperationRequiresApproval(
          { server: "github", tool, args: {} },
          approvalPolicy,
          "github",
        ),
        true,
      );
    }
  }
  assert.equal(
    codingMcpOperationRequiresApproval(
      { server: "project-tools", tool: "update_local_fixture", args: {} },
      "full-auto",
      "project-tools",
    ),
    false,
  );
});

test("Full Access still confirms hosted account writes while allowing hosted reads", () => {
  for (const [server, tool] of [
    ["github", "create_issue"],
    ["github", "comment_pull_request"],
    ["linear", "update_issue"],
    ["jira", "transition_issue"],
    ["slack", "send_message"],
  ]) {
    assert.equal(
      codingMcpOperationRequiresApproval(
        { server, tool, args: {} },
        "full-auto",
        server,
      ),
      true,
    );
  }

  for (const [server, tool] of [
    ["github", "get_issue"],
    ["linear", "list_issues"],
    ["jira", "search_issues"],
  ]) {
    assert.equal(
      codingMcpOperationRequiresApproval(
        { server, tool, args: {} },
        "full-auto",
        server,
      ),
      false,
    );
  }

  assert.equal(
    codingMcpOperationRequiresApproval(
      { server: "project-tools", tool: "update_local_fixture", args: {} },
      "full-auto",
      "project-tools",
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
