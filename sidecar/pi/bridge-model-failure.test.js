import test from "node:test";
import assert from "node:assert/strict";
import { assistantFailureText } from "./bridge-model-failure.js";

// 真事：tokenflux 回 `429 status code (no body)`，pi 记为 stopReason:"error" + errorMessage，
// 而侧车只取 usage ✗ ⇒ 失败被丢掉 ⇒ 读者看到"它不说话"✗。这组用例把"必须取出来"钉住。
test("a model call that failed with a message yields that message", () => {
  assert.equal(
    assistantFailureText({ stopReason: "error", errorMessage: "429 status code (no body)" }),
    "429 status code (no body)",
  );
});

test("an error stop without a message still says something", () => {
  const text = assistantFailureText({ stopReason: "error" });
  assert.notEqual(text, "");
});

test("a normal stop yields nothing", () => {
  assert.equal(assistantFailureText({ stopReason: "stop", content: [] }), "");
  assert.equal(assistantFailureText({ stopReason: "toolUse" }), "");
});

test("a message that carries only an error string is still reported", () => {
  assert.equal(assistantFailureText({ error: "boom" }), "boom");
});

test("junk input never throws and never invents a failure", () => {
  assert.equal(assistantFailureText(undefined), "");
  assert.equal(assistantFailureText(null), "");
  assert.equal(assistantFailureText("nope"), "");
  assert.equal(assistantFailureText({}), "");
});

// 跨层保挂：光有纯函数没用 —— 必须真的接在 `message_end` 上，并且用现成的 `error` 事件。
// （删掉接线这一条就红 ✓。）
test("the message_end handler forwards a failed call through the error event", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("./bridge.js", import.meta.url), "utf8");
  assert.ok(source.includes("assistantFailureText"), "bridge.js must use the helper");
  assert.ok(
    /emit\(conversationId, "error", \{ error: failure \}\)/.test(source),
    "the failure must be emitted as the engine's error event",
  );
  // 光报告不够：不停本轮 ⇒ pi 会继续跑、同一轮反复重试（真事：429 连试 3 次 + 烧额度 ✗）。
  assert.ok(
    /if \(failure\) \{[\s\S]{0,400}session\.abort\(\)/.test(source),
    "a failed model call must stop the turn instead of letting the loop retry",
  );
});
