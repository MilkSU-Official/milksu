import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  createThinkingRepetitionGuard,
  THINKING_REPEAT_LINES,
  THINKING_REPEAT_NOTICE,
} from "./bridge-thinking-repetition.js";

function feed(guard, lines) {
  let hit = null;
  for (const line of lines) {
    hit = guard.push("conversation-1", `${line}\n`) ?? hit;
  }
  return hit;
}

test("a repeated line fires the guard after the threshold, and only once", () => {
  const guard = createThinkingRepetitionGuard();
  const hit = feed(guard, Array.from({ length: THINKING_REPEAT_LINES }, () => "(unchanged)"));
  assert.ok(hit, "eight identical lines must fire");
  assert.equal(hit.run, THINKING_REPEAT_LINES);
  assert.equal(hit.line, "(unchanged)");
  // 命中必须带取样：决策层靠它区分真卡住与合法重复，没有 sample 就没法复核。
  assert.ok(Array.isArray(hit.sample), "a hit must carry the recent-line sample for the decision layer");
  assert.equal(hit.sample.at(-1), "(unchanged)");
  // 只报一次：同一会话的同一个思考步不该刷屏。
  assert.equal(guard.push("conversation-1", "(unchanged)\n"), null);
});

test("long thinking that differs every line never fires", () => {
  const guard = createThinkingRepetitionGuard();
  const lines = Array.from({ length: 30 }, (_, index) => `step ${index}: a different thought`);
  assert.equal(feed(guard, lines), null);
});

test("deltas that arrive mid line are buffered, not treated as separate lines", () => {
  const guard = createThinkingRepetitionGuard();
  // 一个 delta 里只有半行 ⇒ 不能算两行。
  let hit = null;
  for (let index = 0; index < 10; index += 1) {
    hit = guard.push("conversation-1", "(unch") ?? hit;
    hit = guard.push("conversation-1", "anged)\n") ?? hit;
  }
  assert.ok(hit, "split deltas of one repeated line must still fire");
});

// ③ 无静默路径：命中后必须把成对双语的 notice 和复核用 sample 一起挂在事件上；
// 引擎侧 gateGuardAlarm 用 sample 问决策层，复核通过读者才看得到提示。
test("the sidecar answers a repeat with a visible notice, never silently", () => {
  const bridge = readFileSync(new URL("./bridge.js", import.meta.url), "utf8");
  assert.ok(bridge.includes("thinkingRepetition.push("), "the delta outlet must feed the guard");
  const outlet = bridge.slice(bridge.indexOf("thinkingRepetition.push("));
  assert.ok(outlet.includes('emit(conversationId, "guard.alarm"'), "a hit must emit guard.alarm");
  assert.ok(outlet.includes("THINKING_REPEAT_NOTICE.notice"));
  assert.ok(outlet.includes("THINKING_REPEAT_NOTICE.noticeEnglish"));
  assert.ok(outlet.includes("sample: repeat.sample"), "the payload must carry the sample for the decision layer");
  assert.ok(THINKING_REPEAT_NOTICE.notice.length > 0 && THINKING_REPEAT_NOTICE.noticeEnglish.length > 0);
});

// ④ 跨层断言（本件教训的固化）：侧车发的名字必须**就是** app 认得并会显示的名字。
test("the name the sidecar emits is the name the renderer consumes", () => {
  const app = readFileSync(new URL("../../app/src/composables/useConversations.ts", import.meta.url), "utf8");
  assert.ok(app.includes("if (type === 'guard.alarm')"), "the renderer must have a guard.alarm branch");
  const branchStart = app.indexOf("if (type === 'guard.alarm')");
  const branchEnd = app.indexOf("} else if", branchStart);
  const branch = app.slice(branchStart, branchEnd === -1 ? undefined : branchEnd);
  assert.ok(branch.includes("noticeEnglish"), "the renderer must read the paired English notice");
  assert.ok(branch.includes("pushEngineNotice("), "the renderer must show it, not swallow it");
  // 全仓库唯一的发出点就是本件这一处；若将来新增发出点，每个载荷都必须成对双语，
  // 别让同一事件名有两种载荷形状。
  const bridge = readFileSync(new URL("./bridge.js", import.meta.url), "utf8");
  const payloads = bridge.split('emit(conversationId, "guard.alarm"').slice(1);
  for (const payload of payloads) {
    const head = payload.slice(0, 400);
    assert.ok(head.includes("noticeEnglish"), `every guard.alarm payload must be paired: ${head.slice(0, 120)}`);
  }
});
