import assert from "node:assert/strict";
import test from "node:test";
import {
  applySemanticMemorySnapshot,
  createMemoryExtractController,
  extractCompanionMemories,
  normalizeMemoryExtract,
  normalizeMemoryExtractIdleMinutes,
  parseMemoryExtractResult,
} from "./memory-extract.js";

test("extract timing defaults to each turn and ten idle minutes", () => {
  assert.equal(normalizeMemoryExtract(""), "turn");
  assert.equal(normalizeMemoryExtract("daily"), "turn");
  assert.equal(normalizeMemoryExtract("off"), "off");
  assert.equal(normalizeMemoryExtract("idle"), "idle");
  assert.equal(normalizeMemoryExtractIdleMinutes(0), 10);
  assert.equal(normalizeMemoryExtractIdleMinutes(15), 15);
  assert.equal(normalizeMemoryExtractIdleMinutes("60"), 60);
});

test("extract keeps a quoted preference and drops a paraphrase", () => {
  const userText = "以后都用中文回复我";
  const items = parseMemoryExtractResult(JSON.stringify({
    items: [
      {
        action: "create",
        title: "回复语言",
        markdown: "回复保持简体中文",
        evidence: "以后都用中文回复我",
      },
      {
        action: "create",
        title: "英文",
        markdown: "不要用英文",
        evidence: "不要用英文回复",
      },
      {
        action: "update",
        existingId: "missing",
        title: "称呼",
        markdown: "称呼用户 Milk",
        evidence: "以后都用中文回复我",
      },
    ],
  }), {
    userText,
    memories: [{ id: "mem_a", title: "旧", markdown: "旧" }],
    maxItems: 3,
  });
  assert.deepEqual(items, [{
    action: "create",
    existingId: "",
    title: "回复语言",
    markdown: "回复保持简体中文",
    evidence: "以后都用中文回复我",
  }]);
});

test("extract updates an existing memory when the quote matches", () => {
  const items = parseMemoryExtractResult(JSON.stringify({
    items: [{
      action: "update",
      existingId: "mem_a",
      title: "回复语言",
      markdown: "回复可以用英文",
      evidence: "英文也可以",
    }],
  }), {
    userText: "英文也可以",
    memories: [{ id: "mem_a", title: "回复语言", markdown: "回复保持简体中文" }],
    maxItems: 1,
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].action, "update");
  assert.equal(items[0].existingId, "mem_a");
});

test("extract reads the model JSON and ignores a failed pass", async () => {
  const items = await extractCompanionMemories({
    userText: "叫我 Milk",
    assistantText: "好",
    locale: "zh",
    maxItems: 1,
    complete: async () => ({
      content: [{
        type: "text",
        text: '{"items":[{"action":"create","title":"称呼","markdown":"称呼用户 Milk","evidence":"叫我 Milk"}]}',
      }],
    }),
  });
  assert.equal(items[0].markdown, "称呼用户 Milk");
  await assert.rejects(() => extractCompanionMemories({
    userText: "叫我 Milk",
    complete: async () => ({ stopReason: "error" }),
  }));
});

test("each turn extracts immediately and retries a failure once", async () => {
  const seen = [];
  let calls = 0;
  const controller = createMemoryExtractController({
    extract: async (job) => {
      calls += 1;
      seen.push(job.stretch.map(item => item.user).join("|"));
      if (calls === 1) throw new Error("offline");
    },
  });
  controller.configure({ mode: "turn" });
  await controller.finishTurn({ userText: "以后用中文", assistantText: "好" });
  assert.deepEqual(seen, ["以后用中文"]);
  await controller.finishTurn({ userText: "再记一条", assistantText: "好" });
  assert.deepEqual(seen, ["以后用中文", "以后用中文", "再记一条"]);
});

test("a newer memory snapshot wins over an older commit result", () => {
  const forgotten = applySemanticMemorySnapshot(
    { memories: [{ id: "mem_a", title: "称呼", markdown: "称呼用户 Milk" }], revision: 2 },
    [{ id: "mem_a", title: "称呼", markdown: "称呼用户 Milk" }],
    1,
  );
  assert.equal(forgotten.applied, false);
  assert.equal(forgotten.memories.length, 1);
  const current = applySemanticMemorySnapshot(forgotten, [], 4);
  assert.equal(current.applied, true);
  assert.deepEqual(current.memories, []);
  assert.equal(current.revision, 4);
  const missing = applySemanticMemorySnapshot(current, [{ id: "mem_a" }], undefined);
  assert.equal(missing.applied, false);
  assert.deepEqual(missing.memories, []);
});

