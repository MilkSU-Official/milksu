import assert from "node:assert/strict";
import test from "node:test";
import {
  computerUseMcpServerName,
  computerUseMcpToolName,
  isComputerUseMcpToolName,
} from "./bridge-computer-use-routing.js";

test("recognizes raw and adapter-prefixed Computer Use MCP tool names", () => {
  assert.equal(computerUseMcpServerName, "milksu-computer-use");
  assert.equal(computerUseMcpToolName, "milksu_computer_use_computer_use");
  assert.equal(isComputerUseMcpToolName("computer_use"), true);
  assert.equal(isComputerUseMcpToolName("milksu_computer_use_computer_use"), true);
  assert.equal(isComputerUseMcpToolName("milksu-computer-use-computer-use"), true);
  assert.equal(isComputerUseMcpToolName("browser_click"), false);
});
