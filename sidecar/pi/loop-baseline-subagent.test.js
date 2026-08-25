import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { projectToolModelUsage } from "./bridge-usage-view.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("baseline: pi-sub-agent details have no files[] or findings[] schema", async () => {
  const source = await readFile(
    join(root, "node_modules/pi-sub-agent/extensions/index.ts"),
    "utf8",
  );
  assert.match(source, /interface SingleResult/);
  assert.match(source, /exitCode: number/);
  assert.match(source, /messages: RawMessage\[\]/);
  assert.equal(source.includes("files[]"), false);
  assert.equal(/findings\s*:/.test(source), false);
});

test("baseline: MilkSU usage projection only reads exitCode and model from results", () => {
  const records = projectToolModelUsage({
    details: {
      results: [{
        model: "grok-4.6",
        exitCode: 0,
        usage: { inputTokens: 10, outputTokens: 4, cacheReadTokens: 0, cacheWriteTokens: 0 },
      }],
    },
  }, { toolName: "subagent", conversationId: "c1", toolCallId: "t1" });
  assert.equal(records.length, 1);
  assert.equal(records[0].success, true);
  assert.equal(records[0].files, undefined);
});
