// PR-2 批次 B1 门内分叉的源码契约（防回归：门必须真的在，且分叉只增不改）。
//
// 「门关路径逐字节原样」的证明方式：bridge.js 对既有路径**只增不改**（git diff 仅
// insertions，本测试把关键不变量钉住）；行为面由全量 test:sidecar 门关回归兜底
//（门关时 sessions 里永远不会有 milksu-harness 会话，分叉条件不成立）。

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { HARNESS_ENABLE_ENV, isPiHarnessEnabled } from "./harness-adapter.js";
import { MILKSU_HARNESS_SESSION_KIND } from "./harness-bridge-session.js";

const bridgePath = join(dirname(fileURLToPath(import.meta.url)), "bridge.js");
const bridgeSource = await readFile(bridgePath, "utf8");

test("the harness gate defaults to closed and only opens on MILKSU_PI_HARNESS=1", () => {
  assert.equal(HARNESS_ENABLE_ENV, "MILKSU_PI_HARNESS");
  assert.equal(isPiHarnessEnabled({}), false, "unset env keeps the legacy path");
  assert.equal(isPiHarnessEnabled({ MILKSU_PI_HARNESS: "" }), false);
  assert.equal(isPiHarnessEnabled({ MILKSU_PI_HARNESS: "0" }), false);
  assert.equal(isPiHarnessEnabled({ MILKSU_PI_HARNESS: "true" }), false);
  assert.equal(isPiHarnessEnabled({ MILKSU_PI_HARNESS: "1" }), true);
});

test("createSession forks on the gate before any legacy SessionManager work", () => {
  const fork = bridgeSource.indexOf("if (isPiHarnessEnabled()) {\n    return harnessLayer().createSession(command);");
  const legacy = bridgeSource.indexOf("applyWorkerModelOverride(command.workerModel);");
  const createSessionStart = bridgeSource.indexOf("async function createSession(command) {");
  assert.ok(createSessionStart > 0);
  assert.ok(
    fork > createSessionStart && fork < legacy,
    "the gate fork must run before the legacy path's first statement",
  );
  // 既有 SessionManager 路径仍在（门关时逐字节执行）。
  assert.ok(bridgeSource.includes("createSessionManager(cwd, agentDir, conversationId)"));
  assert.ok(bridgeSource.includes("createAgentSession({"));
});

test("the routing commands fork before their legacy bodies", () => {
  for (const [name, marker] of [
    ["sendMessage", "if (harnessTurnRouted(conversationId)) {\n    return harnessLayer().sendMessage(command);"],
    ["abortSession", "if (harnessTurnRouted(conversationId)) {\n    return harnessLayer().abortSession(command);"],
    ["destroySession", "if (harnessTurnRouted(conversationId)) {\n    return harnessLayer().destroySession(command);"],
    ["compactSessionCommand", "if (harnessTurnRouted(conversationId)) {\n    return harnessLayer().compactSessionCommand(command);"],
  ]) {
    assert.ok(bridgeSource.includes(marker), `${name} must fork to the harness layer`);
  }
  // B1 未接线的树操作：显式报「不支持」，不静默走旧路径炸在 Pi 内部件上。
  for (const type of ["session_forked", "session_rewound", "session_handoff"]) {
    assert.ok(
      bridgeSource.includes(`harnessUnsupportedResult(command, "${type}")`),
      `${type} must answer explicitly on the harness path`,
    );
  }
});

test("shutdown closes the harness after the sessions settle (dispose→close→waitpid chain)", () => {
  const disposal = bridgeSource.indexOf(
    "[...sessions.values()].map(session => disposeAgentSession(session))",
  );
  const harnessClose = bridgeSource.indexOf("await harnessBridgeLayer?.disposeAll();");
  assert.ok(disposal > 0 && harnessClose > disposal, "harness close follows session disposal");
});

// PR-2 批次 B2：decision_query 的门开分叉在门关判定之前，harness 会话不再落进
// pi-coding-agent 的 modelRuntime 分支。
test("decision_query forks to the harness layer before the modelRuntime branch", () => {
  const handler = bridgeSource.indexOf("async function handleDecisionQuery(command) {");
  const harnessFork = bridgeSource.indexOf("await harnessLayer().decisionQuery(command);");
  const legacyBranch = bridgeSource.indexOf(
    "if (!target?.model || typeof target?.modelRuntime?.completeSimple !== \"function\") {",
  );
  assert.ok(handler > 0);
  assert.ok(
    harnessFork > handler && harnessFork < legacyBranch,
    "the harness fork must run before the legacy modelRuntime check",
  );
});

test("the harness session kind is distinct so the legacy path never adopts harness sessions", () => {
  assert.equal(MILKSU_HARNESS_SESSION_KIND, "milksu-harness");
  assert.ok(
    bridgeSource.includes("sessions.get(id)?.kind === MILKSU_HARNESS_SESSION_KIND"),
    "routing checks the session kind, never the gate alone",
  );
});
