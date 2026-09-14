import assert from "node:assert/strict";
import test from "node:test";
import {
  createEnvExtension,
  envActionBlocked,
  envToolNames,
} from "./bridge-env.js";

test("research sessions expose env tools and block mutations in plan", () => {
  assert.deepEqual([...envToolNames], ["env_status", "env_start", "env_reset", "env_stop"]);
  assert.equal(envActionBlocked("env_status", { executionMode: "plan" }), "");
  assert.match(envActionBlocked("env_start", { executionMode: "plan" }), /只读|Plan/);
  assert.equal(envActionBlocked("env_stop", { executionMode: "go", approvalPolicy: "workspace-auto" }), "");
});

test("each env tool states its own lease bound instead of a system prompt catalog", () => {
  const descriptions = new Map();
  createEnvExtension("chat-1", "lab-job", () => ({}), () => "ok")({
    registerTool: tool => descriptions.set(tool.name, tool.description),
  });
  assert.match(descriptions.get("env_status"), /adb -s/);
  assert.match(descriptions.get("env_status"), /MilkSU-Lab/);
  assert.match(descriptions.get("env_start"), /cannot start an unbound package/);
  for (const description of descriptions.values()) {
    assert.doesNotMatch(description, /Do not call docker/);
  }
});

test("env extension registers tools only for lab and CVE sessions", () => {
  const tools = [];
  const lab = createEnvExtension("chat-1", "lab-job", () => ({
    executionMode: "go",
    approvalPolicy: "workspace-auto",
  }), () => "ok");
  lab({ registerTool: tool => tools.push(tool.name) });
  assert.deepEqual(tools, [...envToolNames]);

  const codingTools = [];
  const coding = createEnvExtension("chat-2", "", () => ({}), () => "ok");
  coding({ registerTool: tool => codingTools.push(tool.name) });
  assert.deepEqual(codingTools, []);
});