test("idle extract waits, resets when the next turn starts, and drops when switched off", async () => {
  let armed = null;
  const seen = [];
  const controller = createMemoryExtractController({
    extract: async (job) => {
      seen.push(job);
    },
    setTimer: (fn, ms) => {
      armed = { fn, ms };
      return armed;
    },
    clearTimer: () => {
      armed = null;
    },
  });
  controller.configure({ mode: "idle", idleMinutes: 5 });
  await controller.finishTurn({ userText: "先说一句", assistantText: "好" });
  assert.equal(seen.length, 0);
  assert.equal(armed.ms, 5 * 60 * 1000);
  const pending = armed.fn;
  controller.beginTurn();
  await pending();
  assert.equal(seen.length, 0);
  await controller.finishTurn({ userText: "再说一句", assistantText: "好", aborted: true });
  assert.equal(armed.ms, 5 * 60 * 1000);
  controller.configure({ mode: "off" });
  assert.equal(armed, null);
  await controller.finishTurn({ userText: "关掉了", assistantText: "好" });
  assert.equal(seen.length, 0);
});

test("idle keeps one timer and one model call when earlier waits also fire", async () => {
  const pending = [];
  const seen = [];
  let now = 1_000_000;
  const controller = createMemoryExtractController({
    now: () => now,
    extract: async (job) => {
      seen.push(job.stretch.map(item => item.user).join("|"));
    },
    setTimer: (fn, ms) => {
      const handle = { fn, ms };
      pending.push(handle);
      return handle;
    },
    clearTimer: () => {},
  });
  controller.configure({ mode: "idle", idleMinutes: 10 });
  await controller.finishTurn({ userText: "一", assistantText: "好" });
  await controller.finishTurn({ userText: "二", assistantText: "好" });
  await controller.finishTurn({ userText: "三", assistantText: "好" });
  assert.equal(pending.length, 3);
  for (const handle of pending) {
    await handle.fn();
  }
  assert.deepEqual(seen, ["一|二|三"]);
  await controller.finishTurn({ userText: "四", assistantText: "好" });
  await pending[pending.length - 1].fn();
  assert.deepEqual(seen, ["一|二|三"]);
  now += 10 * 60 * 1000;
  await pending[pending.length - 1].fn();
  assert.deepEqual(seen, ["一|二|三", "四"]);
});

test("an in-flight idle extract does not start a second model call", async () => {
  let release;
  const seen = [];
  let armed = null;
  const controller = createMemoryExtractController({
    now: () => 5_000_000,
    extract: (job) => {
      seen.push(job.stretch.map(item => item.user).join("|"));
      return new Promise(resolve => {
        release = () => resolve(job.stale() ? { committed: false } : { committed: true });
      });
    },
    setTimer: (fn) => {
      armed = fn;
      return fn;
    },
    clearTimer: () => {
      armed = null;
    },
  });
  controller.configure({ mode: "idle", idleMinutes: 5 });
  await controller.finishTurn({ userText: "一", assistantText: "好" });
  const first = armed();
  controller.beginTurn();
  await controller.finishTurn({ userText: "二", assistantText: "好" });
  const second = armed();
  assert.equal(seen.length, 1);
  release();
  await first;
  await second;
  assert.deepEqual(seen, ["一"]);
});

test("idle retries a failed quiet period once, as one call", async () => {
  let calls = 0;
  let armed = null;
  let now = 0;
  const seen = [];
  const controller = createMemoryExtractController({
    now: () => now,
    extract: async (job) => {
      calls += 1;
      seen.push(job.stretch.map(item => item.user).join("|"));
      if (calls === 1) throw new Error("offline");
    },
    setTimer: (fn) => {
      armed = fn;
      return fn;
    },
    clearTimer: () => {
      armed = null;
    },
  });
  controller.configure({ mode: "idle", idleMinutes: 10 });
  await controller.finishTurn({ userText: "以后用中文", assistantText: "好" });
  now = 10 * 60 * 1000;
  await armed();
  assert.deepEqual(seen, ["以后用中文"]);
  await controller.finishTurn({ userText: "叫我 Milk", assistantText: "好" });
  now = 20 * 60 * 1000;
  await armed();
  assert.deepEqual(seen, ["以后用中文", "以后用中文|叫我 Milk"]);
  assert.equal(calls, 2);
});
