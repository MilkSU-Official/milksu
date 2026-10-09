// PR-2 批次 B1 门内分叉的源码契约（防回归：门必须真的在，且分叉只在收口点）。
//
// D2 扳机翻转后的契约更新（原「默认关、1 才开」的断言是翻转前的过时假设，本票按
// FLIP-REVIEW 定稿翻转：缺省＝开、MILKSU_PI_HARNESS=0＝显式关、CTF/CVE/实验室工作区
// 排除收口在 harness-bridge-flip）：
//   - 门关路径仍逐字节原样执行（MILKSU_PI_HARNESS=0 时 harnessSessionEligible 恒
//     false，路由行为与翻转前的门关一致，全量 test:sidecar 门关回归兜底）；
//   - createSession 的分叉判定读 harnessSessionEligible（带 CTF/CVE 排除），不再只读
//     环境门——CTF/CVE 排除是 FLIP-REVIEW #3 用户已过目的行为要求，不是回归。

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { HARNESS_ENABLE_ENV, isPiHarnessEnabled } from "./harness-adapter.js";
import { harnessSessionEligible, harnessSessionExcluded } from "./harness-bridge-flip.js";
import { MILKSU_HARNESS_SESSION_KIND } from "./harness-bridge-session.js";

const bridgePath = join(dirname(fileURLToPath(import.meta.url)), "bridge.js");
const bridgeSource = await readFile(bridgePath, "utf8");

test("the harness gate defaults to OPEN after the D2 flip; MILKSU_PI_HARNESS=0 is the rollback switch", () => {
  assert.equal(HARNESS_ENABLE_ENV, "MILKSU_PI_HARNESS");
  // D2 语义：缺省/空串/"1"/"true" → 开；只有 "0" 显式关（回退旧引擎）。
  assert.equal(isPiHarnessEnabled({}), true, "unset env keeps the harness path (flipped default)");
  assert.equal(isPiHarnessEnabled({ MILKSU_PI_HARNESS: "" }), true);
  assert.equal(isPiHarnessEnabled({ MILKSU_PI_HARNESS: "1" }), true);
  assert.equal(isPiHarnessEnabled({ MILKSU_PI_HARNESS: "true" }), true);
  assert.equal(isPiHarnessEnabled({ MILKSU_PI_HARNESS: "0" }), false, "explicit 0 rolls back to the legacy engine");
  // 收口点：门关时无论排除面如何，eligible 恒 false（旧引擎全功能路径）。
  assert.equal(harnessSessionEligible({}, { MILKSU_PI_HARNESS: "0" }), false);
  assert.equal(
    harnessSessionEligible({ sessionRole: "cve-research" }, { MILKSU_PI_HARNESS: "0" }),
    false,
  );
});

test("createSession forks on the flip predicate before any legacy SessionManager work", () => {
  const fork = bridgeSource.indexOf("if (harnessSessionEligible(command)) {\n    return harnessLayer().createSession(command);");
  const legacy = bridgeSource.indexOf("applyWorkerModelOverride(command.workerModel);");
  const createSessionStart = bridgeSource.indexOf("async function createSession(command) {");
  assert.ok(createSessionStart > 0);
  assert.ok(
    fork > createSessionStart && fork < legacy,
    "the flip fork must run before the legacy path's first statement",
  );
  // 既有 SessionManager 路径仍在（门关/CTF 排除时逐字节执行）。
  assert.ok(bridgeSource.includes("createSessionManager(cwd, agentDir, conversationId)"));
  assert.ok(bridgeSource.includes("createAgentSession({"));
});

test("the routing commands fork before their legacy bodies", () => {
  for (const [name, marker] of [
    // D2：sendMessage 送完整 command 进路由判定（sessionRole 的 CTF/CVE/研究排除面）。
    ["sendMessage", "if (harnessTurnRouted(command)) {\n    return harnessLayer().sendMessage(command);"],
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

// D2 收口契约：CTF/CVE/实验室排除只允许出现在 harness-bridge-flip（bridge.js 不散落
// 第二处判定——challenge.json/角色/ctf_ 前缀的读取都在收口模块里）。
test("the CTF/CVE exclusion is single-sourced in harness-bridge-flip", () => {
  assert.ok(bridgeSource.includes('import { harnessSessionEligible } from "./harness-bridge-flip.js";'));
  assert.ok(!bridgeSource.includes("challenge.json"), "bridge.js must not re-implement the CTF workspace check");
  assert.equal(bridgeSource.indexOf("harnessSessionExcluded"), -1, "bridge.js only consumes the combined predicate");
  assert.equal(harnessSessionExcluded({ sessionRole: "solver" }), true);
  assert.equal(harnessSessionExcluded({ conversationId: "ctf_abc123" }), true);
  assert.equal(harnessSessionExcluded({ sessionRole: "cve-research" }), true);
  assert.equal(harnessSessionExcluded({ sessionRole: "lab-job" }), true);
  assert.equal(
    harnessSessionExcluded({ conversationId: "conv-normal" }, "/definitely-not-a-ctf-workspace"),
    false,
  );
});
