import assert from "node:assert/strict";
import test from "node:test";
import {
  computerUseDriverGuidance,
  computerUseDriverToolName,
  createComputerUseDriverExtension,
} from "./bridge-computer-use-driver.js";

test("driver prepare guidance forbids the official installer", () => {
  const guidance = computerUseDriverGuidance();
  assert.equal(computerUseDriverToolName, "prepare_computer_use_driver");
  assert.match(guidance, /prepare_computer_use_driver/);
  assert.match(guidance, /Do not run Cua's public installer/);
  assert.match(guidance, /install\.ps1/);
});

test("prepare is blocked in plan or read-only", async () => {
  const requests = [];
  const extension = createComputerUseDriverExtension(
    "conversation-driver",
    () => ({ executionMode: "plan", approvalPolicy: "workspace-auto" }),
    request => {
      requests.push(request);
      return Promise.resolve("{}");
    },
  );
  const tools = [];
  extension({
    registerTool(tool) {
      tools.push(tool);
    },
  });
  await assert.rejects(
    () => tools[0].execute("call-1", { action: "prepare" }),
    /Plan 或只读/,
  );
  assert.equal(requests.length, 0);
});

test("status uses the host action bus", async () => {
  const requests = [];
  const extension = createComputerUseDriverExtension(
    "conversation-driver",
    () => ({ executionMode: "go", approvalPolicy: "workspace-auto" }),
    request => {
      requests.push(request);
      return Promise.resolve(JSON.stringify({ ready: false }));
    },
  );
  const tools = [];
  extension({
    registerTool(tool) {
      tools.push(tool);
    },
  });
  const result = await tools[0].execute("call-1", { action: "status" });
  assert.equal(requests[0].action, "computer_use_driver_status");
  assert.match(result.content[0].text, /ready/);
});
