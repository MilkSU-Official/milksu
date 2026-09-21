import assert from "node:assert/strict";
import test from "node:test";
import { formatCompanionToolResult } from "./bridge.js";

test("formatCompanionToolResult extracts text blocks", () => {
  assert.equal(
    formatCompanionToolResult({
      content: [
        { type: "text", text: "会话 A" },
        { type: "text", text: "会话 B" },
      ],
    }),
    "会话 A\n会话 B",
  );
});

test("formatCompanionToolResult never returns [object Object]", () => {
  const text = formatCompanionToolResult({
    content: [{ type: "text", text: "ok" }, { type: "image" }],
  });
  assert.equal(text, "ok");
  assert.doesNotMatch(text, /\[object Object\]/);
  assert.equal(formatCompanionToolResult({ content: [{ foo: 1 }, { bar: 2 }] }), "");
});
