import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { estimateTokens, formatSkillsForPrompt } from "@earendil-works/pi-coding-agent";
import {
  classifyToolCategory,
  composeContextUsage,
  estimateTextTokens,
  projectSessionContextComposition,
} from "./bridge-context-composition.js";

const secretPrompt = "SECRET_PROMPT_BODY_DO_NOT_EMIT";
const secretKey = "sk-secret-context-key-do-not-emit";
const secretPath = "/Users/secret/project/SKILL.md";
const secretToolArg = "rm -rf /secret-tool-arg";

function assertNoLeak(value) {
  const serialized = JSON.stringify(value);
  assert.equal(serialized.includes(secretPrompt), false);
  assert.equal(serialized.includes(secretKey), false);
  assert.equal(serialized.includes(secretPath), false);
  assert.equal(serialized.includes(secretToolArg), false);
  assert.equal(serialized.includes("name"), false);
  assert.equal(serialized.includes("description"), false);
}

function tool(name, extra = {}) {
  return {
    name,
    description: extra.description ?? `${name} description ${secretPrompt}`,
    parameters: extra.parameters ?? { type: "object" },
    promptGuidelines: extra.promptGuidelines ?? [`never print ${secretKey}`],
    sourceInfo: extra.sourceInfo ?? { path: secretPath },
  };
}

test("estimateTextTokens uses Pi chars/4", () => {
  assert.equal(estimateTextTokens(""), 0);
  assert.equal(estimateTextTokens("abcd"), 1);
  assert.equal(estimateTextTokens("abcde"), 2);
  assert.equal(estimateTextTokens("Hi"), 1);
});

test("classifyToolCategory splits builtin, mcp/dynamic, and subagent", () => {
  assert.equal(classifyToolCategory("read"), "tools");
  assert.equal(classifyToolCategory("bash"), "tools");
  assert.equal(classifyToolCategory("edit"), "tools");
  assert.equal(classifyToolCategory("write"), "tools");
  assert.equal(classifyToolCategory("grep"), "tools");
  assert.equal(classifyToolCategory("find"), "tools");
  assert.equal(classifyToolCategory("ls"), "tools");
  assert.equal(classifyToolCategory("subagent"), "subagent");
  assert.equal(classifyToolCategory("milksu_workspace"), "mcp");
  assert.equal(classifyToolCategory("milksu_ask"), "mcp");
  assert.equal(classifyToolCategory("milksu_progress"), "mcp");
  assert.equal(classifyToolCategory("env_status"), "mcp");
  assert.equal(classifyToolCategory("capa_analyze"), "mcp");
  assert.equal(classifyToolCategory("prepare_computer_use_driver"), "mcp");
  assert.equal(classifyToolCategory("github__search"), "mcp");
});

test("short system prompt is a system category only", () => {
  const result = composeContextUsage({
    systemPrompt: "Hi",
    tools: [],
    activeToolNames: [],
    skills: [],
    messages: [],
    contextWindow: 200000,
  });
  assert.deepEqual(result, {
    estimatedTokens: 1,
    contextWindow: 200000,
    categories: [{ id: "system", tokens: 1 }],
  });
});

