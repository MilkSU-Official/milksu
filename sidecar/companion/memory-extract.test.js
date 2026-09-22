import assert from "node:assert/strict";
import test from "node:test";
import {
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
