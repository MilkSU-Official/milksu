import assert from "node:assert/strict";
import test from "node:test";
import {
  composeMilkSUWorkflowSystemPrompt,
  roleGuidanceForSession,
} from "./bridge-workflow-prompt.js";

test("workflow prompt keeps host facts and omits product-tool essays", () => {
  const prompt = composeMilkSUWorkflowSystemPrompt("You are MilkSU.", {
    sessionRole: "solver",
    policy: {
      workspace: "/workspace",
      uiLocale: "zh-CN",
      codingBrowser: true,
      activeTools: ["subagent", "milksu_workspace", "milksu_ask", "milksu_progress"],
    },
  });
  assert.match(prompt, /You are MilkSU/);
  assert.match(prompt, /Runtime context/);
  assert.match(prompt, /Workspace identity/);
  assert.match(prompt, /falsifiable CTF hypothesis/);
  assert.match(prompt, /at most four subagent tasks/);
  assert.doesNotMatch(prompt, /When the user asks to open a subagent/);
  assert.match(prompt, /built-in isolated browser/);
  assert.doesNotMatch(prompt, /milksu_progress/);
  assert.doesNotMatch(prompt, /milksu_ask/);
  assert.doesNotMatch(prompt, /MUST call/);
  assert.doesNotMatch(prompt, /50KB or 2000 lines/);
  assert.doesNotMatch(prompt, /list_records/);
  assert.doesNotMatch(prompt, /Do not scan the user message/);
});

test("workflow prompt skips optional surfaces that are off", () => {
  const prompt = composeMilkSUWorkflowSystemPrompt("base", {
    sessionRole: "",
    policy: { activeTools: [] },
  });
  assert.equal(roleGuidanceForSession(""), "");
  assert.match(prompt, /^base\n\nRuntime context:/);
  assert.doesNotMatch(prompt, /subagent/);
  assert.doesNotMatch(prompt, /isolated browser/);
});
