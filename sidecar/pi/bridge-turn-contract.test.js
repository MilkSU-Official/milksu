import assert from "node:assert/strict";
import test from "node:test";
import {
  codingTurnContractBlocksTool,
  codingTurnContractContext,
  codingTurnContractFallbackResponse,
  codingTurnContractGuidance,
  codingTurnContractMessageType,
  codingTurnContractRequiresFreshnessGuard,
  enforceCodingTurnContractMessage,
  filterCodingTurnContractMessages,
  parseExplicitCodingTurnContract,
  withCodingTurnContract,
} from "./bridge-turn-contract.js";

test("recognizes explicit Chinese and English no-tools directives", () => {
  for (const prompt of [
    "不要修改文件，也不要运行工具。只用两行回答。",
    "请勿调用任何 Agent 工具，直接回答。",
    "Do not use tools. Reply with two lines.",
    "Don't call any agent tools; answer directly.",
    "Answer without using any tools.",
  ]) {
    assert.deepEqual(parseExplicitCodingTurnContract(prompt), {
      toolAccess: "none",
      reason: "explicit_no_tools",
    });
  }
});

test("does not broaden ordinary read-only or quoted instructions", () => {
  for (const prompt of [
    "不要修改文件，先读取代码并解释。",
    "Do not edit files; inspect the repository.",
    "只回复附件第一行，不要猜测。",
    "Implement the string `Do not use tools` in the help page.",
    "```text\nDo not use tools\n```\nExplain this quoted requirement.",
    "解释用户说的“不要运行工具”是什么意思。",
    'Explain the phrase "do not use tools".',
    "The help text says do not use tools during setup.",
    "[MilkSU product action: Summarize work]\nDo not run commands.",
    "/goal start Build a response that says do not use tools",
  ]) {
    assert.equal(parseExplicitCodingTurnContract(prompt), undefined);
  }
});

test("marks only explicit current-state requests for deterministic freshness fallback", () => {
  const contract = parseExplicitCodingTurnContract(
    "不要修改文件，也不要运行工具。只用两行回答：第一行说明当前实现的纵切；"
      + "第二行说明主 Agent 刚完成的真实验收结果。",
  );
  assert.deepEqual(contract, {
    toolAccess: "none",
    reason: "explicit_no_tools",
    freshness: "unverified",
    responseLineCount: 2,
    responseLanguage: "zh",
  });
  assert.equal(codingTurnContractRequiresFreshnessGuard(contract), true);
  assert.equal(
    codingTurnContractFallbackResponse(contract),
    "第一行：本回合未核验，无法确认。\n第二行：本回合未核验，无法确认。",
  );

  for (const prompt of [
    "不要运行工具。解释 TypeScript 的 current 指针。",
    "Do not use tools. Explain the word current.",
    "不要运行工具。请逐行输出从 1 到 200 的数字。",
  ]) {
    assert.equal(
      codingTurnContractRequiresFreshnessGuard(
        parseExplicitCodingTurnContract(prompt),
      ),
      false,
    );
  }
});

test("replaces a guarded final assistant message before persistence", () => {
  const contract = parseExplicitCodingTurnContract(
    "Do not use tools. Reply with two lines: current repository status; "
      + "just completed validation.",
  );
  const original = {
    role: "assistant",
    content: [{ type: "text", text: "stale result" }],
    stopReason: "stop",
    model: "fixture",
  };
  assert.deepEqual(enforceCodingTurnContractMessage(original, contract), {
    ...original,
    content: [
      { type: "text", text: "Line 1: Not verified in this turn; unable to confirm.\n"
        + "Line 2: Not verified in this turn; unable to confirm." },
    ],
  });
  assert.equal(enforceCodingTurnContractMessage({
    ...original,
    stopReason: "error",
  }, contract), undefined);
  assert.equal(enforceCodingTurnContractMessage({
    ...original,
    content: [{ type: "toolCall", name: "read" }],
    stopReason: "toolUse",
  }, contract), undefined);
});

test("keeps only the current hidden turn contract in model context", () => {
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

  assert.deepEqual(filterCodingTurnContractMessages(messages, undefined), [
    ordinary,
  ]);
  assert.deepEqual(filterCodingTurnContractMessages(messages, {
    toolAccess: "none",
  }), [
    ordinary,
    currentContract,
  ]);
  assert.match(
    codingTurnContractContext({ toolAccess: "none" }),
    /本回合未核验，无法确认/,
  );
  assert.match(
    codingTurnContractContext({ toolAccess: "none" }),
    /does not permit repeating an older value/,
  );
  assert.match(
    codingTurnContractContext({ toolAccess: "none" }),
    /第一行：本回合未核验，无法确认。\n第二行：本回合未核验，无法确认。/,
  );
  assert.equal(codingTurnContractContext(undefined), "");
});

test("removes tools for one turn, blocks calls, and restores on success", async () => {
  const contracts = new Map();
  let activeTools = ["read", "bash", "goal_complete"];
  const events = [];
  const contract = parseExplicitCodingTurnContract("不要运行工具，只回答。");
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
    assert.equal(
      codingTurnContractBlocksTool(contracts.get("conversation-1")),
      true,
    );
    assert.match(codingTurnContractGuidance(contract), /explicitly prohibited/);
    assert.match(codingTurnContractGuidance(contract), /stale summary/);
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

test("restores the reviewed tool set when the direct response fails", async () => {
  const contracts = new Map();
  let activeTools = ["read", "grep"];
  await assert.rejects(withCodingTurnContract({
    contracts,
    conversationId: "conversation-2",
    contract: { toolAccess: "none", reason: "explicit_no_tools" },
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

test("clears the turn contract and restores after activation fails", async () => {
  const contracts = new Map();
  let activeTools = ["read"];
  let setCalls = 0;
  let actionCalled = false;
  await assert.rejects(withCodingTurnContract({
    contracts,
    conversationId: "conversation-3",
    contract: { toolAccess: "none", reason: "explicit_no_tools" },
    getActiveTools: () => activeTools,
    setActiveTools: tools => {
      setCalls += 1;
      if (setCalls === 1) throw new Error("tool controller unavailable");
      activeTools = [...tools];
    },
  }, async () => {
    actionCalled = true;
  }), /tool controller unavailable/);
  assert.equal(actionCalled, false);
  assert.deepEqual(activeTools, ["read"]);
  assert.equal(contracts.has("conversation-3"), false);
  assert.equal(setCalls, 2);
});