test("counts only active builtin, mcp, and subagent tool definitions", () => {
  const tools = [
    tool("read"),
    tool("bash"),
    tool("milksu_workspace"),
    tool("github__search"),
    tool("subagent"),
  ];
  const result = composeContextUsage({
    systemPrompt: "",
    tools,
    activeToolNames: ["read", "milksu_workspace", "subagent"],
    skills: [],
    messages: [],
    contextWindow: 128000,
  });
  const readTokens = estimateTextTokens(JSON.stringify({
    name: "read",
    description: tools[0].description,
    parameters: tools[0].parameters,
    promptGuidelines: tools[0].promptGuidelines,
  }));
  const workspaceTokens = estimateTextTokens(JSON.stringify({
    name: "milksu_workspace",
    description: tools[2].description,
    parameters: tools[2].parameters,
    promptGuidelines: tools[2].promptGuidelines,
  }));
  const subagentTokens = estimateTextTokens(JSON.stringify({
    name: "subagent",
    description: tools[4].description,
    parameters: tools[4].parameters,
    promptGuidelines: tools[4].promptGuidelines,
  }));
  assert.deepEqual(result.categories.map(category => category.id), [
    "tools",
    "mcp",
    "subagent",
  ]);
  assert.equal(result.categories.find(category => category.id === "tools").tokens, readTokens);
  assert.equal(result.categories.find(category => category.id === "mcp").tokens, workspaceTokens);
  assert.equal(
    result.categories.find(category => category.id === "subagent").tokens,
    subagentTokens,
  );
  assert.equal(result.estimatedTokens, readTokens + workspaceTokens + subagentTokens);
  assertNoLeak(result);
});

test("subtracts skills text already embedded in the system prompt", () => {
  const skills = [{
    name: "demo-skill",
    description: "A reviewed skill",
    filePath: secretPath,
    disableModelInvocation: false,
  }];
  const skillsText = formatSkillsForPrompt(skills);
  const prefix = "You are MilkSU.";
  const result = composeContextUsage({
    systemPrompt: `${prefix}${skillsText}`,
    tools: [],
    activeToolNames: [],
    skills,
    messages: [],
    contextWindow: 1000,
  });
  const skillTokens = estimateTextTokens(skillsText);
  const systemTokens = Math.max(
    0,
    estimateTextTokens(`${prefix}${skillsText}`) - skillTokens,
  );
  assert.deepEqual(result.categories, [
    { id: "system", tokens: systemTokens },
    { id: "skills", tokens: skillTokens },
  ]);
  assert.equal(result.estimatedTokens, systemTokens + skillTokens);
  assertNoLeak(result);
});

test("does not subtract skills when they are not in the system prompt", () => {
  const skillsText = "available skills list";
  const result = composeContextUsage({
    systemPrompt: "You are MilkSU.",
    tools: [],
    activeToolNames: [],
    skills: skillsText,
    messages: [],
  });
  assert.equal(
    result.categories.find(category => category.id === "system").tokens,
    estimateTextTokens("You are MilkSU."),
  );
  assert.equal(
    result.categories.find(category => category.id === "skills").tokens,
    estimateTextTokens(skillsText),
  );
});

test("conversation uses Pi estimateTokens per message", () => {
  const messages = [
    { role: "user", content: "hello there" },
    {
      role: "assistant",
      content: [
        { type: "text", text: "ok" },
        { type: "toolCall", name: "bash", arguments: { command: secretToolArg } },
      ],
    },
  ];
  const result = composeContextUsage({
    systemPrompt: "",
    tools: [],
    activeToolNames: [],
    messages,
    contextWindow: 8000,
  });
  const expected = estimateTokens(messages[0]) + estimateTokens(messages[1]);
  assert.deepEqual(result.categories, [{ id: "conversation", tokens: expected }]);
  assert.equal(result.estimatedTokens, expected);
  assertNoLeak(result);
});

test("scales categories to billed prompt tokens when present", () => {
  const result = composeContextUsage({
    systemPrompt: "abcd",
    tools: [],
    activeToolNames: [],
    skills: "abcdefgh",
    messages: [{ role: "user", content: "abcd" }],
    billedPromptTokens: 10,
    contextWindow: 100,
  });
  const rawSystem = estimateTextTokens("abcd");
  const rawSkills = estimateTextTokens("abcdefgh");
  const rawConversation = estimateTokens({ role: "user", content: "abcd" });
  const rawSum = rawSystem + rawSkills + rawConversation;
  assert.equal(result.estimatedTokens, 10);
  assert.equal(
    result.categories.reduce((sum, category) => sum + category.tokens, 0),
    10,
  );
  assert.deepEqual(result.categories.map(category => category.id), [
    "system",
    "skills",
    "conversation",
  ]);
  const systemShare = result.categories.find(category => category.id === "system").tokens;
  assert.ok(Math.abs(systemShare - Math.round((rawSystem / rawSum) * 10)) <= 1);
});

