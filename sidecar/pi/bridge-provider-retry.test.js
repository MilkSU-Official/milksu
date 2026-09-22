import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { withNoProviderRetry } from "./bridge-provider-retry.js";

// 真事：429 被 pi-ai 自动重试 3 次 ⇒ 同一轮连打 3~4 次、越打越被限流。
test("it turns both retry budgets off and keeps every other key", () => {
  const before = JSON.stringify({
    defaultProvider: "tokenflux",
    defaultModel: "deepseek/deepseek-flash",
    compaction: { enabled: true },
    retry: { someOtherKnob: 1, provider: { keepMe: true } },
  });
  const after = JSON.parse(withNoProviderRetry(before));
  assert.equal(after.retry.maxRetries, 0);
  assert.equal(after.retry.provider.maxRetries, 0);
  // 原有设置一个都不能丢 ✓
  assert.equal(after.defaultProvider, "tokenflux");
  assert.equal(after.compaction.enabled, true);
  assert.equal(after.retry.someOtherKnob, 1);
  assert.equal(after.retry.provider.keepMe, true);
});

test("a settings file with no retry block gets one", () => {
  const after = JSON.parse(withNoProviderRetry('{"defaultModel":"x"}'));
  assert.equal(after.retry.maxRetries, 0);
  assert.equal(after.defaultModel, "x");
});

test("nothing to change yields null so the file is left alone", () => {
  const already = JSON.stringify({ retry: { maxRetries: 0, provider: { maxRetries: 0 } } });
  assert.equal(withNoProviderRetry(already), null);
});

test("an empty or broken file is never rewritten", () => {
  // 空文件 ⇒ 补一份（pi 需要它）但要能通过 JSON 解析 ✓
  const created = withNoProviderRetry("");
  assert.equal(JSON.parse(created).retry.maxRetries, 0);
  // 坏 JSON ⇒ 不碰（返回 null）✓，绝不把用户设置写烂 ✗
  assert.equal(withNoProviderRetry("{not json"), null);
});

// 跨层保挂：光有纯函数没用，必须真的挂在建会话之前 ✓（删掉接线这一条就红 ✓）。
test("bridge.js applies it before creating a session", async () => {
  const source = await readFile(new URL("./bridge.js", import.meta.url), "utf8");
  assert.ok(source.includes("withNoProviderRetry"), "bridge.js must use the helper");
  assert.ok(
    /ensureNoProviderRetry\([\s\S]{0,200}await createAgentSession\(/.test(source),
    "the retry budget must be zeroed before the session is created",
  );
  // 真事：写完忘了导入 writeFile ⇒ 抛 ReferenceError ⇒ 被 try/catch 吞掉 ⇒ **静默不生效** ✗。
  // 所以"它真的会写盘"也要钉住。
  assert.ok(
    /import \{[^}]*\bwriteFile\b[^}]*\} from "node:fs\/promises"/.test(source),
    "bridge.js must import writeFile or the merge silently does nothing",
  );
});
