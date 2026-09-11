import assert from "node:assert/strict";
import test from "node:test";

import {
  codingCollaborationRequiresApproval,
  codingMcpOperationRequiresApproval,
  mcpConversationGrantKey,
  resolveCodingMcpServer,
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
  assert.equal(
    codingMcpOperationRequiresApproval(
      { server: "milksu-plugins", tool: "milksu_plugins_list", args: {} },
      "workspace-auto",
      "milksu-plugins",
    ),
    true,
  );
  assert.equal(
    mcpConversationGrantKey(
      { server: "milksu-plugins", tool: "milksu_plugins_list" },
      "milksu-plugins",
    ),
    "",
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

test("isolated browser tools resolve even when the MCP server field is omitted", () => {
  assert.equal(
    resolveCodingMcpServer(
      { tool: "browser_click", args: { element: "Play" } },
      { codingBrowser: { sessionId: "browser_test" }, mcpServers: ["milksu-playwright"] },
    ),
    "milksu-playwright",
  );
  assert.equal(
    codingMcpOperationRequiresApproval(
      { tool: "browser_click", args: { element: "Play" } },
      "workspace-auto",
      resolveCodingMcpServer(
        { tool: "browser_click" },
        { codingBrowser: { sessionId: "browser_test" }, mcpServers: ["milksu-playwright"] },
      ),
    ),
    false,
  );
  assert.equal(
    mcpConversationGrantKey({ tool: "browser_navigate" }, "milksu-playwright"),
    "mcp:milksu-playwright",
  );
  assert.equal(
    mcpConversationGrantKey({ server: "github", action: "auth-start" }, "github"),
    "",
  );
});

test("unknown policies fail closed and non-operations do not prompt", () => {
  const operation = { server: "fixture", tool: "mutate" };
  assert.equal(codingCollaborationRequiresApproval("read-only"), false);
  assert.equal(codingMcpOperationRequiresApproval(operation, "read-only"), true);
  assert.equal(codingMcpOperationRequiresApproval(operation, "unknown"), true);
  assert.equal(codingMcpOperationRequiresApproval({}, "workspace-auto"), false);
});