test("without billed tokens keeps the raw chars/4 sum", () => {
  const result = composeContextUsage({
    systemPrompt: "abcd",
    tools: [],
    activeToolNames: [],
    messages: [],
    contextWindow: 50,
  });
  assert.equal(result.estimatedTokens, 1);
  assert.deepEqual(result.categories, [{ id: "system", tokens: 1 }]);
});

test("omits empty categories and does not invent billed slices", () => {
  const empty = composeContextUsage({
    systemPrompt: "",
    tools: [tool("read")],
    activeToolNames: [],
    skills: [],
    messages: [],
    contextWindow: 128000,
  });
  assert.deepEqual(empty, {
    estimatedTokens: 0,
    contextWindow: 128000,
    categories: [],
  });

  const billedOnly = composeContextUsage({
    systemPrompt: "",
    tools: [],
    activeToolNames: [],
    messages: [],
    billedPromptTokens: 40,
    contextWindow: 128000,
  });
  assert.deepEqual(billedOnly, {
    estimatedTokens: 40,
    contextWindow: 128000,
    categories: [],
  });
});

test("projection never includes prompt text, keys, paths, or tool arguments", () => {
  const result = composeContextUsage({
    systemPrompt: `${secretPrompt} ${secretKey}`,
    tools: [tool("read"), tool("github__list")],
    activeToolNames: ["read", "github__list"],
    skills: [{
      name: "leaky",
      description: secretPrompt,
      filePath: secretPath,
      disableModelInvocation: false,
    }],
    messages: [{
      role: "user",
      content: `${secretPrompt} at ${secretPath}`,
    }],
    billedPromptTokens: 80,
    contextWindow: 200000,
  });
  assert.equal(Object.keys(result).sort().join(","), "categories,contextWindow,estimatedTokens");
  for (const category of result.categories) {
    assert.equal(Object.keys(category).sort().join(","), "id,tokens");
    assert.equal(typeof category.tokens, "number");
  }
  assertNoLeak(result);
});

test("missing session does not throw", () => {
  assert.equal(projectSessionContextComposition(undefined), undefined);
  assert.equal(projectSessionContextComposition(null), undefined);
  assert.deepEqual(
    projectSessionContextComposition({
      systemPrompt: "Hi",
      getAllTools: () => {
        throw new Error("tools unavailable");
      },
      getActiveToolNames: () => ["read"],
      messages: [],
    }),
    undefined,
  );
});

test("bridge emits context_composition after ready, policy, usage, and compaction", async () => {
  const bridgeSource = await readFile(
    join(dirname(fileURLToPath(import.meta.url)), "bridge.js"),
    "utf8",
  );
  assert.match(bridgeSource, /from "\.\/bridge-context-composition\.js"/);
  assert.match(bridgeSource, /function emitContextComposition\(/);
  assert.match(bridgeSource, /emit\(id, "context_composition", \{ contextComposition: composition \}\)/);
  assert.match(
    bridgeSource,
    /emit\(conversationId, "ready", \{[\s\S]*?\}\);\s*emitContextComposition\(conversationId\);/,
  );
  assert.match(
    bridgeSource,
    /emit\(conversationId, "policy_updated", \{[\s\S]*?\}\);\s*emitContextComposition\(conversationId\);/,
  );
  assert.match(
    bridgeSource,
    /emit\(conversationId, "usage_recorded", \{ usage, module: usageModule \}\);\s*emitContextComposition\(conversationId\);/,
  );
  assert.match(
    bridgeSource,
    /if \(projected\) \{\s*emit\(conversationId, projected\.type, projected\.data\);\s*\}\s*emitContextComposition\(conversationId\);/,
  );
});
