import assert from "node:assert/strict";
import test from "node:test";
import {
  computerUseMcpToolName,
  computerUseRoutingGuidance,
  isComputerUseMcpToolName,
} from "./bridge-computer-use-routing.js";

test("blocks shell and private protocol workarounds when Computer Use is unavailable", () => {
  const guidance = computerUseRoutingGuidance({
    executionMode: "go",
    approvalPolicy: "full-auto",
  });

  assert.match(guidance, /Computer Use is not active/);
  assert.match(guidance, /prepare_computer_use_driver/);
  assert.match(guidance, /do not run Cua's public installer/);
  assert.match(guidance, /stop and tell the user/);
  assert.match(guidance, /Do not use bash/);
  assert.match(guidance, /screenshot directories/);
  assert.match(guidance, /SQLite state/);
  assert.match(guidance, /Electron IPC/);
  assert.match(guidance, /even in Full Access/);
});

test("describes the immutable selected app/window when Computer Use is active", () => {
  const guidance = computerUseRoutingGuidance({
    computerUse: {
      targetName: "Codex",
      targetBundleId: "com.openai.codex",
      targetPid: 4242,
      targetWindowId: 9001,
    },
  });

  assert.match(guidance, /Computer Use is active/);
  assert.match(guidance, /com\.openai\.codex/);
  assert.match(guidance, /PID 4242/);
  assert.match(guidance, /window 9001/);
  assert.match(guidance, new RegExp(`tool ${computerUseMcpToolName}`));
  assert.match(guidance, /do not switch to another app/);
});

test("recognizes raw and adapter-prefixed Computer Use MCP tool names", () => {
  assert.equal(isComputerUseMcpToolName("computer_use"), true);
  assert.equal(isComputerUseMcpToolName("milksu_computer_use_computer_use"), true);
  assert.equal(isComputerUseMcpToolName("milksu-computer-use-computer-use"), true);
  assert.equal(isComputerUseMcpToolName("browser_click"), false);
});
