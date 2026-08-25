import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES } from "@earendil-works/pi-coding-agent";
import { boundModelText } from "./bridge-tool-result-bound.js";

test("baseline: 2500-line dump keeps the head and drops the tail", () => {
  const lines = Array.from({ length: 2500 }, (_, i) => `line-${i}${i === 2499 ? "-END" : ""}`);
  const bound = boundModelText(lines.join("\n"));
  assert.equal(DEFAULT_MAX_BYTES, 51200);
  assert.equal(DEFAULT_MAX_LINES, 2000);
  assert.equal(bound.truncated, true);
  assert.equal(bound.text.startsWith("line-0"), true);
  assert.equal(bound.text.includes("line-2499-END"), false);
  assert.equal(bound.text.split("\n").length, 2000);
  assert.ok(bound.previewBytes <= DEFAULT_MAX_BYTES);
  assert.equal(bound.totalBytes, Buffer.byteLength(lines.join("\n"), "utf8"));
});
