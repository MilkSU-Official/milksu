import assert from "node:assert/strict";
import test from "node:test";
import {
  computerUseGuidance,
  computerUseToolName,
  createComputerUseToolExtension,
} from "./bridge-computer-use-tool.js";

test("computer_use stays available and asks for a lock before operate", async () => {
  assert.equal(computerUseToolName, "computer_use");
  assert.match(computerUseGuidance(), /list_computer_use_windows/);
  assert.match(computerUseGuidance(), /milksu_ask/);
  assert.match(computerUseGuidance(), /Do not ask the user to pick a window first/);

  const tools = [];
  createComputerUseToolExtension(() => ({
    executionMode: "go",
    approvalPolicy: "workspace-auto",
  }))({
    registerTool(tool) {
      tools.push(tool);
    },
  });
  await assert.rejects(
    () => tools[0].execute("call-1", { action: "observe" }),
    /No window is locked/,
  );
});

test("computer_use is blocked in plan mode", async () => {
  const tools = [];
  createComputerUseToolExtension(() => ({
    executionMode: "plan",
    approvalPolicy: "workspace-auto",
  }))({
    registerTool(tool) {
      tools.push(tool);
    },
  });
  await assert.rejects(
    () => tools[0].execute("call-1", { action: "observe" }),
    /只读|Plan/,
  );
});
