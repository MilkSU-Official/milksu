/**
 * 读者口径：**拒绝这次写入并告知**，不是「一碰就把整轮掐死」。
 *
 * 这里钉三件事：
 * ① 单次写入只拒绝（不停轮）；
 * ② 同一轮反复换写法试（第 3 次起）才停轮；
 * ③ 停轮时**必须**给读者写明原因（目录、次数、没写进去），不许静默。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  PROTECTED_WRITE_ATTEMPT_LIMIT,
  protectedBlockEscalates,
  protectedEscalationNotice,
} from "./bridge-protected-paths.js";

const bridge = readFileSync(new URL("./bridge.js", import.meta.url), "utf8");
const USER_PROTECTED_FOLDER_LABEL = "user-protected-folder";
const VIOLATION = {
  path: "/tmp/example-project/out/f.txt",
  label: USER_PROTECTED_FOLDER_LABEL,
};

function protectedBranch() {
  const start = bridge.indexOf("const protectedViolation = protectedViolationFor(event, policy)");
  const end = bridge.indexOf("if (codingTurnContractBlocksTool(getTurnContract()))");
  assert.ok(start > 0 && end > start, "找不到受保护路径那条守卫分支");
  return bridge.slice(start, end);
}

test("前两次拒绝不停轮，第 3 次才升级", () => {
  assert.equal(PROTECTED_WRITE_ATTEMPT_LIMIT, 3, "阈值固定为 3，改它要连着改测试");
  assert.equal(protectedBlockEscalates(1), false);
  assert.equal(protectedBlockEscalates(2), false);
  assert.equal(protectedBlockEscalates(3), true);
  assert.equal(protectedBlockEscalates(9), true);
});

test("升级时给读者的提示：说清目录、次数、没有写进去", () => {
  const zh = protectedEscalationNotice(VIOLATION, 3, "zh");
  assert.ok(zh.includes(VIOLATION.path), "要说清是哪个路径");
  assert.match(zh, /已停止本轮/, "要说明本轮被停了");
  assert.match(zh, /3 次/, "要说试了几次");
  assert.match(zh, /写入都没有发生/, "要说明没有写成功");

  const en = protectedEscalationNotice(VIOLATION, 3, "en");
  assert.ok(en.includes(VIOLATION.path));
  assert.match(en, /Stopped this turn/);
  assert.match(en, /3 times/);
  assert.match(en, /Nothing was written/);
});

test("守卫：停轮由升级决定，不能写死 true（源码守卫）", () => {
  const branch = protectedBranch();
  assert.match(branch, /terminate: escalates/, "停轮必须由升级决定");
  assert.ok(!/terminate: true/.test(branch), "这条分支里不许再出现写死的 terminate: true");
  assert.match(branch, /protectedWriteAttempts \+= 1/, "要真的在计数");
  assert.match(
    branch,
    /if \(escalates\) abortedSessions\.add\(conversationId\)/,
    "只有升级才允许把会话标中止",
  );
  assert.match(
    branch,
    /protectedEscalationNotice\(protectedViolation, protectedWriteAttempts, "zh"\)/,
    "升级时给读者的是升级提示",
  );
  assert.match(
    branch,
    /protectedAlarmNotice\(protectedViolation, "zh"\)/,
    "普通拒绝时给读者的仍是「已拦截」",
  );
});

test("守卫：每一轮从零开始计（源码守卫）", () => {
  const start = bridge.indexOf('pi.on("before_agent_start", () => {\n      repeatGuard.reset();');
  assert.ok(start > 0, "找不到每轮开头的重置点");
  const block = bridge.slice(start, start + 400);
  assert.match(block, /protectedWriteAttempts = 0/, "新的一轮必须把拒绝计数清零");
});

test("普通拒绝的读者提示不再假称「本轮已停止」", () => {
  const start = bridge.indexOf("function protectedAlarmNotice");
  // 本分支 protectedAlarmNotice 之后的那个常量是 workspaceActionBroker（另一条线的
  // deliveryBroker 不在这里）⇒ 结束锚点按本分支实际写，只改这一处 ✗。
  const end = bridge.indexOf("const workspaceActionBroker");
  assert.ok(start > 0 && end > start, "找不到 protectedAlarmNotice");
  const alarm = bridge.slice(start, end);
  assert.match(alarm, /这次写入没有发生/, "普通拒绝也要说清写入没发生");
  assert.ok(!/本轮已停止/.test(alarm), "普通拒绝没有停轮，提示里不许这么说");
});
