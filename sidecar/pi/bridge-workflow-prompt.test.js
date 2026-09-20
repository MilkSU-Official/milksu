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
  assert.match(prompt, /运行时上下文/);
  assert.match(prompt, /工作区身份/);
  assert.match(prompt, /可证伪的 CTF 假设/);
  assert.match(prompt, /思考、过程旁白、进度、答复/);
  assert.match(prompt, /引用：/);
  assert.doesNotMatch(prompt, /at most four subagent tasks/);
  assert.doesNotMatch(prompt, /When the user asks to open a subagent/);
  assert.doesNotMatch(prompt, /built-in isolated browser/);
  assert.doesNotMatch(prompt, /milksu_progress/);
  assert.doesNotMatch(prompt, /milksu_ask/);
  assert.doesNotMatch(prompt, /MUST call/);
  assert.doesNotMatch(prompt, /50KB or 2000 lines/);
  assert.doesNotMatch(prompt, /list_records/);
  assert.doesNotMatch(prompt, /Do not scan the user message/);
});

test("English UI locale keeps the MilkSU suffix in English", () => {
  const prompt = composeMilkSUWorkflowSystemPrompt("base", {
    sessionRole: "solver",
    policy: { workspace: "/workspace", uiLocale: "en" },
  });
  assert.match(prompt, /Runtime context:/);
  assert.match(prompt, /Workspace identity:/);
  assert.match(prompt, /falsifiable CTF hypothesis/);
  assert.match(prompt, /Quoted reference:/);
  assert.match(prompt, /thinking, progress asides, answers/);
  assert.doesNotMatch(prompt, /运行时上下文|工作区身份|引用：/);
});

test("workflow prompt skips optional surfaces that are off", () => {
  const prompt = composeMilkSUWorkflowSystemPrompt("base", {
    sessionRole: "",
    policy: { activeTools: [] },
  });
  assert.equal(roleGuidanceForSession(""), "");
  assert.match(prompt, /^base\n\n运行时上下文:/);
  assert.doesNotMatch(prompt, /subagent/);
  assert.doesNotMatch(prompt, /isolated browser/);
});
