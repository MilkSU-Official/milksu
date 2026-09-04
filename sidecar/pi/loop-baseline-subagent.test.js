import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { projectToolModelUsage } from "./bridge-usage-view.js";
import {
  projectSubagentToolResult,
  readSubagentYieldField,
} from "./bridge-subagent-yield.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("baseline: upstream SingleResult still has no files[]; MilkSU yield now supplies them", async () => {
  try {
    const source = await readFile(
      join(root, "node_modules/pi-sub-agent/extensions/index.ts"),
      "utf8",
    );
    assert.match(source, /interface SingleResult/);
    assert.match(source, /exitCode: number/);
    assert.match(source, /messages: RawMessage\[\]/);
    assert.equal(source.includes("files[]"), false);
    assert.equal(/findings\s*:/.test(source), false);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const wrapped = projectSubagentToolResult({
    toolName: "subagent",
    details: {
      results: [{
        model: "grok-4.6",
        exitCode: 0,
        files: ["a.ts"],
        findings: [{ path: "a.ts", note: "renamed" }],
        cwd: ".",
      }],
    },
    input: { agent: "worker" },
  });
  assert.equal(readSubagentYieldField(wrapped, "files[0]"), "a.ts");
  assert.ok(Array.isArray(wrapped.details.yield.findings));
});

test("baseline: usage projection stays credential-free; yield slice adds files[] on tool_result", () => {
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

  const wrapped = projectSubagentToolResult({
    toolName: "subagent",
    details: {
      results: [{
        model: "grok-4.6",
        exitCode: 0,
        files: ["a.ts"],
        findings: [],
        cwd: ".",
      }],
    },
  });
  assert.deepEqual(wrapped.details.yield.files, ["a.ts"]);
});
