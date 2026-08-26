import assert from "node:assert/strict";
import test from "node:test";
import { codingAskToolName, formatAskToolInput, normalizeAskOptions } from "./bridge-ask.js";

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
