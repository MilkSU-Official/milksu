import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { contextUsageWindowPayload, resolveMaxOutput } from "./context-window-payload.js";

const require = createRequire(import.meta.url);
const { knownMaxTokens } = require("./known-context-window.cjs");

// 官方模型表把 deepseek 系列的最大输出定为 393216，可用输入 = 窗口 − 最大输出。
test("deepseek-flash：先查表 ⇒ 393216（窗口 1,000,000 ⇒ 可用 606784）", () => {
  const maxOutput = resolveMaxOutput({ modelIds: ["deepseek-flash"], lookupMaxTokens: knownMaxTokens });
  assert.equal(maxOutput, 393_216);
  assert.deepEqual(contextUsageWindowPayload(1_000_000, maxOutput), { maxOutput: 393_216, usableWindow: 606_784 });
});

test("deepseek-flash：窗口 1,048,576 ⇒ 可用 655360", () => {
  const maxOutput = resolveMaxOutput({ modelIds: ["deepseek-v4-flash"], lookupMaxTokens: knownMaxTokens });
  assert.deepEqual(contextUsageWindowPayload(1_048_576, maxOutput), { maxOutput: 393_216, usableWindow: 655_360 });
});

test("表查不到 + 会话有值 ⇒ 用会话值", () => {
  const maxOutput = resolveMaxOutput({ modelIds: ["no-such-model"], sessionMaxTokens: 8_192, lookupMaxTokens: knownMaxTokens });
  assert.equal(maxOutput, 8_192);
});

test("两者都没有 ⇒ 不带字段（{}）", () => {
  assert.equal(resolveMaxOutput({ modelIds: [""], lookupMaxTokens: knownMaxTokens }), undefined);
  assert.deepEqual(contextUsageWindowPayload(1_000_000, undefined), {});
});

test("未知模型绝不出 16384（不许用 registeredMaxTokens 的默认值兜底）", () => {
  const maxOutput = resolveMaxOutput({ modelIds: ["unknown-model"], lookupMaxTokens: knownMaxTokens });
  assert.notEqual(maxOutput, 16_384);
  assert.equal(maxOutput, undefined);
});

test("session.model 为空时，靠后面的兜底来源仍算得出（读者机器上的真实情形）", () => {
  // milksu-route session: session.model?.id/modelId/name 都是空的，只有
  // sessionModelSources 里的 "deepseek/deepseek-flash"。
  const maxOutput = resolveMaxOutput({
    modelIds: [undefined, undefined, undefined, "deepseek/deepseek-flash"],
    lookupMaxTokens: knownMaxTokens,
  });
  assert.equal(maxOutput, 393_216);
  assert.deepEqual(contextUsageWindowPayload(1_000_000, maxOutput), { maxOutput: 393_216, usableWindow: 606_784 });
});

test("全部来源都空 ⇒ 仍然什么都不说（不编数）", () => {
  const maxOutput = resolveMaxOutput({
    modelIds: [undefined, undefined, undefined, undefined],
    lookupMaxTokens: knownMaxTokens,
  });
  assert.equal(maxOutput, undefined);
  assert.deepEqual(contextUsageWindowPayload(1_000_000, maxOutput), {});
});
