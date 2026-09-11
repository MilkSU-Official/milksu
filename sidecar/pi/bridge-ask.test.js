import assert from "node:assert/strict";
import test from "node:test";
import {
  askOtherChoiceId,
  codingAskToolName,
  encodeAskOtherChoice,
  formatAskSelection,
  formatAskToolInput,
  normalizeAskOptions,
  resolveAskChoice,
} from "./bridge-ask.js";

test("normalizes 2-6 short choice options with stable ids", () => {
  assert.equal(codingAskToolName, "milksu_ask");
  const options = normalizeAskOptions([
    { label: "Three (core line)", detail: "Keep the line small" },
    { id: "Five!", label: "Five (full case)" },
    "Just one hero",
    { label: "   " },
  ]);
  assert.deepEqual(options, [
    { id: "option-1", label: "Three (core line)", detail: "Keep the line small" },
    { id: "five", label: "Five (full case)" },
    { id: "option-3", label: "Just one hero" },
  ]);
  assert.match(
    formatAskToolInput("How many flavors should we launch?", options),
    /How many flavors/,
  );
});

test("rejects a single option", () => {
  assert.equal(normalizeAskOptions([{ label: "Only one" }]).length, 1);
  assert.equal(normalizeAskOptions([]).length, 0);
});

test("reserves other for freeform answers", () => {
  const options = normalizeAskOptions([
    { id: "other", label: "Keep the current plan" },
    { id: "rewrite", label: "Rewrite it" },
  ]);
  assert.deepEqual(options.map(item => item.id), ["option-1", "rewrite"]);
  assert.deepEqual(
    resolveAskChoice(options, encodeAskOtherChoice("按任务交接"), true),
    { id: askOtherChoiceId, label: "按任务交接" },
  );
  assert.match(formatAskSelection({ id: askOtherChoiceId, label: "按任务交接" }), /entered/);
  assert.match(formatAskSelection({ id: "rewrite", label: "Rewrite it" }), /selected/);
});
