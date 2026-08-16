import assert from "node:assert/strict";
import test from "node:test";
import {
  codingTurnContractBlocksTool,
  codingTurnContractContext,
  codingTurnContractGuidance,
  codingTurnContractMessageType,
  filterCodingTurnContractMessages,
  normalizeCodingTurnContract,
  withCodingTurnContract,
} from "./bridge-turn-contract.js";

test("accepts only a typed tool-free product policy", () => {
  assert.deepEqual(normalizeCodingTurnContract({
    toolAccess: "none",
    reason: "text_projection",
  }), {
    toolAccess: "none",
    reason: "text_projection",
  });
  assert.deepEqual(normalizeCodingTurnContract({ toolAccess: "none" }), {
    toolAccess: "none",
    reason: "typed_product_request",
  });
  for (const value of [
    undefined,
    "不要运行工具，只回答。",
    { toolAccess: "read-only" },
    { toolAccess: "none", reason: "explicit_no_tools" },
  ]) {
    if (typeof value === "object" && value?.toolAccess === "none") continue;
    assert.equal(normalizeCodingTurnContract(value), undefined);
  }
});

test("ordinary natural-language instructions are never parsed as turn policy", () => {
  for (const prompt of [
    "不要运行工具，只回答。",
    "Do not use tools. Reply with two lines.",
    "不要修改文件，先读取代码并解释。",
    "解释用户说的‘不要运行工具’是什么意思。",
  ]) {
    assert.equal(normalizeCodingTurnContract(prompt), undefined);
  }
});

test("keeps only the current hidden typed policy in model context", () => {
  const ordinary = { role: "user", content: "current request" };
  const oldContract = {
    role: "custom",
    customType: codingTurnContractMessageType,
    content: "old contract",
  };
  const currentContract = {
    role: "custom",
    customType: codingTurnContractMessageType,
    content: "current contract",
  };
  const messages = [oldContract, ordinary, currentContract];

  assert.deepEqual(filterCodingTurnContractMessages(messages, undefined), [ordinary]);
  assert.deepEqual(filterCodingTurnContractMessages(messages, { toolAccess: "none" }), [
    ordinary,
    currentContract,
  ]);
  assert.match(codingTurnContractContext({ toolAccess: "none" }), /typed turn policy/);
  assert.doesNotMatch(codingTurnContractContext({ toolAccess: "none" }), /未核验/);
  assert.equal(codingTurnContractContext(undefined), "");
});

test("removes tools for one typed turn and restores them", async () => {
  const contracts = new Map();
  let activeTools = ["read", "bash", "goal_complete"];
  const events = [];
  const contract = normalizeCodingTurnContract({
    toolAccess: "none",
    reason: "text_projection",
  });
  const result = await withCodingTurnContract({
    contracts,
    conversationId: "conversation-1",
    contract,
    getActiveTools: () => activeTools,
    setActiveTools: tools => {
      activeTools = [...tools];
    },
    onApplied: tools => events.push(["applied", tools]),
    onRestored: tools => events.push(["restored", tools]),
  }, async () => {
    assert.deepEqual(activeTools, []);
    assert.equal(codingTurnContractBlocksTool(contracts.get("conversation-1")), true);
    assert.match(codingTurnContractGuidance(contract), /tool-free/);
    return "direct answer";
  });

  assert.equal(result, "direct answer");
  assert.deepEqual(activeTools, ["read", "bash", "goal_complete"]);
  assert.equal(contracts.has("conversation-1"), false);
  assert.deepEqual(events, [
    ["applied", []],
    ["restored", ["read", "bash", "goal_complete"]],
  ]);
});

test("restores the reviewed tool set when the typed turn fails", async () => {
  const contracts = new Map();
  let activeTools = ["read", "grep"];
  await assert.rejects(withCodingTurnContract({
    contracts,
    conversationId: "conversation-2",
    contract: { toolAccess: "none", reason: "text_projection" },
    getActiveTools: () => activeTools,
    setActiveTools: tools => {
      activeTools = [...tools];
    },
  }, async () => {
    throw new Error("provider unavailable");
  }), /provider unavailable/);
  assert.deepEqual(activeTools, ["read", "grep"]);
  assert.equal(contracts.has("conversation-2"), false);
});
