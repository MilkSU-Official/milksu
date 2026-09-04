import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES } from "@earendil-works/pi-coding-agent";
import { boundModelText } from "./bridge-tool-result-bound.js";

// loop-tool-result-shape (PR #36) replaced the old truncateHead-only baseline
// (keep head, drop tail). This file now records that the old shape is gone:
// head and tail both stay visible, still within Pi's 2000-line / 50KB bound.

test("baseline: 2500-line dump keeps head and tail within Pi bounds", () => {
  const lines = Array.from({ length: 2500 }, (_, i) => `line-${i}${i === 2499 ? "-END" : ""}`);
  const bound = boundModelText(lines.join("\n"));
  assert.equal(DEFAULT_MAX_BYTES, 51200);
  assert.equal(DEFAULT_MAX_LINES, 2000);
  assert.equal(bound.truncated, true);
  assert.equal(bound.text.includes("line-0"), true);
  assert.equal(bound.text.includes("line-2499-END"), true);
  assert.match(bound.text, /omitted \d+ lines/);
  assert.ok(bound.text.split("\n").length <= DEFAULT_MAX_LINES);
  assert.ok(bound.previewBytes <= DEFAULT_MAX_BYTES);
  assert.equal(bound.totalBytes, Buffer.byteLength(lines.join("\n"), "utf8"));
});
