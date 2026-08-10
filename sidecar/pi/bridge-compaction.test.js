import assert from "node:assert/strict";
import test from "node:test";
import {
  compactSession,
  compactionInstructions,
  DEFAULT_COMPACTION_TIMEOUT_MS,
  projectCompactionEvent,
  trackCompaction,
  waitForCompaction,
} from "./bridge-compaction.js";

function idleSession({ compact } = {}) {
  return {
    isIdle: true,
    isCompacting: false,
    abortCompaction() {},
    async compact(instructions) {
      if (compact) return compact(instructions);
      return { summary: "fixture summary", tokensBefore: 5000, estimatedTokensAfter: 800 };
    },
  };
}

test("compacts an idle session with the fixed structured instructions", async () => {
  let receivedInstructions;
  const session = idleSession({
    compact: async (instructions) => {
      receivedInstructions = instructions;
      return { summary: "s", tokensBefore: 3000, estimatedTokensAfter: 500 };
    },
  });
  const result = await compactSession(session);
  assert.equal(receivedInstructions, compactionInstructions);
  assert.deepEqual(result, { tokensBefore: 3000, estimatedTokensAfter: 500 });
});

test("requires an existing session", async () => {
  await assert.rejects(compactSession(null), /Coding session is required/);
  await assert.rejects(compactSession(undefined), /Coding session is required/);
});

test("rejects a busy session before calling Pi compaction", async () => {
  await assert.rejects(
    compactSession({ isIdle: false }),
    /busy \(streaming, retrying, or queued\)/,
  );
});

test("rejects an already-compacting session", async () => {
  await assert.rejects(
    compactSession({ isIdle: true, isCompacting: true }),
    /already compacting/,
  );
});

test("surfaces Pi failures such as nothing to compact without faking success", async () => {
  const session = idleSession({
    compact: async () => {
      throw new Error("Nothing to compact (session too small)");
    },
  });
  await assert.rejects(compactSession(session), /Nothing to compact/);
});

test("surfaces model/auth failures without faking success", async () => {
  const session = idleSession({
    compact: async () => {
      throw new Error("No API key for deepseek/model");
    },
  });
  await assert.rejects(compactSession(session), /No API key/);
});

test("bounds compaction with a timeout and cancels the summarization call", async () => {
  let aborted = false;
  const session = {
    isIdle: true,
    isCompacting: false,
    abortCompaction() {
      aborted = true;
    },
    compact() {
      return new Promise(() => {});
    },
  };
  await assert.rejects(
    compactSession(session, { timeoutMs: 25 }),
    /timed out and was cancelled/,
  );
  assert.equal(aborted, true);
});

test("rejects a non-positive timeout", async () => {
  await assert.rejects(
    compactSession(idleSession(), { timeoutMs: 0 }),
    /timeout must be positive/,
  );
});

test("default timeout is a bounded positive constant", () => {
  assert.ok(Number.isFinite(DEFAULT_COMPACTION_TIMEOUT_MS));
  assert.ok(DEFAULT_COMPACTION_TIMEOUT_MS > 0);
  assert.ok(DEFAULT_COMPACTION_TIMEOUT_MS <= 300_000);
});

test("fixed instructions cover goal, constraints, progress, decisions, next steps, context and file tracking", () => {
  for (const part of [
    "Goal",
    "约束",
    "已完成",
    "进行中",
    "关键决定",
    "下一步",
    "关键上下文",
    "read files",
    "modified files",
  ]) {
    assert.ok(
      compactionInstructions.includes(part),
      `instructions must cover: ${part}`,
    );
  }
});

test("projects Pi native compaction events without exposing the summary", () => {
  assert.deepEqual(
    projectCompactionEvent(
      { type: "compaction_start", reason: "manual" },
      "request-1",
    ),
    {
      type: "compaction_start",
      data: { requestId: "request-1", reason: "manual" },
    },
  );
  const completed = projectCompactionEvent({
    type: "compaction_end",
    reason: "manual",
    aborted: false,
    willRetry: false,
    result: {
      summary: "must stay inside Pi",
      tokensBefore: 9000,
      estimatedTokensAfter: 1200,
    },
  }, "request-1");
  assert.deepEqual(completed, {
    type: "compaction_end",
    data: {
      requestId: "request-1",
      reason: "manual",
      aborted: false,
      error: undefined,
      compaction: {
        tokensBefore: 9000,
        estimatedTokensAfter: 1200,
      },
    },
  });
  assert.equal(JSON.stringify(completed).includes("must stay inside Pi"), false);
});

test("projects a failed Pi compaction as an error without a result", () => {
  assert.deepEqual(projectCompactionEvent({
    type: "compaction_end",
    reason: "manual",
    aborted: true,
    willRetry: false,
    errorMessage: "Compaction cancelled",
  }, "request-2"), {
    type: "compaction_end",
    data: {
      requestId: "request-2",
      reason: "manual",
      aborted: true,
      error: "Compaction cancelled",
      compaction: undefined,
    },
  });
  assert.equal(
    projectCompactionEvent({
      type: "compaction_end",
      reason: "manual",
      aborted: true,
      willRetry: false,
    }, "request-3")?.data.error,
    "Context compaction cancelled",
  );
});

test("waits for an in-flight compaction before the next prompt", async () => {
  const runs = new Map();
  let release;
  const run = new Promise(resolve => {
    release = resolve;
  });
  const tracked = trackCompaction(runs, "conversation-1", run);
  assert.equal(runs.get("conversation-1"), tracked);

  let promptProceeded = false;
  const waiter = waitForCompaction(runs, "conversation-1")
    .then(() => {
      promptProceeded = true;
    });
  await Promise.resolve();
  assert.equal(promptProceeded, false, "prompt must wait while compacting");

  release();
  await waiter;
  assert.equal(promptProceeded, true);
  assert.equal(runs.has("conversation-1"), false, "tracker must self-clean");
});

test("does not wait when no compaction is tracked", async () => {
  await waitForCompaction(new Map(), "conversation-2");
  await waitForCompaction(undefined, "conversation-2");
  await waitForCompaction(new Map(), "");
});

test("tracked compaction survives failure and still self-cleans", async () => {
  const runs = new Map();
  const run = Promise.reject(new Error("Nothing to compact"));
  const tracked = trackCompaction(runs, "conversation-3", run);
  await assert.rejects(tracked, /Nothing to compact/);
  assert.equal(runs.has("conversation-3"), false);
});
