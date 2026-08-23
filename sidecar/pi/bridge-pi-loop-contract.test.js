import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const bridgeSource = await readFile(
  join(dirname(fileURLToPath(import.meta.url)), "bridge.js"),
  "utf8",
);

test("Pi auto-compaction stays enabled for every session including CTF", () => {
  assert.match(bridgeSource, /setAutoCompactionEnabled\(true\)/);
  assert.doesNotMatch(
    bridgeSource,
    /if \(policy\?\.ctf \|\| !session\) return/,
  );
  assert.doesNotMatch(
    bridgeSource,
    /CTF agent sessions cannot be compacted/,
  );
  assert.doesNotMatch(
    bridgeSource,
    /cannot be compacted from the task UI/,
  );
  assert.match(bridgeSource, /resolveWorkflowSessionRole\(/);
  assert.doesNotMatch(
    bridgeSource,
    /const effectiveSessionRole = policy\.ctf\s*\n\s*\? command\.sessionRole/,
  );
});

test("reused Coding/CTF/CVE/lab sessions re-enable Pi auto-compaction", () => {
  assert.match(
    bridgeSource,
    /existing\.setAutoCompactionEnabled\(true\)/,
  );
  assert.match(
    bridgeSource,
    /event\.result\.estimatedTokensAfter/,
  );
});

test("CTF/CVE/lab sessions keep Coding loop surfaces instead of role-gating them off", () => {
  assert.doesNotMatch(
    bridgeSource,
    /if \(!sessionPolicy\.ctf\) \{\s*emitBackgroundTasks/,
  );
  assert.doesNotMatch(
    bridgeSource,
    /if \(!sessionPolicy\.ctf\) \{\s*emit\(conversationId, "policy_updated"/,
  );
  assert.doesNotMatch(
    bridgeSource,
    /policy\?\.ctf\s*\n\s*\? undefined/,
  );
  assert.doesNotMatch(
    bridgeSource,
    /policy\.ctf\s*\|\|\s*policy\.executionMode !== "go"/,
  );
  assert.doesNotMatch(
    bridgeSource,
    /\(!sessionRole \|\| researchSession\)/,
  );
});

test("tool results are bound through Pi's tool_result hook after MCP", () => {
  const boundIndex = bridgeSource.indexOf("createToolResultBoundExtension()");
  const mcpIndex = bridgeSource.lastIndexOf("createMcpAdapter(");
  assert.ok(boundIndex > 0);
  assert.ok(mcpIndex > 0);
  assert.ok(boundIndex > mcpIndex);
});
