import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const bridgeSource = await readFile(
  join(dirname(fileURLToPath(import.meta.url)), "bridge.js"),
  "utf8",
);

test("Pi auto-compaction stays enabled for every session", () => {
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

test("reused Coding/CVE/lab sessions re-enable Pi auto-compaction", () => {
  assert.match(
    bridgeSource,
    /existing\.setAutoCompactionEnabled\(true\)/,
  );
  assert.match(
    bridgeSource,
    /event\.result\.estimatedTokensAfter/,
  );
});

test("CVE/lab sessions keep Coding loop surfaces instead of role-gating them off", () => {
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
  const yieldIndex = bridgeSource.indexOf("createSubagentYieldExtension(");
  assert.ok(boundIndex > 0);
  assert.ok(mcpIndex > 0);
  assert.ok(yieldIndex > 0);
  assert.ok(boundIndex > mcpIndex);
  assert.ok(boundIndex > yieldIndex);
});

// 事故：一次上游合并把 bridge.js 的心跳接线整段吞了，之后 sidecar 再不发 turn.heartbeat，
// 渲染层无法区分“忙”与“死”，于是僵尸转圈没人管。这条契约卡住“有没有真的接上”。
test("the sidecar emits a turn heartbeat around the model request", () => {
  assert.match(
    bridgeSource,
    /import \{ withTurnHeartbeat \} from "\.\/bridge-turn-heartbeat\.js"/,
  );
  assert.match(bridgeSource, /withTurnHeartbeat\(\{ emit, conversationId \}/);
  // 必须包在真正的模型请求外面，而不是某个无关分支里。
  const heartbeatIndex = bridgeSource.indexOf("withTurnHeartbeat({ emit, conversationId }");
  const promptIndex = bridgeSource.indexOf("session.prompt(", heartbeatIndex);
  assert.ok(heartbeatIndex > 0);
  assert.ok(promptIndex > heartbeatIndex);
});
